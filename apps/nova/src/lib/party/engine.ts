import type { TransferState } from "./engine-model";
import type {
  PartyEngineConfig,
  PartyEngineState,
  PartyPhase,
  PartyGameSelection,
  PartySourceSpec,
  SharedPartyGameSource,
  PartyMemberView,
  PartyDiagnostics,
  PartyNotice,
} from "./engine-types";
import { PartyResources, type ExternalAnnouncement } from "./engine-resources";
import {
  GameSourceCoordinator,
  PartyError,
  createParty,
  joinPartyByInvite,
  type PartySession,
  type PartyTransportFactory,
  type PartyEvent,
  type GameSourceTransferEvent,
  buildInviteUrl,
} from "@rocketcrab/party";
import { track } from "../analytics";
import { observePartyAnalytics } from "./party-analytics";
import { reportConnection } from "../connection-analytics";
import {
  connectionErrorCategory,
  connectionErrorMessage,
  roomErrorCategory,
} from "./connection-errors";
import {
  createTrysteroPartyTransportFactory,
  type TrysteroPartyTransportFactoryOptions,
} from "./transport-factory";
import {
  TURN_CREDS_TTL_MS,
  type TurnCredentialsResult,
  type TurnServerConfigLike,
} from "./turn-creds";
import {
  UNSAFE_TEARDOWN_MESSAGE,
  errorMessage,
  PARTY_HEALTH_PROBE_TIMEOUT_MS,
  RECONNECT_RETRY_BASE_MS,
  RECONNECT_RETRY_CAP_MS,
  isInPartyPhase,
  START_RETRY_INTERVAL_MS,
  START_RETRY_TIMEOUT_MS,
  START_GIVE_UP_MESSAGE,
  SOURCE_RETRANSMIT_INTERVAL_MS,
  formatBytes,
  MAX_NOTICES,
  makeNotice,
  leftNoticeMessage,
  isConnectedState,
  defaultBaseUrl,
} from "./engine-utils";
import type { TransportConnectionState } from "@rocketcrab/core";
import { clearPartyRecovery, savePartyRecovery } from "./party-recovery";
import type { MemberId, GameApiCallMessage } from "@rocketcrab/protocol";
import { type NovaSessionEvent, createNovaSession } from "@rocketcrab/nova-api";
import { toApiEvent } from "../arena/api-events";
import { findExternalGame } from "../catalog";
import { playerLimitsOf, playerLimitNotice } from "./player-limits";
import { updatePartyDisplayName } from "./identity";
import { PartyStateExecutor } from "./party-executors";
import { RuntimeHostClient, type RuntimeHostEvent } from "../runtime-host";
import { routeFrameApiCall } from "../frame-api-calls";
import type { ArenaLogEntry } from "../arena/types";

export type {
  PartyRuntimeSeams,
  PartySecretDerivation,
  PartyMemberView,
  PartyDiagnostics,
  PartyNotice,
  PeerLinkStatus,
  PartyPhase,
  JoinStage,
  PartyEngineState,
  PartyEngineConfig,
  PartySourceSpec,
  PartyGame,
  PartyGameSelection,
  NovaPartyGame,
  ExternalPartyGame,
  SharedPartyGame,
  SharedPartyGameSource,
} from "./engine-types";

