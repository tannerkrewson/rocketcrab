import type { MemberId } from "@rocketcrab/protocol";
import { PartyError, type PartyEvent, type PartySession } from "@rocketcrab/party";
import type { NovaSessionEvent } from "@rocketcrab/nova-api";
import { createNovaSession } from "@rocketcrab/nova-api";
import { toApiEvent } from "../arena/api-events";
import { findExternalGame } from "../catalog";
import { playerLimitsOf } from "./player-limits";
import { reportConnection } from "../connection-log";
import { updatePartyDisplayName } from "./identity";
import { PartyStateExecutor } from "./party-executors";
import type { PartyGameSelection } from "./engine-types";
import type { PartyEngineContext, ExternalAnnouncement } from "./engine-context";
import type { PartyEngineServices } from "./engine-services";
import {
  START_RETRY_INTERVAL_MS,
  START_RETRY_TIMEOUT_MS,
  START_GIVE_UP_MESSAGE,
  errorMessage,
} from "./engine-utils";

/** Game selection, host controls, start/end readiness, and session event routing. */
export class PartyGameLifecycle {
  private startRetryRemainingMs = 0;

  constructor(
    private readonly state: PartyEngineContext,
    private readonly services: () => Pick<
      PartyEngineServices,
      "runtime" | "snapshot" | "source" | "connection" | "kinds"
    >,
  ) {}

  /** Host-only, in the lobby: a Nova game's source, or an external game by id. */
  async selectGame(selection: PartyGameSelection): Promise<void> {
    if (selection.kind === "external") {
      await this.selectExternalGame(selection.gameId);
      return;
    }
    if (this.state.phase !== "lobby" || this.state.party === null || !this.state.party.amHost) {
      return;
    }
    const { kind: _kind, ...input } = selection;
    this.state.game = { kind: "nova", gameId: input.gameId, title: input.title };
    this.services().runtime.teardownRuntimeFrame();
    // Previous-game verification must not open the new game's start gate.
    this.state.selfVerified = false;
    this.state.selfVerifiedSha256 = null;
    this.state.currentSourceSha256 = null;
    await this.replaceGameSession(this.state.party);
    this.services().snapshot.emit();
    this.services().source.registerSource(input);
  }

  /** Create one external room and share it with all players. */
  private async selectExternalGame(gameId: string): Promise<void> {
    if (this.state.phase !== "lobby" || this.state.party === null || !this.state.party?.amHost) {
      return;
    }
    const game = findExternalGame(gameId);
    if (game === undefined) {
      this.services().snapshot.addNotice("error", `Unknown game "${gameId}".`);
      this.services().snapshot.emit();
      return;
    }
    const party = this.state.party;
    try {
      const room = await game.play.createRoom();
      // Ignore room creation that finishes after the party changes.
      if (this.state.party !== party) return;
      this.state.game = {
        kind: "external",
        gameId,
        title: game.name,
        room,
        creatorMemberId: this.state.identity.memberId,
        frameEpoch: 0,
        ...playerLimitsOf(game),
      };
      this.state.selfVerified = true;
      this.state.selfVerifiedSha256 = null;
      this.state.currentSourceSha256 = null;
      this.state.registered = true;
      // The UI embeds external games directly; do not keep a Nova runtime alongside them.
      this.services().runtime.teardownRuntimeFrame();
      await this.state.party.announceExternalRoom(this.externalAnnouncement());
    } catch (error) {
      if (this.state.party !== party) return;
      this.services().snapshot.addNotice(
        "error",
        `Couldn't set up ${game.name}: ${errorMessage(error)}`,
      );
    }
    this.services().snapshot.emit();
  }

  reloadMyGame(): void {
    this.services().kinds.current().reload();
    this.services().snapshot.emit();
  }

  /** Host-only; the sender also reloads its own frame. */
  reloadAllGames(): void {
    if (!this.state.party?.amHost || this.state.party === null) {
      return;
    }
    void this.state.party.announceReloadAll().catch(() => undefined);
    this.reloadMyGame();
  }

