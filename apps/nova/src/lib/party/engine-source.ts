import type { MemberId } from "@rocketcrab/protocol";
import { type GameSourceTransferEvent } from "@rocketcrab/party";
import type {
  PartyMemberView,
  PartyEngineState,
  PartySourceSpec,
  SharedPartyGameSource,
} from "./engine-types";
import type { PartyEngineContext, TransferState } from "./engine-context";
import type { PartyEngineServices } from "./engine-services";
import { SOURCE_RETRANSMIT_INTERVAL_MS, errorMessage, formatBytes } from "./engine-utils";

/** Each kept game holds its source (up to 2 MiB), so the list is short. */
const MAX_SHARED_GAMES = 10;

/** Verified source distribution, transfer bookkeeping, and source retry timers. */
export class PartySource {
  private cancelSourceRetransmit: (() => void) | null = null;

  constructor(
    private readonly state: PartyEngineContext,
    private readonly services: () => Pick<
      PartyEngineServices,
      "snapshot" | "runtime" | "connection" | "game"
    >,
  ) {}

  syncSourceRetransmit(state: PartyEngineState): void {
    const waiting = state.members.some(
      (member) => !member.isSelf && member.transferState === "waiting",
    );
    if (!waiting || state.phase !== "lobby" || this.state.party === null) {
      this.stopSourceRetransmit();
      return;
    }
    if (this.cancelSourceRetransmit === null) this.armSourceRetransmit();
  }

  private armSourceRetransmit(): void {
    this.cancelSourceRetransmit = this.state.schedule(() => {
      this.cancelSourceRetransmit = null;
      const state = this.services().snapshot.getState();
      const waiting = state.members.some(
        (member) => !member.isSelf && member.transferState === "waiting",
      );
      if (!waiting || state.phase !== "lobby" || this.state.party === null) return;
      void this.state.coordinator
        ?.refresh()
        .catch((error: unknown) =>
          this.services().snapshot.addNotice(
            "warn",
            `Could not ask the party for the game: ${errorMessage(error)}`,
          ),
        );
      this.armSourceRetransmit();
    }, SOURCE_RETRANSMIT_INTERVAL_MS);
  }

  stopSourceRetransmit(): void {
    this.cancelSourceRetransmit?.();
    this.cancelSourceRetransmit = null;
  }