function sameRoom(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

const MAX_PARTY_LOG_ENTRIES = 200;

let partyLogCounter = 0;

/** Each kept game holds its source (up to 2 MiB), so the list is short. */
const MAX_SHARED_GAMES = 10;

/** Owns the party lifecycle and runs effects in response to party, session, and runtime events. */
export class PartyEngine {
  private readonly state: PartyResources;

  constructor(config: PartyEngineConfig = {}) {
    this.state = new PartyResources(config, () => this.emit());
    if (import.meta.env.DEV || import.meta.env.MODE === "test") {
      (globalThis as { __NOVA_PARTY_DEBUG__?: () => unknown }).__NOVA_PARTY_DEBUG__ = () =>
        this.debugSnapshot();
    }
    this.subscribeLifecycle();
  }

  /** Typed event and state probes for deterministic engine tests. */
  getTestDriver() {
    const state = this.state;
    return {
      coordinatorEvent: (event: GameSourceTransferEvent) => this.handleCoordinatorEvent(event),
      sessionEvent: (event: NovaSessionEvent) => this.handleSessionEvent(event),
      hostEvent: (event: RuntimeHostEvent) => this.handleHostEvent(event),
      forgetFrameView: () => this.state.rememberView(null),
      acceptsStartFrom: (memberId: MemberId) => this.acceptStartRequestFrom(memberId),
      get session() {
        return state.session;
      },
      get coordinator() {
        return state.coordinator;
      },
      updateTransfer: (
        memberId: MemberId,
        transfer: Pick<TransferState, "state" | "fraction" | "detail"> | null,
      ) => {
        if (transfer === null) this.state.clearTransfer(memberId);
        else this.state.recordTransfer(memberId, transfer);
        this.emit();
      },
    };
  }

  // Party setup

  /** Page-local credential lease; reuse requires at least half its lifetime remaining. */
  private turnCredsCache: {
    readonly turnConfig: readonly TurnServerConfigLike[];
    readonly expiresAt: number;
  } | null = null;

  private readonly joinErrorNoticesShown = new Set<string>();

  /** An omitted source opens an empty lobby; a supplied source is announced immediately. */
  async createParty(input?: PartySourceSpec): Promise<void> {
    if (this.state.leaveInFlight !== null && !(await this.waitForLeaveBeforeSetup())) return;
    if (this.rejectUnsafeSetup()) return;
    this.prepareSetup();
    const setup = this.state.setupAbort!;
    const identity = this.state.identity;
    this.state.lastSetup = { kind: "create", input };
    this.state.transitionPhase({ phase: "creating", detail: "Creating your private party…" });
    this.state.lastError = null;
    this.emit();
    try {
      const party = await createParty({
        memberId: identity.memberId,
        displayName: identity.displayName,
        transportFactory: this.observeSignaling(await this.resolveTransportFactory(), setup),
        ...(this.state.derive !== undefined ? { derive: this.state.derive } : {}),
      });
      if (setup.signal.aborted) {
        await party.leave().catch(() => undefined);
        return;
      }
      this.state.pendingSetupTransport = null;
      // A session belongs to one game, so set the game before attaching the session.
      this.state.selectGame(
        input === undefined ? null : { kind: "nova", gameId: input.gameId, title: input.title },
      );
      await this.establish(party);
      if (setup.signal.aborted) return;
      this.state.transitionPhase({ phase: "lobby" });

      this.state.lastSetup = null;
      this.saveRecovery();
      this.emit();
      if (input !== undefined) {
        void this.registerSource(input).catch((error: unknown) => {
          if (this.state.party !== party) return;
          this.addNotice("error", `Could not register the game: ${errorMessage(error)}`);
          this.emit();
        });
      }
    } catch (error) {
      await this.finishFailedSetup(setup, error);
    } finally {
      if (this.state.setupAbort === setup) this.state.setupAbort = null;
    }
  }

  /** Join a party from an invite-link secret. */
  async joinByInvite(input: { secret: string }): Promise<void> {
    if (this.state.leaveInFlight !== null && !(await this.waitForLeaveBeforeSetup())) return;
    if (this.rejectUnsafeSetup()) return;
    this.prepareSetup();
    const setup = this.state.setupAbort!;
    const identity = this.state.identity;
    const normalizedInput = input;
    this.state.lastSetup = { kind: "join-invite", input: normalizedInput };
    const startedAt = performance.now();
    this.state.transitionPhase({
      phase: "joining",
      joinStage: "discovering",
      detail: "Joining the party from your invite…",
    });
    this.state.lastError = null;
    this.emit();
    try {
      const party = await joinPartyByInvite({
        secret: normalizedInput.secret,
        memberId: identity.memberId,
        displayName: identity.displayName,
        transportFactory: this.observeSignaling(await this.resolveTransportFactory(), setup),
        ...(this.state.derive !== undefined ? { derive: this.state.derive } : {}),
      });
      if (setup.signal.aborted) {
        await party.leave().catch(() => undefined);
        return;
      }
      this.state.pendingSetupTransport = null;
      await this.establish(party);
      if (setup.signal.aborted) return;
      // A stale invite (host offline) must never drop the joiner into an
      // empty lobby that appears connected.
      try {
        await this.waitForPeerConnect(party, setup.signal);
      } catch (error) {
        if (this.state.party === null) {
          return; // cancelled while waiting — leaveParty already cleaned up
        }
        const lastSetup = this.state.lastSetup;
        await this.leaveParty("idle", true).catch(() => undefined);
        if (setup.signal.aborted) return;
        this.state.lastSetup = lastSetup;
        throw error;
      }
      if (this.state.party === null) {
        return; // cancelled while waiting — leaveParty already cleaned up
      }
      this.state.observedJoinFailure = null;
      reportConnection({
        outcome: "lobby-ready",
        error_code: "",
        ms_to_connect: Math.round(performance.now() - startedAt),
        signaling_ok: this.state.signalingConnected === true,
      });
      this.state.transitionPhase({ phase: "lobby" });

      this.state.lastSetup = null;
      this.saveRecovery();
      this.emit();
      void this.state.coordinator
        ?.refresh()
        .catch((error: unknown) =>
          this.addNotice("warn", `Could not ask the party for the game: ${errorMessage(error)}`),
        );
      this.askForExternalRoom();
    } catch (error) {
      if (!setup.signal.aborted) {
        reportConnection({
          outcome: "join-failed",
          error_code: "",
          ms_to_connect: Math.round(performance.now() - startedAt),
          signaling_ok: this.state.signalingConnected === true,
        });
      }
      await this.finishFailedSetup(setup, error);
    } finally {
      if (this.state.setupAbort === setup) this.state.setupAbort = null;
    }
  }

  retrySetup(): void {
    const last = this.state.lastSetup;
    if (last === null || this.state.party !== null) {
      return;
    }
    if (last.kind === "create") {
      void this.createParty(last.input);
    } else {
      void this.joinByInvite(last.input);
    }
  }

  /** Dismiss a setup error without running party teardown. */
  dismissError(): void {
    if (this.state.phase !== "error") {
      return;
    }
    this.state.lastError = null;
    this.state.setupFailureCode = null;
    this.state.observedJoinFailure = null;
    this.state.transitionPhase({ phase: "idle" });

    this.state.notices = [];
    this.emit();
  }

  private waitForLeaveBeforeSetup(): Promise<boolean> {
    const teardown = this.state.leaveInFlight;
    if (teardown === null) return Promise.resolve(true);
    this.state.cancelWaitingSetup?.();
    return new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const finish = (proceed: boolean) => {
        if (settled) return;
        settled = true;
        if (this.state.cancelWaitingSetup === cancel) this.state.cancelWaitingSetup = null;
        resolve(proceed);
      };
      const cancel = () => finish(false);
      this.state.cancelWaitingSetup = cancel;
      void teardown.then(
        () => finish(true),
        (error: unknown) => {
          if (settled) return;
          settled = true;
          if (this.state.cancelWaitingSetup === cancel) this.state.cancelWaitingSetup = null;
          reject(error);
        },
      );
    });
  }

  /** Observe the private room before join settles, and retry only relay failures. */
  private observeSignaling(
    factory: PartyTransportFactory,
    setup: AbortController,
  ): PartyTransportFactory {
    return {
      createPrivateTransport: (identity) => {
        if (setup.signal.aborted) throw new Error("Setup cancelled");
        const transport = factory.createPrivateTransport(identity);
        this.state.pendingSetupTransport = transport;
        this.state.unsubscribeSignaling?.();
        const observable = transport as typeof transport & {
          onRelayStateChange?: (handler: (connected: boolean) => void) => () => void;
        };
        this.state.unsubscribeSignaling =
          observable.onRelayStateChange?.((connected) => {
            if (typeof connected !== "boolean") return;
            this.state.signalingConnected = connected;
            this.state.signalingOutage.update(connected);
            for (const listener of this.state.signalingListeners) listener(connected);
          }) ?? null;
        if (observable.onRelayStateChange) {
          const join = transport.join;
          transport.join = async (request) => {
            try {
              for (;;) {
                if (setup.signal.aborted) throw new Error("Setup cancelled");
                try {
                  await join.call(transport, request);
                  if (setup.signal.aborted) throw new Error("Setup cancelled");
                  return;
                } catch (error) {
                  if (
                    setup.signal.aborted ||
                    connectionErrorCategory(error) !== "relay_unreachable"
                  ) {
                    throw error;
                  }
                  await this.waitForSetupRetry(setup.signal);
                }
              }
            } finally {
              transport.join = join;
            }
          };
        }
        return transport;
      },
    };
  }

  private waitForSetupRetry(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        cancel();
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const cancel = this.state.schedule(finish, 1_000);
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) finish();
    });
  }

  private stopObservingSignaling(): void {
    this.state.unsubscribeSignaling?.();
    this.state.unsubscribeSignaling = null;
    this.state.signalingConnected = null;
    this.state.signalingOutage.reset();
  }

  /** Injected factories own credential setup. Mint failures do not block the real transport. */
  private async resolveTransportFactory(): Promise<PartyTransportFactory> {
    const injected = this.state.defaults.transportFactory;
    if (injected !== null) {
      return injected;
    }
    const setup = this.state.setupAbort;
    const scope = {};
    this.state.activeErrorScope = scope;
    const options: TrysteroPartyTransportFactoryOptions = {
      onJoinError: (error: unknown) => {
        if (this.state.activeErrorScope !== scope || setup?.signal.aborted) return;
        if (
          setup !== null &&
          this.state.setupAbort === setup &&
          !setup.signal.aborted &&
          this.state.phase === "joining" &&
          !this.state.setupPeerAdmitted &&
          (this.state.party === null || this.state.party.privateTransport.peers.length === 0) &&
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error.code === "room-full" || error.code === "decrypt-failed")
        ) {
          this.state.observedJoinFailure = error.code;
        }
        this.handleJoinErrorNotice(error);
      },
      onTunnel: (info) => {
        if (this.state.activeErrorScope !== scope || setup?.signal.aborted) return;
        track("nova_tunnel", { outcome: "fallback", error_code: info.reason });
        this.state.peerLink.switched();
      },
      onTunnelFailure: (info) => {
        if (this.state.activeErrorScope !== scope || setup?.signal.aborted) return;
        track("nova_tunnel", { outcome: "failed", error_code: info.reason });
        this.state.peerLink.failed();
      },
    };
    const result = await this.fetchTurnCredentialsOnce();
    if (result.ok) {
      this.state.turnStatus = "configured";
      return createTrysteroPartyTransportFactory({ ...options, turnConfig: result.turnConfig });
    }
    // Mint failures fall back to the tunnel without a lobby notice; diagnostics retain TURN status.
    this.state.turnStatus = "unavailable";
    return createTrysteroPartyTransportFactory(options);
  }

  private handleJoinErrorNotice(error: unknown): void {
    const category = connectionErrorCategory(error) ?? "unknown";
    // Relay outages have a dedicated timed, self-clearing status instead of
    // a persistent notice that would remain after the socket reconnects.
    if (category === "relay_unreachable") return;
    if (category === "incompatible_version") {
      if (this.joinErrorNoticesShown.has(category)) return;
      this.joinErrorNoticesShown.add(category);
      this.addNotice(
        "warn",
        "Incompatible Nova version. Everyone should update/reload Nova and rejoin the party.",
      );
      this.emit();
      return;
    }
    // Peer-connect-failed is not terminal: fallback may still succeed.
    // Only a terminal tunnel failure raises the peer-link alert.
    if (category === "peer_connection_failed") return;
    if (roomErrorCategory(error) !== null) {
      if (this.joinErrorNoticesShown.has(category)) return;
      this.joinErrorNoticesShown.add(category);
      const message =
        category === "room_full"
          ? "A player reported the party may be full. This affects a connection to that player and doesn't necessarily mean you can't stay in the party."
          : category === "password_mismatch"
            ? "A message from another player couldn't be decrypted. It may be damaged or use a different invite; you may still be connected to the party."
            : connectionErrorMessage(error);
      this.addNotice("warn", message);
      this.emit();
    }
  }

  /** Require half the credential lease to remain so a late-started party has time to use it. */
  private async fetchTurnCredentialsOnce(): Promise<TurnCredentialsResult> {
    if (
      this.turnCredsCache !== null &&
      this.state.now() < this.turnCredsCache.expiresAt - TURN_CREDS_TTL_MS / 2
    ) {
      return { ok: true, turnConfig: this.turnCredsCache.turnConfig };
    }
    const requestedAt = this.state.now();
    const result = await this.state.defaults.turnCreds();
    track("turn_cred_mint", { outcome: result.ok ? "configured" : "unavailable" });
    if (result.ok) {
      this.turnCredsCache = {
        turnConfig: result.turnConfig,
        expiresAt: requestedAt + TURN_CREDS_TTL_MS,
      };
    }
    return result;
  }

  private async establish(party: PartySession): Promise<void> {
    this.state.party = party;
    this.state.identity = { ...this.state.identity, memberId: party.memberId };
    this.state.connectionState = party.privateTransport.connectionState;
    this.state.unsubParty = party.onEvent((event) => this.handlePartyEvent(event));
    this.state.unsubTransport = [
      party.privateTransport.on("connection:state", (state) => this.handleTransportState(state)),
      party.privateTransport.on("peer:joined", () => this.state.peerLink.peerJoined()),
      ...this.subscribeRelayState(party),
    ];
    this.state.coordinator = new GameSourceCoordinator({
      transport: party.privateTransport,
      acceptMetadata: (metadata, from) => {
        if (from === party.hostMemberId) return true;
        const current = this.state.game;
        return current?.kind === "nova" &&
          current.gameId === metadata.gameId &&
          this.state.currentSourceSha256 === metadata.sourceSha256
          ? "cached"
          : false;
      },
    });
    this.state.unsubCoordinator = this.state.coordinator.subscribe((event) =>
      this.handleCoordinatorEvent(event),
    );
    await this.replaceGameSession(party);
  }

  /** The optional adapter hook replays relay state immediately; other transports need no subscription. */
  private subscribeRelayState(party: PartySession): Array<() => void> {
    const transport = party.privateTransport as unknown as {
      onRelayStateChange?: (handler: () => void) => () => void;
    };
    if (typeof transport.onRelayStateChange !== "function") {
      return [];
    }
    return [transport.onRelayStateChange(() => this.emit())];
  }

  private failSetup(error: unknown): void {
    const directCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "room-full" || error.code === "decrypt-failed")
        ? error.code
        : null;
    this.state.setupFailureCode =
      this.state.lastSetup?.kind === "join-invite" && !this.state.setupPeerAdmitted
        ? (directCode ??
          (error instanceof PartyError && error.code === "peer_unreachable"
            ? this.state.observedJoinFailure
            : null))
        : null;
    this.state.observedJoinFailure = null;
    this.state.lastError =
      directCode === null
        ? connectionErrorMessage(error)
        : "Couldn't connect to the party. Try again.";
    this.state.peerLink.clear();
    this.state.transitionPhase({ phase: "error" });

    this.emit();
  }

  /**
   * Signaling alone is not a successful join: wait for a peer or fail setup.
   * Creators skip this gate because a solo host lobby is valid.
   */
  private waitForPeerConnect(party: PartySession, signal: AbortSignal): Promise<void> {
    if (party.role === "creator" || party.privateTransport.peers.length > 0) {
      this.state.setupPeerAdmitted = true;
      this.state.observedJoinFailure = null;
      return Promise.resolve();
    }
    this.state.transitionPhase({
      phase: "joining",
      joinStage: "connecting",
      detail: "Connecting to the host…",
    });
    this.emit();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let remaining = this.state.defaults.peerConnectTimeoutMs;
      let startedAt = 0;
      let cancel: (() => void) | null = null;
      const cleanup = () => {
        cancel?.();
        cancel = null;
        unsubscribe();
        this.state.signalingListeners.delete(onSignaling);
        signal.removeEventListener("abort", onAbort);
      };
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => finish(new Error("Setup cancelled"));
      const onSignaling = (connected: boolean) => {
        if (!connected) {
          if (cancel !== null) {
            cancel();
            cancel = null;
            remaining = Math.max(0, remaining - (this.state.now() - startedAt));
          }
        } else if (cancel === null && !settled) {
          startedAt = this.state.now();
          cancel = this.state.schedule(() => {
            finish(
              new PartyError(
                "peer_unreachable",
                "Couldn't reach anyone in this party. It may have ended, or your networks may need a TURN relay. Ask a friend to confirm they are still connected and try again.",
              ),
            );
          }, remaining);
        }
      };
      const unsubscribe = party.privateTransport.on("peer:joined", () => {
        this.state.setupPeerAdmitted = true;
        this.state.observedJoinFailure = null;
        finish();
      });
      this.state.signalingListeners.add(onSignaling);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      else if (this.state.signalingConnected !== false) onSignaling(true);
    });
  }

  private async finishFailedSetup(setup: AbortController, error: unknown): Promise<void> {
    if (setup.signal.aborted) return;
    this.state.activeErrorScope = null;
    const transport = this.state.pendingSetupTransport;
    if (transport !== null) {
      try {
        await transport.leave();
      } catch {
        this.state.teardownFailed = true;
      }
    }
    if (setup.signal.aborted) return;
    // Setup can fail after joining; leave this member's room without ending the other players' party.
    if (this.state.party !== null) {
      const lastSetup = this.state.lastSetup;
      await this.leaveParty("idle", true).catch(() => undefined);
      this.state.lastSetup = lastSetup;
    }
    this.state.pendingSetupTransport = null;
    this.stopObservingSignaling();
    if (!this.rejectUnsafeSetup()) this.failSetup(error);
  }

  private rejectUnsafeSetup(): boolean {
    if (!this.state.teardownFailed) return false;
    this.state.transitionPhase({ phase: "error" });
    this.state.lastError = UNSAFE_TEARDOWN_MESSAGE;
    this.emit();
    return true;
  }

  private prepareSetup(): void {
    if (this.state.setupAbort !== null) {
      throw new PartyError("invalid_state", "Party setup is already in progress.");
    }
    // A failed setup may retry, but an established party must leave first.
    if (this.state.party !== null || this.state.session !== null) {
      throw new PartyError(
        "invalid_state",
        "A party is already active on this page; leave it before starting another.",
      );
    }
    this.stopObservingSignaling();
    this.joinErrorNoticesShown.clear();
    this.state.setupAbort = new AbortController();
    this.state.activeErrorScope = null;
    this.state.observedJoinFailure = null;
    this.state.setupFailureCode = null;
    this.state.setupPeerAdmitted = false;
    this.state.leaving = false;
    this.state.lastError = null;
    this.state.transitionPhase({ phase: "idle" });

    this.state.notices = [];
    this.emit();
  }

  // Connection and teardown

  private readonly lifecycleUnsubscribers: Array<() => void> = [];

  private pageWasHidden = false;

  private reconnectInFlight: Promise<void> | null = null;

  private resumeCheckInFlight = false;

  private reconnectRetryTimer: (() => void) | null = null;

  /** Includes setup and error phases, not just an established session. */
  isActive(): boolean {
    return this.state.phase !== "idle" || this.state.party !== null;
  }

  /** Resolve after teardown. Kicked members use "removed" to avoid flashing the entry UI. */
  leaveParty(nextPhase: PartyPhase = "idle", preserveSetup = false): Promise<void> {
    this.stopStartRetry();
    this.stopSourceRetransmit();
    this.state.activeErrorScope = null;
    if (!preserveSetup) {
      this.state.observedJoinFailure = null;
      this.state.setupFailureCode = null;
      this.state.cancelWaitingSetup?.();
    }
    if (this.state.leaveInFlight !== null) {
      if (!preserveSetup) {
        this.state.setupAbort?.abort();
        this.state.setupAbort = null;
      }
      return this.state.leaveInFlight;
    }
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    this.state.leaveInFlight = promise;
    void this.runLeaveParty(nextPhase, preserveSetup).then(
      () => {
        if (this.state.leaveInFlight === promise) this.state.leaveInFlight = null;
        resolve();
      },
      (error: unknown) => {
        if (this.state.leaveInFlight === promise) this.state.leaveInFlight = null;
        reject(error);
      },
    );
    return promise;
  }

  private async runLeaveParty(nextPhase: PartyPhase, preserveSetup: boolean): Promise<void> {
    if (!this.isActive()) {
      return;
    }
    this.state.leaving = true;
    this.stopGameSwitch();
    if (!preserveSetup) {
      this.state.setupAbort?.abort();
      this.state.setupAbort = null;
    }
    const pendingTransport = this.state.pendingSetupTransport;
    this.state.pendingSetupTransport = null;
    const pendingTeardown = pendingTransport?.leave().then(
      () => true,
      () => false,
    );
    this.stopObservingSignaling();
    this.state.runtime?.destroy("user_exit");
    this.state.runtime = null;
    this.state.resetFrame();
    if (this.state.unsubSession !== null) {
      this.state.unsubSession();
      this.state.unsubSession = null;
    }
    this.state.session?.dispose();
    this.state.session = null;
    this.state.unsubCoordinator?.();
    this.state.unsubCoordinator = null;
    this.state.coordinator?.dispose();
    this.state.coordinator = null;
    for (const unsubscribe of this.state.unsubTransport) {
      unsubscribe();
    }
    this.state.unsubTransport = [];
    this.state.unsubParty?.();
    this.state.unsubParty = null;
    const party = this.state.party;
    this.state.party = null;
    if (party !== null) {
      try {
        await party.leave();
      } catch {
        this.state.teardownFailed = true;
      }
    }
    if ((await pendingTeardown) === false) this.state.teardownFailed = true;
    this.state.stateExecutor?.dispose();
    this.state.stateExecutor = null;
    this.state.rememberView(null);
    this.state.sharedGames.clear();
    this.state.sourceApiVersions.clear();
    this.state.runtimeLogs = [];
    this.state.clearGame();
    this.state.notices = [];
    this.state.removedMemberIds.clear();
    this.state.peerLink.clear();
    this.state.lastError = this.state.teardownFailed ? UNSAFE_TEARDOWN_MESSAGE : null;
    this.state.lastSetup = null;
    this.state.finishLeaving(this.state.teardownFailed ? "error" : nextPhase);

    this.state.reconnectAttempts = 0;
    this.pageWasHidden = false;
    this.reconnectInFlight = null;
    this.cancelReconnectRetry();
    clearPartyRecovery();
    this.state.leaving = false;
    this.emit();
  }

  /**
   * Single-flight across user actions, lifecycle events, and timers.
   * Also replaces connected-looking transports whose peers no longer answer.
   */
  reconnect(): Promise<void> {
    if (this.reconnectInFlight !== null) return this.reconnectInFlight;
    this.cancelReconnectRetry();
    const attempt = this.runReconnect().finally(() => {
      if (this.reconnectInFlight === attempt) this.reconnectInFlight = null;
    });
    this.reconnectInFlight = attempt;
    return attempt;
  }

  private async runReconnect(): Promise<void> {
    const transport = this.state.party?.privateTransport;
    if (transport === undefined || this.state.leaving) {
      return;
    }
    this.state.peerLink.clear();
    this.state.reconnectAttempts += 1;
    this.state.transitionPhase({
      phase: "reconnecting",
      detail: `Reconnecting… (attempt ${this.state.reconnectAttempts})`,
    });
    this.emit();
    const party = this.state.party;
    if (party === null) {
      return;
    }
    try {
      if (transport.connectionState === "connected") {
        // A connected-looking transport may still have dead peer links.
        await transport.reconnect();
      } else if (transport.connectionState === "suspended") {
        await transport.resume();
      } else if (
        transport.connectionState === "idle" ||
        transport.connectionState === "disconnected"
      ) {
        // Failed joins may leave an idle transport; reuse the invite material with a fresh connection.
        await transport.join({
          room: party.material.roomId,
          sessionId: party.material.sessionId,
        });
      } else {
        return;
      }
      // Transport state events settle the phase after a successful attempt.
    } catch (error) {
      if (this.state.leaving || this.state.party !== party) return;
      this.addNotice("error", `Reconnect failed: ${connectionErrorMessage(error)}`);
      this.state.transitionPhase({
        phase: "reconnecting",
        detail: `Reconnect failed (attempt ${this.state.reconnectAttempts}) — will retry automatically.`,
      });
      this.emit();
      this.scheduleReconnectRetry();
    }
  }

  private subscribeLifecycle(): void {
    this.lifecycleUnsubscribers.push(
      this.state.lifecycle.onVisibilityChange((hidden) => {
        if (hidden) {
          this.handlePageHidden();
        } else {
          this.handlePageResumed();
        }
      }),
      this.state.lifecycle.onPageHide(() => this.handlePageHidden()),
      this.state.lifecycle.onPageShow(() => this.handlePageResumed()),
      this.state.lifecycle.onOnline(() => this.handleOnline()),
      this.state.lifecycle.onOffline(() => this.handleOffline()),
    );
  }

  private handlePageHidden(): void {
    this.pageWasHidden = true;
    // A hidden phone may be suspended: hand off authority before it is.
    this.state.session?.setAway(true);
    // Hidden-page timers are unreliable; resume probing decides when to retry.
    this.cancelReconnectRetry();
  }

  /** Resume must check peer liveness even if the transport still reports connected. */
  private handlePageResumed(): void {
    this.pageWasHidden = false;
    this.state.session?.setAway(false);
    if (this.state.leaving) {
      return;
    }
    if (!isInPartyPhase(this.state.phase)) {
      return;
    }
    this.recoverRuntimeAfterResume();
    this.checkPartyConnectionAfterResume();
  }

  private handleOffline(): void {
    if (this.state.leaving || !isInPartyPhase(this.state.phase)) {
      return;
    }
    if (this.state.phase === "reconnecting") {
      this.scheduleReconnectRetry();
    } else {
      this.enterReconnecting("You're offline. Nova will reconnect when the network returns.");
    }
  }

  private handleOnline(): void {
    if (this.state.leaving || this.state.phase !== "reconnecting") {
      return;
    }
    this.addNotice("info", "You're back online — reconnecting.");
    void this.reconnect();
  }

  private checkPartyConnectionAfterResume(): void {
    // visibilitychange and pageshow may describe the same resume; probe once.
    if (this.resumeCheckInFlight) return;
    this.resumeCheckInFlight = true;
    void this.runResumeCheck().finally(() => {
      this.resumeCheckInFlight = false;
    });
  }

  private async runResumeCheck(): Promise<void> {
    const transport = this.state.party?.privateTransport;
    if (transport === undefined || this.state.leaving) {
      return;
    }
    if (transport.connectionState === "suspended" || transport.connectionState === "disconnected") {
      this.enterReconnecting(
        "Your connection was suspended while the page was in the background. Reconnecting…",
      );
      void this.reconnect();
      return;
    }
    if (transport.connectionState !== "connected") {
      // Hiding cancels retries; an idle transport needs a new attempt on resume.
      if (transport.connectionState === "idle" && this.state.phase === "reconnecting") {
        void this.reconnect();
      }
      return; // joining: the state handler settles it
    }
    const peers = transport.peers;
    if (peers.length === 0) {
      return; // solo member: nothing to probe
    }
    const ping = (
      transport as unknown as { ping?: (connectionId: string) => Promise<number | null> }
    ).ping;
    if (typeof ping !== "function") {
      return; // This adapter has no liveness probe.
    }
    const connectionId = transport.selfConnectionId;
    const answers = await Promise.all(
      peers.map((peer) => this.probePeer(ping, transport, peer.connectionId)),
    );
    // A probe still running after leave or reconnect describes the old link.
    if (
      this.pageWasHidden ||
      this.state.leaving ||
      this.state.party?.privateTransport !== transport ||
      transport.selfConnectionId !== connectionId ||
      transport.connectionState !== "connected" ||
      answers.some((alive) => alive)
    )
      return;
    this.addNotice(
      "warn",
      "Your phone's connection went quiet in the background — reconnecting with a fresh connection.",
    );
    this.enterReconnecting("Your connection went quiet in the background. Reconnecting…");
    void this.reconnect();
  }

  /** Bound the probe even when the transport's ping promise never settles. */
  private probePeer(
    ping: (connectionId: string) => Promise<number | null>,
    transport: unknown,
    connectionId: string,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (alive: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        cancel();
        resolve(alive);
      };
      const cancel = this.state.schedule(() => finish(false), PARTY_HEALTH_PROBE_TIMEOUT_MS);
      void Promise.resolve(ping.call(transport, connectionId))
        .then((pingMs) => finish(pingMs !== null))
        .catch(() => finish(false));
    });
  }

  private scheduleReconnectRetry(): void {
    if (this.state.leaving) {
      return;
    }
    this.cancelReconnectRetry();
    const delayMs = Math.min(
      RECONNECT_RETRY_CAP_MS,
      RECONNECT_RETRY_BASE_MS * 2 ** Math.max(0, this.state.reconnectAttempts - 1),
    );
    this.reconnectRetryTimer = this.state.schedule(() => {
      this.reconnectRetryTimer = null;
      if (this.state.leaving || this.state.phase !== "reconnecting") {
        return;
      }
      this.addNotice("info", "Retrying the connection automatically…");
      void this.reconnect();
    }, delayMs);
  }

  private cancelReconnectRetry(): void {
    if (this.reconnectRetryTimer !== null) {
      this.reconnectRetryTimer();
      this.reconnectRetryTimer = null;
    }
  }

  private handleTransportState(state: TransportConnectionState): void {
    this.state.connectionState = state;
    if (this.state.leaving) {
      return;
    }
    if (state === "suspended" || state === "disconnected") {
      if (
        this.state.phase !== "idle" &&
        this.state.phase !== "joining" &&
        this.state.phase !== "creating"
      ) {
        this.enterReconnecting("The party connection was lost. Reconnect to keep playing.");
      }
      return;
    }
    if (state === "connected") {
      // Signaling may connect before any data channel. The setup peer gate,
      // not this transport event, decides when a joiner reaches the lobby.
      if (this.state.phase === "joining" || this.state.phase === "creating") {
        return;
      }
      this.state.reconnectAttempts = 0;
      this.cancelReconnectRetry();
      // Followers receive start without setting session.isStarted().
      if (this.cancelGameSwitch !== null) this.state.transitionPhase({ phase: "switching" });
      else this.state.returnToLobbyOrGame();
      this.emit();
      void this.state.coordinator
        ?.refresh()
        .catch((error: unknown) =>
          this.addNotice("warn", `Could not ask the party for the game: ${errorMessage(error)}`),
        );
      this.askForExternalRoom();
    }
  }

  private enterReconnecting(detail: string): void {
    if (this.state.phase === "reconnecting") {
      return;
    }
    this.state.transitionPhase({ phase: "reconnecting", detail: detail });
    this.emit();
    this.scheduleReconnectRetry();
  }

  /** Persist invite material, identity, and game selection for rejoin after a page reload. */
  private saveRecovery(): void {
    const party = this.state.party;
    if (party === null) {
      return;
    }
    savePartyRecovery({
      role: party.role,
      secret: party.secret,
      displayName: this.state.identity.displayName,
      game:
        this.state.game === null
          ? null
          : {
              gameId: this.state.game.gameId,
              title: this.state.game.title,
            },
    });
  }

  // Game and session lifecycle

  private startRetryRemainingMs = 0;
  private cancelGameSwitch: (() => void) | null = null;

  private beginGameSwitch(): void {
    this.stopGameSwitch();
    this.state.beginSwitch();
    this.cancelGameSwitch = this.state.schedule(() => {
      this.stopGameSwitch();
      this.state.timeOutStart();
      this.addNotice(
        "warn",
        "The new game took too long to start. Try starting it from the lobby.",
      );
      this.emit();
    }, START_RETRY_TIMEOUT_MS);
  }

  private stopGameSwitch(): void {
    this.cancelGameSwitch?.();
    this.cancelGameSwitch = null;
  }

  /** The host can pick a game in the lobby or replace a running game. */
  async selectGame(selection: PartyGameSelection): Promise<void> {
    const party = this.state.party;
    if (!party?.amHost) return;
    if (this.state.phase !== "lobby" && this.state.phase !== "playing") {
      throw new Error("Wait for the party to finish connecting or starting, then try again.");
    }
    if (selection.kind === "external") {
      await this.selectExternalGame(party, selection.gameId);
      return;
    }
    if (this.state.phase === "playing") this.beginGameSwitch();
    const { kind: _kind, ...input } = selection;
    this.state.selectGame({ kind: "nova", gameId: input.gameId, title: input.title });
    this.teardownRuntimeFrame();
    // Previous-game verification must not open the new game's start gate.
    this.state.resetSource();
    try {
      await this.replaceGameSession(party);
      if (this.state.party !== party) return;
      this.emit();
      await this.registerSource(input);
    } catch (error) {
      if (this.state.party === party && this.cancelGameSwitch !== null) {
        this.stopGameSwitch();
        this.state.timeOutStart();
        this.emit();
      }
      throw error;
    }
  }

  /** Create one external room and share it with all players. */
  private async selectExternalGame(party: PartySession, gameId: string): Promise<void> {
    const game = findExternalGame(gameId);
    if (game === undefined) throw new Error(`Unknown game "${gameId}".`);

    const phase = this.state.phase;
    try {
      const room = await game.play.createRoom();
      if (this.state.party !== party || !party.amHost || this.state.leaving) return;
      if (this.state.phase !== phase) {
        throw new Error("The party changed while setting up the room. Try again.");
      }
      const announcement = { gameId, room, creatorMemberId: this.state.identity.memberId };
      await party.announceExternalRoom(announcement);
      if (this.state.party !== party || this.state.leaving) return;
      const switching = this.state.phase === "playing";
      if (switching) this.beginGameSwitch();
      this.state.selectGame({
        kind: "external",
        ...announcement,
        title: game.name,
        frameEpoch: 0,
        ...playerLimitsOf(game),
      });
      this.state.coordinator?.clearSelection();
      this.state.resetSource();
      this.teardownRuntimeFrame();
      if (switching) await this.replaceGameSession(party);
      if (this.state.party !== party || this.state.leaving) return;
      this.state.verifyLocalSource(null);
      this.state.registerFrame(this.state.frameTickRate);
      this.emit();
    } catch (error) {
      if (this.state.party !== party || this.state.leaving) return;
      throw new Error(`Couldn't set up ${game.name}: ${errorMessage(error)}`, { cause: error });
    }
  }

  reloadMyGame(): void {
    this.reloadSelectedGame();
    this.emit();
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
    if (this.hasDisplayName(memberId)) {
      this.addNotice("warn", `${this.displayNameOf(memberId)} was removed from the party.`);
    }
    this.emit();
  }

  dismissRemoved(): void {
    this.state.removedReason = null;
    this.state.transitionPhase({ phase: "idle" });
    this.emit();
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
    this.emit();
  }

  /** Force bypasses readiness, never source verification. */
  startGame(force = false): void {
    if (!this.state.party?.amHost) return;
    const state = this.getState();
    if (!force && !state.canStart) {
      this.addNotice("warn", state.startBlockedReason ?? "The party is not ready to start.");
      this.emit();
      return;
    }
    if (force && !state.canForceStart && !state.canStart) {
      this.addNotice("warn", state.startBlockedReason ?? "The party is not ready to start.");
      this.emit();
      return;
    }
    this.state.requestStart();
    this.emit();
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
      this.stopGameSwitch();
      this.state.timeOutStart();
      track("party_issue", { outcome: "start-timeout" });
      this.addNotice("warn", START_GIVE_UP_MESSAGE);
      this.emit();
      return;
    }
    this.state.session?.resendStartRequest();
    this.armStartRetry();
  }

  private stopStartRetry(): void {
    this.state.cancelStartRetry?.();
    this.state.cancelStartRetry = null;
  }

  /** End the game for all members without leaving the party. */
  endGame(reason: "user_exit" | "host_closed" | "error" = "host_closed"): void {
    this.stopStartRetry();
    this.state.session?.end(reason);
    this.state.runtime?.destroy(reason);
    this.state.runtime = null;
    this.state.resetFrame();
  }

  /**
   * A session belongs to one game; replace it before booting a different game.
   * Disposal detaches listeners without leaving the transport.
   */
  private async replaceGameSession(party: PartySession): Promise<void> {
    this.state.unsubSession?.();
    this.state.unsubSession = null;
    this.state.session?.dispose();
    this.state.resetSessionView();
    // Read the current runtime at request time so reboots do not leave stale targets.
    // Executors belong to one session; disposal prevents pending requests crossing sessions.
    this.state.stateExecutor?.dispose();
    this.state.stateExecutor = new PartyStateExecutor(() => this.state.runtime);
    const session = createNovaSession({
      isHost: (memberId) => party.hostMemberId === memberId,
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
    const endedSession = this.state.session;
    queueMicrotask(() => {
      if (this.state.party === null || this.state.leaving || this.state.session !== endedSession) {
        return;
      }
      void this.replaceGameSession(this.state.party).catch((error: unknown) => {
        this.addNotice("error", `The game session could not be reset: ${errorMessage(error)}`);
        this.emit();
      });
      this.emit();
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

  private askForExternalRoom(): void {
    if (
      this.state.party?.amHost ||
      this.state.party === null ||
      this.state.game?.kind === "external"
    ) {
      return;
    }
    void this.state.party.requestExternalRoom().catch(() => undefined);
  }

  private handlePartyEvent(event: PartyEvent): void {
    switch (event.type) {
      case "memberJoined":
        this.dropLeftNotice(event.displayName);
        this.emit();
        break;
      case "memberLeft":
        this.noteMemberLeft(event.memberId, event.displayName);
        this.emit();
        break;
      case "memberRenamed":
        // Names come from the party layer; invalidate the projected member view.
        this.emit();
        break;
      case "externalRoom": {
        if (this.state.party?.amHost) {
          break;
        }
        const game = findExternalGame(event.gameId);
        if (game === undefined) {
          // A newer build's game this one doesn't list; it can't be embedded here.
          this.addNotice(
            "error",
            "The host picked a game this version of Rocketcrab doesn't have. Reload to update.",
          );
          this.emit();
          break;
        }
        const title = game.name;
        const current = this.state.game;
        if (
          current?.kind !== "external" ||
          current.gameId !== event.gameId ||
          !sameRoom(current.room, event.room)
        ) {
          const switching = this.state.phase === "playing";
          if (switching) this.beginGameSwitch();
          this.state.selectGame({
            kind: "external",
            gameId: event.gameId,
            title,
            room: event.room,
            creatorMemberId: event.creatorMemberId,
            frameEpoch: 0,
            ...playerLimitsOf(game),
          });
          this.state.coordinator?.clearSelection();
          this.teardownRuntimeFrame();
          if (switching && this.state.party !== null) {
            void this.replaceGameSession(this.state.party).catch((error: unknown) => {
              this.addNotice(
                "error",
                `The game session could not be configured: ${errorMessage(error)}`,
              );
              this.emit();
            });
          }
          this.state.resetSource();
          this.state.verifyLocalSource(null);
          this.state.registerFrame(this.state.frameTickRate);
          this.addNotice("info", `${title} has been selected for the party.`);
        }
        this.emit();
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
          this.addNotice("error", this.state.removedReason);
          this.emit();
          void this.leaveParty("removed");
        } else if (this.hasDisplayName(event.targetMemberId)) {
          this.state.removedMemberIds.add(event.targetMemberId);
          this.addNotice(
            "warn",
            `${this.displayNameOf(event.targetMemberId)} was removed from the party.`,
          );
          this.emit();
        } else {
          this.emit();
        }
        break;
      }
      case "reloadAll":
        this.reloadSelectedGame();
        this.emit();
        break;
      case "host":
        if (event.hostMemberId !== null && this.state.currentSourceSha256 === null) {
          void this.state.coordinator?.refresh().catch((error: unknown) => {
            this.addNotice("error", errorMessage(error));
            this.emit();
          });
        }
        this.emit();
        this.askForExternalRoom();
        break;
      case "error": {
        const error = event.error;
        if (error instanceof PartyError && error.code === "connection_lost") {
          this.enterReconnecting("The party connection was lost.");
          return;
        }
        this.addNotice("error", errorMessage(error));
        this.emit();
        break;
      }
    }
  }

  private handleSessionEvent(event: NovaSessionEvent): void {
    switch (event.type) {
      case "connection":
        this.state.connectionState = "connected";
        break;
      case "start":
        this.stopGameSwitch();
        this.stopStartRetry();
        // A late start supersedes the retry-timeout warning.
        this.state.notices = this.state.notices.filter(
          (notice) => notice.message !== START_GIVE_UP_MESSAGE,
        );
        this.state.receiveStart();
        reportConnection({
          outcome: "game-ready",
          error_code: "",
          ms_to_connect: 0,
          signaling_ok: this.state.signalingConnected === true,
        });

        this.addNotice("info", "The game started.");
        this.emit();
        break;
      case "end":
        this.stopGameSwitch();
        this.stopStartRetry();
        this.state.receiveEnd(event.reason);
        this.addNotice(
          "info",
          `The game ended${event.reason === undefined ? "." : ` (${event.reason}).`}`,
        );
        this.emit();
        this.resetSessionForNextGame();
        break;
      case "playerJoined":
      case "playerLeft":
        this.emit();
        break;
      case "bandwidthWarning":
        this.addNotice("warn", event.message);
        break;
      case "error":
        this.addNotice("error", `Nova error (${event.error.code}): ${event.error.message}`);
        this.emit();
        break;
      case "ready":
        // Readiness affects the lobby start gate but is not a game-frame event.
        this.emit();
        break;
      default:
        break; // raw and state events route to the frame only
    }
    // Observable events go to the frame; registration replays any snapshot missed before boot.
    const apiEvent = toApiEvent(event);
    if (apiEvent !== null) {
      // Retain the self view for frames rebooted by the lobby-to-playing container rebind.
      if (apiEvent.kind === "state") {
        this.state.rememberView(apiEvent);
      }
      if (apiEvent.kind === "start") {
        this.deliverStartToFrame();
      } else {
        this.state.runtime?.pushApiEvent(apiEvent);
        if (apiEvent.kind === "state") this.deliverStartToFrame();
      }
    }
  }

  /** Use the same source-verification gate as the lobby, and accept requests only from the host. */
  private acceptStartRequestFrom(memberId: MemberId): boolean {
    if (this.state.party?.hostMemberId !== memberId) return false;
    return this.allSourcesVerified(this.buildMembers());
  }

  // Runtime frame

  setContainer(element: HTMLElement | null): void {
    if (element === this.state.container) {
      return;
    }
    // Lobby-to-playing transitions rebind the container. A non-null replacement
    // invalidates the old iframe; a null detach leaves teardown to the leave path.
    if (element !== null && this.state.runtime !== null) {
      this.state.runtime.dispose();
      this.state.runtime = null;
      this.state.resetFrame();
    }
    this.state.container = element;
    void this.maybeBootFrame();
  }

  private recoverRuntimeAfterResume(): void {
    const runtime = this.state.runtime;
    if (runtime === null || this.state.leaving) {
      return;
    }
    const diagnostic = runtime.diagnose();
    if (diagnostic.ready && !diagnostic.unresponsive) {
      return;
    }
    this.addNotice(
      "warn",
      "Your game's runtime was suspended while the page was away — reloading it.",
    );
    this.emit();
    this.state.resetFrame();
    void runtime.restart().catch((error: unknown) => {
      this.addNotice("error", `The game could not be reloaded: ${errorMessage(error)}`);
      this.emit();
    });
  }

  /** External games use the UI-owned iframe; keep the party and coordinator alive. */
  private teardownRuntimeFrame(): void {
    this.state.runtime?.destroy("user_exit");
    this.state.runtime = null;
    this.state.resetFrame();
    this.state.stageSource(null);
  }

  private reloadRuntimeFrame(): void {
    this.state.requestReload();
    this.state.runtime?.reload();
  }

  private async maybeBootFrame(): Promise<void> {
    // Leaving clears the frame before its async teardown ends; a rebind in that
    // window must not boot a frame nobody will tear down.
    if (this.state.runtime !== null || this.state.container === null || this.state.leaving) {
      return;
    }
    const source = this.state.pendingSource;
    if (source === null) {
      return;
    }

    const client = new RuntimeHostClient({
      runtimeOrigin: this.state.defaults.runtimeOrigin,
      container: this.state.container,
      onEvent: (event) => this.handleHostEvent(event),
      ...(this.state.defaults.seams.createChannel !== undefined
        ? { createChannel: this.state.defaults.seams.createChannel }
        : {}),
      ...(this.state.defaults.seams.waitForFrameLoad !== undefined
        ? { waitForFrameLoad: this.state.defaults.seams.waitForFrameLoad }
        : {}),
      ...(this.state.defaults.seams.bootstrapTimeoutMs !== undefined
        ? { bootstrapTimeoutMs: this.state.defaults.seams.bootstrapTimeoutMs }
        : {}),
    });
    this.state.runtime = client;
    this.state.resetFrame();
    try {
      await client.load({
        gameId: source.gameId,
        gameSource: source.source,
        player: {
          memberId: this.state.identity.memberId,
          displayName: this.state.identity.displayName,
        },
        gameTitle: source.title,
        sessionId: this.state.party?.material.sessionId,
      });
    } catch (error) {
      // A superseded load must not clear its replacement frame.
      if (this.state.runtime !== client) return;
      this.state.runtime = null;
      this.state.resetFrame();
      const message = errorMessage(error);
      track("party_issue", { outcome: "runtime-load-failed" });
      this.addNotice("error", `Your game could not start: ${message}`);
      this.emit();
    }
  }

  private handleHostEvent(event: RuntimeHostEvent): void {
    switch (event.type) {
      case "registration":
        if (!this.state.registerFrame(event.message.tickRate ?? null)) break;
        if (this.state.game?.kind === "nova") {
          // The game's own declaration is the only source of its player limits.
          const { gameId, title } = this.state.game;
          this.state.selectGame({ kind: "nova", gameId, title, ...playerLimitsOf(event.message) });
        }

        this.state.session?.setTickRate(this.state.frameTickRate);
        // Registration implies readiness; explicit nova.ready() is idempotent.
        this.state.session?.ready();
        // Session attachment precedes frame creation, so registration must replay identity and peers.
        this.pushSessionSnapshot();
        this.emit();
        break;
      case "apiCall":
        this.routeApiCall(event.message);
        break;
      case "error":
        this.addNotice(
          "error",
          `Runtime error (${event.message.category}): ${event.message.message}`,
        );
        this.emit();
        break;
      case "fatal":
        track("party_issue", { outcome: "runtime-fatal" });
        this.addNotice("error", event.message);
        this.emit();
        break;
      case "unresponsive":
        track("party_issue", { outcome: "runtime-unresponsive" });
        this.addNotice("warn", "Your game stopped answering — it may be wedged.");
        this.emit();
        break;
      case "responsive":
        this.addNotice("info", "Your game is responsive again.");
        this.emit();
        break;
      case "port-closed":
        this.addNotice("warn", "Your game's runtime channel closed — reloading it.");
        this.emit();
        if (this.state.runtime !== null && !this.state.leaving) {
          this.state.resetFrame();
          void this.state.runtime.restart().catch((error: unknown) => {
            this.addNotice("error", `The game could not be reloaded: ${errorMessage(error)}`);
            this.emit();
          });
        }
        break;
      case "lifecycle":
        if (event.message.event === "reloaded") this.state.confirmReload();
        break;
      case "ready":
      case "metadata":
        break; // handled by the runtime; not lobby-facing
      case "console": {
        const { level, message, details, dropped } = event.message;
        const entry: ArenaLogEntry = {
          id: `party-log-${++partyLogCounter}`,
          timestamp: Date.now(),
          level: level === "debug" ? "log" : level,
          message,
          ...(details !== undefined ? { details } : {}),
        };
        this.state.runtimeLogs = [...this.state.runtimeLogs, entry].slice(-MAX_PARTY_LOG_ENTRIES);
        if ((dropped ?? 0) > 0) {
          const droppedEntry: ArenaLogEntry = {
            id: `party-log-${++partyLogCounter}`,
            timestamp: Date.now(),
            level: "warn",
            message: `${dropped} console ${dropped === 1 ? "entry" : "entries"} dropped (rate limit)`,
          };
          this.state.runtimeLogs = [...this.state.runtimeLogs, droppedEntry].slice(
            -MAX_PARTY_LOG_ENTRIES,
          );
        }
        this.emit();
        break;
      }
    }
  }

  private routeApiCall(message: GameApiCallMessage): void {
    const session = this.state.session;
    if (session === null) return;
    routeFrameApiCall(message, session, {
      onFailure: (method, message) => {
        if (method === "dispatch") {
          this.addNotice("error", `nova.dispatch() failed: ${message}`);
        }
      },
      onStateResponse: (payload) => this.state.stateExecutor?.handleResponse(payload),
      pushApiEvent: (event) => this.state.runtime?.pushApiEvent(event),
    });
  }

  /**
   * Deliver start once per registered frame. Games need their view first
   * because onStart may read state or dispatch an action.
   */
  private deliverStartToFrame(): void {
    const runtime = this.state.runtime;
    if (runtime === null || !this.state.markStartDelivered()) return;
    runtime.pushApiEvent({ kind: "start" });
  }

  /**
   * Replay identity, connection, roster, and state missed before frame boot.
   * The game client deduplicates players by id.
   */
  private pushSessionSnapshot(): void {
    const session = this.state.session;
    const runtime = this.state.runtime;
    if (session === null || runtime === null) {
      return;
    }
    runtime.pushApiEvent({ kind: "identity", player: session.player });
    runtime.pushApiEvent({ kind: "connection", status: session.connectionStatus });
    for (const player of session.players) {
      runtime.pushApiEvent({ kind: "playerJoined", player });
    }
    // Replay the view before onStart can dispatch against it.
    if (this.state.lastStateApiEvent !== null) {
      runtime.pushApiEvent(this.state.lastStateApiEvent);
    }
    // Followers do not set session.isStarted(); gameStarted tracks received starts too.
    this.deliverStartToFrame();
  }

  clearRuntimeLogs(): void {
    if (this.state.runtimeLogs.length === 0) return;
    this.state.runtimeLogs = [];
    this.emit();
  }

  // Source distribution

  private cancelSourceRetransmit: (() => void) | null = null;

  private syncSourceRetransmit(state: PartyEngineState): void {
    const waiting = state.members.some(
      (member) => !member.isSelf && member.transferState === "waiting",
    );
    if (
      !waiting ||
      (state.phase !== "lobby" && state.phase !== "switching") ||
      this.state.party === null
    ) {
      this.stopSourceRetransmit();
      return;
    }
    if (this.cancelSourceRetransmit === null) this.armSourceRetransmit();
  }

  private armSourceRetransmit(): void {
    this.cancelSourceRetransmit = this.state.schedule(() => {
      this.cancelSourceRetransmit = null;
      const state = this.getState();
      const waiting = state.members.some(
        (member) => !member.isSelf && member.transferState === "waiting",
      );
      if (
        !waiting ||
        (state.phase !== "lobby" && state.phase !== "switching") ||
        this.state.party === null
      )
        return;
      void this.state.coordinator
        ?.refresh()
        .catch((error: unknown) =>
          this.addNotice("warn", `Could not ask the party for the game: ${errorMessage(error)}`),
        );
      this.armSourceRetransmit();
    }, SOURCE_RETRANSMIT_INTERVAL_MS);
  }

  private stopSourceRetransmit(): void {
    this.cancelSourceRetransmit?.();
    this.cancelSourceRetransmit = null;
  }

  private async registerSource(input: PartySourceSpec): Promise<void> {
    const coordinator = this.state.coordinator;
    if (coordinator === null) throw new Error("The party can't share the game right now.");
    this.state.stageSource(input);
    void this.maybeBootFrame();
    const metadata = await coordinator.setSource({
      gameId: input.gameId,
      title: input.title,
      apiVersion: input.apiVersion,
      source: input.source,
    });
    if (this.state.coordinator !== coordinator || this.state.leaving) return;
    this.state.adoptSourceHash(metadata.sourceSha256, this.state.identity.memberId);
    this.rememberShared(input, metadata.sourceSha256);
    this.state.verifyLocalSource(metadata.sourceSha256);
    this.state.setTransfer(this.state.identity.memberId, {
      fraction: 1,
      bytesTransferred: input.source.length,
      totalBytes: input.source.length,
      state: "complete",
      detail: "You have the game",
    });
    this.emit();
  }

  /** The verified source of a game shared this session, to save a copy. */
  sharedGameSource(gameId: string): SharedPartyGameSource | undefined {
    return this.state.sharedGames.get(gameId);
  }

  /** Keep a verified game (newest version per game id) for this session. */
  private rememberShared(spec: PartySourceSpec, sourceSha256: string): void {
    const hostId = this.state.party?.hostMemberId ?? null;
    const games = this.state.sharedGames;
    games.delete(spec.gameId);
    const apiVersion = spec.apiVersion ?? this.state.sourceApiVersions.get(spec.gameId);
    games.set(spec.gameId, {
      gameId: spec.gameId,
      title: spec.title,
      ...(apiVersion !== undefined ? { apiVersion } : {}),
      source: spec.source,
      sourceSha256,
      sharedBy: hostId === null ? null : this.displayNameOf(hostId),
      sharedBySelf: hostId === this.state.identity.memberId,
    });
    while (games.size > MAX_SHARED_GAMES) {
      const oldest = games.keys().next().value;
      if (oldest === undefined) break;
      games.delete(oldest);
    }
  }

  private handleCoordinatorEvent(event: GameSourceTransferEvent): void {
    switch (event.type) {
      case "metadata": {
        if (event.fromMemberId !== this.state.party?.hostMemberId) break;
        const game = {
          gameId: event.metadata.gameId,
          title: event.metadata.title ?? "Untitled game",
        };
        if (event.metadata.apiVersion !== undefined) {
          this.state.sourceApiVersions.set(game.gameId, event.metadata.apiVersion);
        }
        const current = this.state.game;
        const changed = current?.kind !== "nova" || current.gameId !== game.gameId;
        if (changed && this.state.phase === "playing") this.beginGameSwitch();
        // A repeated announcement keeps what registration added (player limits).
        this.state.selectGame(
          changed ? { kind: "nova", ...game } : { ...current, title: game.title },
        );
        this.state.adoptSourceHash(event.metadata.sourceSha256, this.state.identity.memberId);
        if (changed && this.state.party !== null) {
          this.state.invalidateLocalSource();
          this.teardownRuntimeFrame();
          // attach() wires listeners synchronously, before subsequent source or registration events.
          void this.replaceGameSession(this.state.party).catch((error: unknown) => {
            this.addNotice(
              "error",
              `The game session could not be configured: ${errorMessage(error)}`,
            );
            this.emit();
          });
          // Reuse cached bytes only when the selected source hash matches exactly.
          const cached = this.state.coordinator?.getCachedSource(
            game.gameId,
            event.metadata.sourceSha256,
          );
          if (cached !== undefined) {
            this.state.verifyLocalSource(event.metadata.sourceSha256);
            this.state.stageSource({ ...game, source: cached });
            this.rememberShared({ ...game, source: cached }, event.metadata.sourceSha256);
            void this.maybeBootFrame();
          }
        }
        this.saveRecovery();
        this.emit();
        break;
      }
      case "transferStart": {
        this.state.recordTransfer(this.transferTarget(event), {
          state: "transferring",
          fraction: 0,
          detail: null,
        });
        this.emit();
        break;
      }
      case "progress": {
        this.state.recordTransfer(this.transferTarget(event), {
          state: "transferring",
          fraction: event.progress.fraction,
          detail: `${formatBytes(event.progress.bytesTransferred)} of ${formatBytes(event.progress.totalBytes)}`,
        });
        this.emit();
        break;
      }
      case "complete": {
        const target = this.transferTarget(event);
        this.state.recordTransfer(target, {
          state: "complete",
          fraction: 1,
          detail: "Game received",
        });
        if (event.direction === "receive") {
          // Sending verified bytes also proves the sender holds this source.
          this.state.markSourceVerified(event.memberId, "Sent you the game", event.sourceSha256);
        } else {
          this.state.markSourceVerified(event.memberId, "Game received", event.sourceSha256);
        }
        this.addNotice(
          "info",
          event.direction === "send"
            ? `${this.displayNameOf(target)} received the game.`
            : "You received the game.",
        );
        this.emit();
        break;
      }
      case "received": {
        if (
          this.state.game?.kind !== "nova" ||
          this.state.game.gameId !== event.gameId ||
          this.state.currentSourceSha256 !== event.sourceSha256
        )
          break;
        if (
          this.state.pendingSource !== null &&
          this.state.pendingSource.source !== event.source &&
          this.state.party !== null
        ) {
          this.teardownRuntimeFrame();
          void this.replaceGameSession(this.state.party).catch((error: unknown) => {
            this.addNotice(
              "error",
              `The updated game session could not be configured: ${errorMessage(error)}`,
            );
            this.emit();
          });
        }
        this.state.verifyLocalSource(event.sourceSha256);
        this.state.recordTransfer(this.state.identity.memberId, {
          state: "complete",
          fraction: 1,
          detail: "Game received",
        });
        this.state.markSourceVerified(event.fromMemberId, "Sent you the game", event.sourceSha256);
        const source = {
          gameId: event.gameId,
          title: this.state.game?.title ?? "Untitled game",
          source: event.source,
        };
        this.state.stageSource(source);
        this.rememberShared(source, event.sourceSha256);
        this.addNotice("info", "You received the game — starting it now.");
        this.emit();
        void this.maybeBootFrame();
        break;
      }
      case "holds": {
        this.state.markSourceVerified(event.memberId, "Has the game", event.sourceSha256);
        this.emit();
        break;
      }
      case "verificationFailed": {
        this.state.recordTransfer(this.state.identity.memberId, {
          state: "failed",
          fraction: null,
          detail: event.errorMessage,
        });
        this.addNotice(
          "error",
          `Game verification failed for ${this.displayNameOf(this.state.identity.memberId)}: ${event.errorMessage}`,
        );
        this.emit();
        break;
      }
      case "cancelled": {
        const target = this.transferTarget(event);
        this.state.recordTransfer(target, {
          state: "failed",
          fraction: null,
          detail: event.reason ?? "cancelled",
        });
        this.addNotice(
          "warn",
          `Game transfer ${event.direction} for ${this.displayNameOf(target)} was cancelled${event.reason === undefined ? "." : ` (${event.reason}).`}`,
        );
        this.emit();
        break;
      }
      case "incompatible": {
        this.state.recordTransfer(this.state.identity.memberId, {
          state: "incompatible",
          fraction: null,
          detail: event.reason,
        });
        this.addNotice("error", `This build cannot run the game: ${event.reason}`);
        this.emit();
        break;
      }
      case "warning": {
        this.addNotice("warn", event.message);
        this.emit();
        break;
      }
      case "error": {
        this.handleTransferError(event.error);
        this.emit();
        break;
      }
    }
  }

  /** Send-side progress belongs to the remote member; receive-side progress belongs to self. */
  private transferTarget(event: GameSourceTransferEvent): MemberId {
    const self = this.state.identity.memberId;
    switch (event.type) {
      case "progress":
        return event.progress.direction === "receive" ? self : event.progress.memberId;
      case "transferStart":
      case "complete":
      case "cancelled":
        return event.direction === "receive" ? self : event.memberId;
      case "holds":
        return event.memberId;
      case "received":
      case "verificationFailed":
      case "incompatible":
        return self;
      default:
        return self;
    }
  }

  private handleTransferError(error: { code: string; message: string }): void {
    // Send failures identify the remote recipient in the coordinator's message;
    // receive failures apply to self.
    const peerMatch = /^Peer (\S+) could not receive/u.exec(error.message);
    const memberId = peerMatch?.[1] ?? this.state.identity.memberId;
    this.state.recordTransfer(memberId, {
      state: "failed",
      fraction: null,
      detail: error.message,
    });
    this.addNotice("error", error.message);
  }

  private isSourceVerified(memberId: MemberId): boolean {
    return this.state.isSourceVerified(memberId, this.state.identity.memberId);
  }

  private allSourcesVerified(members: readonly PartyMemberView[]): boolean {
    return (
      this.state.game?.kind === "external" ||
      (members.length > 0 && members.every((member) => this.isSourceVerified(member.memberId)))
    );
  }

  private memberStatus(
    memberId: MemberId,
  ): Pick<PartyMemberView, "transferState" | "transferProgress" | "transferDetail" | "ready"> {
    if (this.state.game?.kind === "external") {
      return {
        transferState: "complete",
        transferProgress: 1,
        transferDetail: "Game ready",
        ready: true,
      };
    }
    const ready = this.state.session?.readyOf(memberId) ?? false;
    if (memberId === this.state.identity.memberId && this.isSourceVerified(memberId)) {
      return {
        transferState: "complete",
        transferProgress: 1,
        transferDetail: "You have the game",
        ready,
      };
    }
    const transfer = this.state.transfers.get(memberId);
    return {
      transferState: transfer?.state ?? "waiting",
      transferProgress: transfer?.fraction ?? null,
      transferDetail: transfer?.detail ?? null,
      ready,
    };
  }

  private reloadSelectedGame(): void {
    if (this.state.game?.kind === "external") this.state.reloadExternalGame();
    else this.reloadRuntimeFrame();
  }

  // State projection and subscriptions

  private readonly listeners = new Set<(state: PartyEngineState) => void>();

  private lastDiagnostics: unknown = null;

  getState(): PartyEngineState {
    const party = this.state.party;
    const identity = this.state.identity;
    const members = this.buildMembers();
    const allReady = members.length > 0 && members.every((member) => member.ready);
    const allVerified = this.allSourcesVerified(members);
    const anyFailed = members.some(
      (member) => member.transferState === "failed" || member.transferState === "incompatible",
    );
    const ended = this.state.session?.isEnded() ?? false;
    const canRequestStart = this.state.phase === "lobby" || this.state.phase === "switching";

    // Only lobby UI offers start; blocked reasons describe game gates rather than phase.
    let startBlockedReason: string | null = null;
    if (this.state.game === null) {
      startBlockedReason = "Pick a game before starting the party.";
    } else if (ended) {
      startBlockedReason = "The game ended; leave the party to play again.";
    } else if (anyFailed) {
      const failed = members.find(
        (member) => member.transferState === "failed" || member.transferState === "incompatible",
      );
      startBlockedReason =
        failed === undefined
          ? "A player could not receive the game."
          : `${failed.displayName} could not receive the game${failed.transferDetail === null ? "." : ` (${failed.transferDetail}).`}`;
    } else if (!allVerified) {
      const waiting = members.find((member) => !this.isSourceVerified(member.memberId));
      startBlockedReason =
        waiting === undefined
          ? "Waiting for the game to reach every player."
          : `Waiting for ${waiting.displayName} to receive the game.`;
    } else if (!allReady) {
      startBlockedReason = "Waiting for every player's game to load and register.";
    }

    return {
      phase: this.state.phase,
      switchingGame: this.cancelGameSwitch !== null,
      phaseDetail: this.state.phaseDetail,
      joinStage: this.state.joinStage,
      reconnectAttempts: this.state.reconnectAttempts,
      role: party?.role ?? null,
      memberId: identity.memberId,
      displayName: identity.displayName,
      game: this.state.game,
      playerLimitNotice:
        this.state.game === null ? null : playerLimitNotice(members.length, this.state.game),
      members,
      hostMemberId: party?.hostMemberId ?? null,
      amHost: party?.amHost ?? false,
      authorityMemberId: this.computeAuthorityMemberId(members),
      inviteUrl: this.buildInviteUrl(),
      connectionState: this.state.connectionState,
      canStart:
        canRequestStart &&
        this.state.game !== null &&
        !ended &&
        !anyFailed &&
        allVerified &&
        allReady,
      canForceStart:
        canRequestStart &&
        this.state.game !== null &&
        !ended &&
        !anyFailed &&
        allVerified &&
        !allReady,
      startBlockedReason,
      endedReason: this.state.endedReason,
      removedReason: this.state.removedReason,
      runtimeLogs: this.state.runtimeLogs,
      diagnostics: this.buildDiagnostics(),
      signalingOutage: this.state.signalingOutageVisible,
      notices: [...this.state.notices],
      lastError: this.state.lastError,
      setupFailureCode: this.state.setupFailureCode,
      peerLink: this.state.peerLink.status,
      sharedGames: [...this.state.sharedGames.values()]
        .reverse()
        .map(({ source: _source, ...game }) => game),
    };
  }

  /** Subscribers receive the current snapshot immediately. */
  onState(handler: (state: PartyEngineState) => void): () => void {
    this.listeners.add(handler);
    handler(this.getState());
    return () => {
      this.listeners.delete(handler);
    };
  }

  /** Start-flow diagnostics, exposed on window.__NOVA_PARTY_DEBUG__ in dev/test builds. */
  debugSnapshot(): Record<string, unknown> {
    const state = this.getState();
    return {
      phase: state.phase,
      joinStage: state.joinStage,
      gameStarted: this.state.gameStarted,
      registered: this.state.registered,
      frameExists: this.state.runtime !== null,
      frameStartDelivered: this.state.frameStartDelivered,
      startRetryActive: this.state.cancelStartRetry !== null,
      startGaveUp: this.state.startGaveUp,
      session: this.state.session?.debugState() ?? null,
      authority: state.authorityMemberId,
      canStart: state.canStart,
      startBlockedReason: state.startBlockedReason,
      members: state.members.map((member) => ({
        id: member.memberId,
        isSelf: member.isSelf,
        connected: member.connected,
        transferState: member.transferState,
        ready: member.ready,
      })),
      notices: state.notices.map((notice) => notice.message),
      // Peers reached through the relay tunnel rather than direct WebRTC.
      relayedPeers: state.diagnostics?.peers.filter((peer) => peer.tunnelled === true).length ?? 0,
    };
  }

  async refreshDiagnostics(): Promise<void> {
    const transport = this.state.party?.privateTransport;
    this.lastDiagnostics =
      this.state.diagnosticsProvider?.() ?? this.transportDiagnostics(transport) ?? null;
    if (transport !== null && transport !== undefined) {
      const sampler = (
        transport as unknown as {
          sampleQuality?: () => Promise<unknown>;
        }
      ).sampleQuality;
      if (typeof sampler === "function") {
        await sampler.call(transport).catch(() => undefined);
      }
    }
    this.emit();
  }

  private noteMemberLeft(memberId: MemberId, displayName: string | undefined): void {
    if (this.state.removedMemberIds.delete(memberId)) return;
    if (displayName === undefined || displayName === memberId) return;
    this.addNotice("info", leftNoticeMessage(displayName));
  }

  private dropLeftNotice(displayName: string | undefined): void {
    if (displayName === undefined) return;
    const message = leftNoticeMessage(displayName);
    this.state.notices = this.state.notices.filter((notice) => notice.message !== message);
  }

  private buildMembers(): PartyMemberView[] {
    const party = this.state.party;
    const identity = this.state.identity;
    const peers = party?.privateTransport.peers ?? [];
    const memberIds = party === null ? [identity.memberId] : party.members;
    const members: PartyMemberView[] = [];
    for (const memberId of memberIds) {
      const peer = peers.find((candidate) => candidate.memberId === memberId);
      const isSelf = memberId === identity.memberId;
      members.push({
        memberId,
        displayName: this.displayNameOf(memberId),
        isSelf,
        connectionId: peer?.connectionId ?? null,
        connected: isSelf ? isConnectedState(this.state.connectionState) : peer !== undefined,
        isHost: memberId === party?.hostMemberId,
        ...this.memberStatus(memberId),
      });
    }
    return members;
  }

  private displayNameOf(memberId: MemberId): string {
    const identity = this.state.identity;
    if (memberId === identity.memberId) {
      return identity.displayName;
    }
    return this.state.party?.getMemberName(memberId) ?? memberId;
  }

  /** Do not show raw member ids in membership notices. */
  private hasDisplayName(memberId: MemberId): boolean {
    return this.displayNameOf(memberId) !== memberId;
  }

  /**
   * Until the state engine announces authority, show its first-ready-member fallback.
   * Greeter status is a separate role, never an authority signal.
   */
  private computeAuthorityMemberId(members: readonly PartyMemberView[]): MemberId | null {
    const engineAuthority = this.state.session?.getStateModeDiagnostics().authorityMemberId ?? null;
    return engineAuthority ?? members.find((member) => member.ready)?.memberId ?? null;
  }

  private buildInviteUrl(): string | null {
    const party = this.state.party;
    if (party === null) {
      return null;
    }
    try {
      return buildInviteUrl({
        baseUrl: `${defaultBaseUrl()}/party`,
        secret: party.secret,
      });
    } catch {
      return null;
    }
  }

  private buildDiagnostics(): PartyDiagnostics | null {
    const party = this.state.party;
    if (party === null) {
      return null;
    }
    const transport = party.privateTransport;
    const transportRoom = (transport as { roomName?: string }).roomName ?? "";
    const raw =
      this.state.diagnosticsProvider?.() ??
      this.transportDiagnostics(transport) ??
      this.lastDiagnostics;
    const adapter = raw as {
      connectionState?: TransportConnectionState;
      selfConnectionId?: string;
      room?: string;
      sessionId?: string | null;
      signalingConnected?: boolean | null;
      joinErrors?: Array<{ category: string; message: string }> | null;
      peers?: Array<{
        memberId: string;
        connectionId: string;
        displayName?: string;
        tunnelled?: boolean;
      }>;
      lastQuality?: Array<{ memberId: string; pingMs: number | null; sampledAt: number }>;
    } | null;
    return {
      connectionState: adapter?.connectionState ?? transport.connectionState,
      selfConnectionId: adapter?.selfConnectionId ?? transport.selfConnectionId,
      room: adapter?.room ?? transportRoom,
      sessionId: adapter?.sessionId ?? transport.sessionId,
      signalingConnected: adapter?.signalingConnected ?? null,
      joinErrors: adapter?.joinErrors ?? null,
      peers: adapter?.peers ?? transport.peers.map((peer) => ({ ...peer })),
      lastQuality: adapter?.lastQuality ?? [],
      turn: this.state.turnStatus,
    };
  }

  /** getDiagnostics is optional; injected and in-memory transports may omit it. */
  private transportDiagnostics(transport: unknown): unknown | null {
    const getter = (transport as { getDiagnostics?: () => unknown } | undefined)?.getDiagnostics;
    return typeof getter === "function" ? (getter.call(transport) as unknown) : null;
  }

  private addNotice(level: PartyNotice["level"], message: string): void {
    // Move repeats to the newest slot instead of accumulating duplicate alerts.
    const duplicateIndex = this.state.notices.findIndex(
      (notice) => notice.message === message && notice.level === level,
    );
    const deduped =
      duplicateIndex === -1
        ? this.state.notices
        : [
            ...this.state.notices.slice(0, duplicateIndex),
            ...this.state.notices.slice(duplicateIndex + 1),
          ];
    this.state.notices = [...deduped, makeNotice(level, message)].slice(-MAX_NOTICES);
  }

  private emit(): void {
    const state = this.getState();
    this.syncSourceRetransmit(state);
    for (const handler of this.listeners) {
      handler(state);
    }
    if (state.switchingGame && state.amHost && state.canStart) {
      queueMicrotask(() => {
        if (this.cancelGameSwitch !== null && this.getState().canStart) this.startGame();
      });
    }
  }
}

export const partyEngine = new PartyEngine();
observePartyAnalytics(partyEngine);