  /** Host-only cooperative removal: the recipient must leave when it receives the kick. */
  kickMember(memberId: string): void {
    if (
      !this.state.party?.amHost ||
      this.state.party === null ||
      memberId === this.state.identity.memberId
    ) {
      return;
    }
    void this.state.party
      .kickMember(memberId, "The host removed you from the party.")
      .catch(() => undefined);
    this.state.removedMemberIds.add(memberId);
    if (this.services().snapshot.hasDisplayName(memberId)) {
      this.services().snapshot.addNotice(
        "warn",
        `${this.services().snapshot.displayNameOf(memberId)} was removed from the party.`,
      );
    }
    this.services().snapshot.emit();
  }

  dismissRemoved(): void {
    this.state.removedReason = null;
    this.state.phase = "idle";
    this.services().snapshot.emit();
  }

  /** Persist the name and update peers and the local frame without rejoining. */
  setDisplayName(name: string): void {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return;
    }
    updatePartyDisplayName(trimmed);
    this.state.identity = { ...this.state.identity, displayName: trimmed };
    const party = this.state.party;
    if (party !== null) {
      void party.announceRename(trimmed).catch(() => undefined);
    }
    this.state.runtime?.pushApiEvent({
      kind: "identity",
      player: { id: this.state.identity.memberId, name: trimmed },
    });
    this.services().snapshot.emit();
  }

  /** Force bypasses readiness, never source verification. */
  startGame(force = false): void {
    if (!this.state.party?.amHost) return;
    const state = this.services().snapshot.getState();
    if (!force && !state.canStart) {
      this.services().snapshot.addNotice(
        "warn",
        state.startBlockedReason ?? "The party is not ready to start.",
      );
      this.services().snapshot.emit();
      return;
    }
    if (force && !state.canForceStart && !state.canStart) {
      this.services().snapshot.addNotice(
        "warn",
        state.startBlockedReason ?? "The party is not ready to start.",
      );
      this.services().snapshot.emit();
      return;
    }
    this.state.endedReason = null;
    this.state.phase = "starting";
    this.state.phaseDetail = null;
    this.services().snapshot.emit();
    this.state.session?.start();
    this.beginStartRetry();
    // The session's local "start" event flips the phase to playing.
  }

  private beginStartRetry(): void {
    this.stopStartRetry();
    this.startRetryRemainingMs = START_RETRY_TIMEOUT_MS;
    this.armStartRetry();
  }

  private armStartRetry(): void {
    this.state.cancelStartRetry = this.state.schedule(() => {
      this.state.cancelStartRetry = null;
      this.onStartRetryTick();
    }, START_RETRY_INTERVAL_MS);
  }

  private onStartRetryTick(): void {
    if (this.state.phase !== "starting") {
      this.stopStartRetry();
      return;
    }
    this.startRetryRemainingMs -= START_RETRY_INTERVAL_MS;
    if (this.startRetryRemainingMs <= 0) {
      this.state.phase = "lobby";
      this.state.phaseDetail = null;
      this.state.startGaveUp = true;
      this.services().snapshot.addNotice("warn", START_GIVE_UP_MESSAGE);
      this.services().snapshot.emit();
      return;
    }
    this.state.session?.resendStartRequest();
    this.armStartRetry();
  }

  stopStartRetry(): void {
    this.state.cancelStartRetry?.();
    this.state.cancelStartRetry = null;
  }

  /** End the game for all members without leaving the party. */
  endGame(reason: "user_exit" | "host_closed" | "error" = "host_closed"): void {
    this.stopStartRetry();
    this.state.session?.end(reason);
    this.state.runtime?.destroy(reason);
    this.state.runtime = null;
    this.state.frameStarted = false;
    this.state.registered = false;
  }

  /**
   * A session belongs to one game; replace it before booting a different game.
   * Disposal detaches listeners without leaving the transport.
   */
  async replaceGameSession(party: PartySession): Promise<void> {
    this.state.unsubSession?.();
    this.state.unsubSession = null;
    this.state.session?.dispose();
    this.state.lastStateApiEvent = null;
    this.state.registered = false;
    // Read the current runtime at request time so reboots do not leave stale targets.
    // Executors belong to one session; disposal prevents pending requests crossing sessions.
    this.state.stateExecutor?.dispose();
    this.state.stateExecutor = new PartyStateExecutor(() => this.state.runtime);
    const session = createNovaSession({
      acceptStartRequest: (memberId) => this.acceptStartRequestFrom(memberId),
      transport: party.privateTransport,
      room: party.material.roomId,
      sessionId: party.material.sessionId,
      player: {
        memberId: this.state.identity.memberId,
        displayName: this.state.identity.displayName,
      },
      game: {
        gameId: this.state.game?.gameId ?? "party",
        ...(this.state.game?.title !== undefined ? { title: this.state.game.title } : {}),
      },
      stateExecutor: this.state.stateExecutor,
    });
    session.setTickRate(this.state.frameTickRate);
    this.state.session = session;
    this.state.unsubSession = session.onSessionEvent((event) => this.handleSessionEvent(event));
    await session.attach();
  }

  /**
   * NovaSession start/end are one-shot, so the next game needs a fresh session.
   * Defer disposal out of the session event loop and ignore an intervening leave.
   */
  private resetSessionForNextGame(): void {
    queueMicrotask(() => {
      if (this.state.party === null || this.state.leaving) {
        return;
      }
      void this.replaceGameSession(this.state.party).catch((error: unknown) => {
        this.services().snapshot.addNotice(
          "error",
          `The game session could not be reset: ${errorMessage(error)}`,
        );
        this.services().snapshot.emit();
      });
      this.services().snapshot.emit();
    });
  }

  private externalAnnouncement(): ExternalAnnouncement {
    const external = this.state.game;
    if (external?.kind !== "external") {
      throw new Error("externalAnnouncement called with no external game selected");
    }
    return {
      gameId: external.gameId,
      room: external.room,
      creatorMemberId: external.creatorMemberId,
    };
  }

  askForExternalRoom(): void {
    if (
      this.state.party?.amHost ||
      this.state.party === null ||
      this.state.game?.kind === "external"
    ) {
      return;
    }
    void this.state.party.requestExternalRoom().catch(() => undefined);
  }

  handlePartyEvent(event: PartyEvent): void {
    switch (event.type) {
      case "memberJoined":
        this.services().snapshot.dropLeftNotice(event.displayName);
        this.services().snapshot.emit();
        break;
      case "memberLeft":
        this.services().snapshot.noteMemberLeft(event.memberId, event.displayName);
        this.services().snapshot.emit();
        break;
      case "memberRenamed":
        // Names come from the party layer; invalidate the projected member view.
        this.services().snapshot.emit();
        break;
      case "externalRoom": {
        if (this.state.party?.amHost) {
          break;
        }
        const game = findExternalGame(event.gameId);
        if (game === undefined) {
          // A newer build's game this one doesn't list; it can't be embedded here.
          this.services().snapshot.addNotice(
            "error",
            "The host picked a game this version of Rocketcrab doesn't have. Reload to update.",
          );
          this.services().snapshot.emit();
          break;
        }
        const title = game.name;
        const current = this.state.game;
        if (
          current?.kind !== "external" ||
          current.gameId !== event.gameId ||
          !sameRoom(current.room, event.room)
        ) {
          this.state.game = {
            kind: "external",
            gameId: event.gameId,
            title,
            room: event.room,
            creatorMemberId: event.creatorMemberId,
            frameEpoch: 0,
            ...playerLimitsOf(game),
          };
          this.state.selfVerified = true;
          this.state.selfVerifiedSha256 = null;
          this.state.currentSourceSha256 = null;
          this.state.registered = true;
          this.services().snapshot.addNotice("info", `${title} has been selected for the party.`);
        }
        this.services().snapshot.emit();
        break;
      }
      case "externalRoomRequest":
        if (
          this.state.party?.amHost &&
          this.state.game?.kind === "external" &&
          this.state.party !== null
        ) {
          void this.state.party
            .announceExternalRoom(this.externalAnnouncement())
            .catch(() => undefined);
        }
        break;
      case "kick": {
        if (event.targetMemberId === this.state.identity.memberId) {
          this.state.removedReason = event.reason ?? "The host removed you from the party.";
          this.services().snapshot.addNotice("error", this.state.removedReason);
          this.services().snapshot.emit();
          void this.services().connection.leaveParty("removed");
        } else if (this.services().snapshot.hasDisplayName(event.targetMemberId)) {
          this.state.removedMemberIds.add(event.targetMemberId);
          this.services().snapshot.addNotice(
            "warn",
            `${this.services().snapshot.displayNameOf(event.targetMemberId)} was removed from the party.`,
          );
          this.services().snapshot.emit();
        } else {
          this.services().snapshot.emit();
        }
        break;
      }
      case "reloadAll":
        this.services().kinds.current().reload();
        this.services().snapshot.emit();
        break;
      case "host":
        this.services().snapshot.emit();
        this.askForExternalRoom();
        break;
      case "error": {
        const error = event.error;
        if (error instanceof PartyError && error.code === "connection_lost") {
          this.services().connection.enterReconnecting("The party connection was lost.");
          return;
        }
        this.services().snapshot.addNotice("error", errorMessage(error));
        this.services().snapshot.emit();
        break;
      }
    }
  }

  handleSessionEvent(event: NovaSessionEvent): void {
    switch (event.type) {
      case "connection":
        this.state.connectionState = "connected";
        break;
      case "start":
        this.stopStartRetry();
        // A late start supersedes the retry-timeout warning.
        this.state.notices = this.state.notices.filter(
          (notice) => notice.message !== START_GIVE_UP_MESSAGE,
        );
        this.state.startGaveUp = false;
        this.state.gameStarted = true;
        this.state.phase = "playing";
        reportConnection({
          outcome: "game-ready",
          error_code: "",
          ms_to_connect: 0,
          signaling_ok: this.state.signalingConnected === true,
        });
        this.state.phaseDetail = null;
        this.services().snapshot.addNotice("info", "The game started.");
        this.services().snapshot.emit();
        break;
      case "end":
        this.stopStartRetry();
        this.state.gameStarted = false;
        this.state.endedReason = event.reason;
        this.state.phase = "lobby";
        this.state.phaseDetail = null;
        this.services().snapshot.addNotice(
          "info",
          `The game ended${event.reason === undefined ? "." : ` (${event.reason}).`}`,
        );
        this.services().snapshot.emit();
        this.resetSessionForNextGame();
        break;
      case "playerJoined":
      case "playerLeft":
        this.services().snapshot.emit();
        break;
      case "bandwidthWarning":
        this.services().snapshot.addNotice("warn", event.message);
        break;
      case "error":
        this.services().snapshot.addNotice(
          "error",
          `Nova error (${event.error.code}): ${event.error.message}`,
        );
        this.services().snapshot.emit();
        break;
      case "ready":
        // Readiness affects the lobby start gate but is not a game-frame event.
        this.services().snapshot.emit();
        break;
      default:
        break; // raw and state events route to the frame only
    }
    // Observable events go to the frame; registration replays any snapshot missed before boot.
    const apiEvent = toApiEvent(event);
    if (apiEvent !== null) {
      // Retain the self view for frames rebooted by the lobby-to-playing container rebind.
      if (apiEvent.kind === "state") {
        this.state.lastStateApiEvent = apiEvent;
      }
      if (apiEvent.kind === "start") {
        this.services().runtime.deliverStartToFrame();
      } else {
        this.state.runtime?.pushApiEvent(apiEvent);
        if (apiEvent.kind === "state") this.services().runtime.deliverStartToFrame();
      }
    }
  }

  /** Use the same source-verification gate as the lobby, and accept requests only from the host. */
  acceptStartRequestFrom(memberId: MemberId): boolean {
    if (this.state.party?.hostMemberId !== memberId) return false;
    return this.services()
      .kinds.current()
      .allSourcesVerified(this.services().snapshot.buildMembers());
  }
}

function sameRoom(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