  registerSource(input: PartySourceSpec): void {
    this.state.pendingSource = input;
    void this.services().runtime.maybeBootFrame();
    const coordinator = this.state.coordinator;
    if (coordinator === null) {
      return;
    }
    void coordinator
      .setSource({
        gameId: input.gameId,
        title: input.title,
        apiVersion: input.apiVersion,
        mode: input.mode,
        source: input.source,
      })
      .then((metadata) => {
        this.adoptSourceHash(metadata.sourceSha256);
        this.rememberShared(input, metadata.sourceSha256);
        this.state.selfVerified = true;
        this.state.selfVerifiedSha256 = metadata.sourceSha256;
        this.state.transfers.set(this.state.identity.memberId, {
          fraction: 1,
          bytesTransferred: input.source.length,
          totalBytes: input.source.length,
          state: "complete",
          detail: "You have the game",
        });
        this.services().snapshot.emit();
      })
      .catch((error: unknown) => {
        this.services().snapshot.addNotice(
          "error",
          `Could not register the game: ${errorMessage(error)}`,
        );
        this.services().snapshot.emit();
      });
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
      mode: spec.mode,
      ...(apiVersion !== undefined ? { apiVersion } : {}),
      source: spec.source,
      sourceSha256,
      sharedBy: hostId === null ? null : this.services().snapshot.displayNameOf(hostId),
      sharedBySelf: hostId === this.state.identity.memberId,
    });
    while (games.size > MAX_SHARED_GAMES) {
      const oldest = games.keys().next().value;
      if (oldest === undefined) break;
      games.delete(oldest);
    }
  }

  handleCoordinatorEvent(event: GameSourceTransferEvent): void {
    switch (event.type) {
      case "metadata": {
        const game = {
          gameId: event.metadata.gameId,
          title: event.metadata.title ?? "Untitled game",
          mode: event.metadata.mode ?? "state",
        };
        if (event.metadata.apiVersion !== undefined) {
          this.state.sourceApiVersions.set(game.gameId, event.metadata.apiVersion);
        }
        const changed =
          this.state.game?.gameId !== game.gameId || this.state.game.mode !== game.mode;
        this.state.game = game;
        this.adoptSourceHash(event.metadata.sourceSha256);
        if (changed && this.state.party !== null) {
          this.state.classic = null;
          this.state.selfVerified = false;
          this.services().runtime.teardownRuntimeFrame();
          // attach() wires listeners synchronously, before subsequent source or registration events.
          void this.services()
            .game.replaceGameSession(this.state.party)
            .catch((error: unknown) => {
              this.services().snapshot.addNotice(
                "error",
                `The game session could not be configured: ${errorMessage(error)}`,
              );
              this.services().snapshot.emit();
            });
          // Reuse cached bytes only when the selected source hash matches exactly.
          const cached = this.state.coordinator?.getCachedSource(
            game.gameId,
            event.metadata.sourceSha256,
          );
          if (cached !== undefined) {
            this.state.selfVerified = true;
            this.state.selfVerifiedSha256 = event.metadata.sourceSha256;
            this.state.pendingSource = { ...game, source: cached };
            this.rememberShared(this.state.pendingSource, event.metadata.sourceSha256);
            void this.services().runtime.maybeBootFrame();
          }
        }
        this.services().connection.saveRecovery();
        this.services().snapshot.emit();
        break;
      }
      case "transferStart": {
        this.recordTransfer(this.transferTarget(event), {
          state: "transferring",
          fraction: 0,
          detail: null,
        });
        this.services().snapshot.emit();
        break;
      }
      case "progress": {
        this.recordTransfer(this.transferTarget(event), {
          state: "transferring",
          fraction: event.progress.fraction,
          detail: `${formatBytes(event.progress.bytesTransferred)} of ${formatBytes(event.progress.totalBytes)}`,
        });
        this.services().snapshot.emit();
        break;
      }
      case "complete": {
        const target = this.transferTarget(event);
        this.recordTransfer(target, {
          state: "complete",
          fraction: 1,
          detail: "Game received",
        });
        if (event.direction === "receive") {
          // Sending verified bytes also proves the sender holds this source.
          this.markSourceVerified(event.memberId, "Sent you the game", event.sourceSha256);
        } else {
          this.markSourceVerified(event.memberId, "Game received", event.sourceSha256);
        }
        this.services().snapshot.addNotice(
          "info",
          event.direction === "send"
            ? `${this.services().snapshot.displayNameOf(target)} received the game.`
            : "You received the game.",
        );
        this.services().snapshot.emit();
        break;
      }
      case "received": {
        if (
          this.state.pendingSource !== null &&
          this.state.pendingSource.source !== event.source &&
          this.state.party !== null
        ) {
          this.services().runtime.teardownRuntimeFrame();
          void this.services()
            .game.replaceGameSession(this.state.party)
            .catch((error: unknown) => {
              this.services().snapshot.addNotice(
                "error",
                `The updated game session could not be configured: ${errorMessage(error)}`,
              );
              this.services().snapshot.emit();
            });
        }
        this.adoptSourceHash(event.sourceSha256);
        this.state.selfVerified = true;
        this.state.selfVerifiedSha256 = event.sourceSha256;
        this.recordTransfer(this.state.identity.memberId, {
          state: "complete",
          fraction: 1,
          detail: "Game received",
        });
        this.markSourceVerified(event.fromMemberId, "Sent you the game", event.sourceSha256);
        this.state.pendingSource = {
          gameId: event.gameId,
          title: this.state.game?.title ?? "Untitled game",
          mode: this.state.game?.mode ?? "state",
          source: event.source,
        };
        this.rememberShared(this.state.pendingSource, event.sourceSha256);
        this.services().snapshot.addNotice("info", "You received the game — starting it now.");
        this.services().snapshot.emit();
        void this.services().runtime.maybeBootFrame();
        break;
      }
      case "holds": {
        this.markSourceVerified(event.memberId, "Has the game", event.sourceSha256);
        this.services().snapshot.emit();
        break;
      }
      case "verificationFailed": {
        this.recordTransfer(this.state.identity.memberId, {
          state: "failed",
          fraction: null,
          detail: event.errorMessage,
        });
        this.services().snapshot.addNotice(
          "error",
          `Game verification failed for ${this.services().snapshot.displayNameOf(this.state.identity.memberId)}: ${event.errorMessage}`,
        );
        this.services().snapshot.emit();
        break;
      }
      case "cancelled": {
        const target = this.transferTarget(event);
        this.recordTransfer(target, {
          state: "failed",
          fraction: null,
          detail: event.reason ?? "cancelled",
        });
        this.services().snapshot.addNotice(
          "warn",
          `Game transfer ${event.direction} for ${this.services().snapshot.displayNameOf(target)} was cancelled${event.reason === undefined ? "." : ` (${event.reason}).`}`,
        );
        this.services().snapshot.emit();
        break;
      }
      case "incompatible": {
        this.recordTransfer(this.state.identity.memberId, {
          state: "incompatible",
          fraction: null,
          detail: event.reason,
        });
        this.services().snapshot.addNotice(
          "error",
          `This build cannot run the game: ${event.reason}`,
        );
        this.services().snapshot.emit();
        break;
      }
      case "warning": {
        this.services().snapshot.addNotice("warn", event.message);
        this.services().snapshot.emit();
        break;
      }
      case "error": {
        this.handleTransferError(event.error);
        this.services().snapshot.emit();
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
    this.recordTransfer(memberId, {
      state: "failed",
      fraction: null,
      detail: error.message,
    });
    this.services().snapshot.addNotice("error", error.message);
  }

  /** Shared by the UI and session start gates so source requirements agree. */
  allSourcesVerified(members: readonly PartyMemberView[], classicActive: boolean): boolean {
    return (
      classicActive ||
      (members.length > 0 && members.every((member) => this.isSourceVerified(member.memberId)))
    );
  }

  /** Verification is hash-specific: edits under the same game id must be verified again. */
  isSourceVerified(memberId: MemberId): boolean {
    if (memberId === this.state.identity.memberId) {
      return (
        this.state.selfVerified && this.state.selfVerifiedSha256 === this.state.currentSourceSha256
      );
    }
    return (
      this.state.transfers.get(memberId)?.state === "complete" &&
      this.state.verifiedSha256.get(memberId) === this.state.currentSourceSha256
    );
  }

  /** Invalidate old-hash verification and return affected rows to waiting. */
  private adoptSourceHash(sourceSha256: string): void {
    this.state.currentSourceSha256 = sourceSha256;
    for (const [memberId, verified] of this.state.verifiedSha256) {
      if (verified === sourceSha256) continue;
      this.state.verifiedSha256.delete(memberId);
      this.recordTransfer(memberId, { state: "waiting", fraction: 0, detail: null });
    }
    if (this.state.selfVerified && this.state.selfVerifiedSha256 !== sourceSha256) {
      this.recordTransfer(this.state.identity.memberId, {
        state: "waiting",
        fraction: 0,
        detail: null,
      });
    }
  }

  private markSourceVerified(memberId: MemberId, detail: string, sourceSha256: string): void {
    // Ignore verification reports for a superseded source hash.
    if (this.state.currentSourceSha256 !== null && sourceSha256 !== this.state.currentSourceSha256)
      return;
    const previous = this.state.transfers.get(memberId);
    const existing: TransferState = previous ?? {
      fraction: 1,
      bytesTransferred: 0,
      totalBytes: 0,
      state: "complete",
      detail: null,
    };
    this.state.transfers.set(memberId, {
      ...existing,
      state: "complete",
      fraction: 1,
      detail,
    });
    this.state.verifiedSha256.set(memberId, sourceSha256);
  }

  private recordTransfer(
    memberId: MemberId,
    update: {
      state: PartyMemberView["transferState"];
      fraction: number | null;
      detail: string | null;
    },
  ): void {
    const previous = this.state.transfers.get(memberId);
    const existing: TransferState = previous ?? {
      fraction: 0,
      bytesTransferred: 0,
      totalBytes: 0,
      state: "waiting",
      detail: null,
    };
    const next: TransferState = {
      ...existing,
      state: update.state,
      fraction: update.fraction ?? existing.fraction,
      detail: update.detail,
    };
    this.state.transfers.set(memberId, next);
  }
}
