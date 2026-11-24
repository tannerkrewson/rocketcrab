import {
  GameSourceCoordinator,
  PartyError,
  createParty,
  joinPartyByInvite,
  type PartySession,
  type PartyTransportFactory,
} from "@rocketcrab/party";
import { reportConnection } from "../connection-log";
import {
  connectionErrorCategory,
  connectionErrorMessage,
  roomErrorCategory,
} from "./connection-errors";
import { createTrysteroPartyTransportFactory } from "./transport-factory";
import { turnCredsConfigured, TURN_CREDS_TTL_MS, type TurnCredentialsResult } from "./turn-creds";
import type { TurnServerConfigLike } from "./turn-creds";
import type { PartySourceSpec } from "./engine-types";
import type { PartyEngineContext } from "./engine-context";
import type { PartyEngineServices } from "./engine-services";
import { UNSAFE_TEARDOWN_MESSAGE, errorMessage } from "./engine-utils";

/** Invite setup, signaling observation, credential leases, and setup failure cleanup. */
export class PartySetup {
  /** Page-local credential lease; reuse requires at least half its lifetime remaining. */
  private turnCredsCache: {
    readonly turnConfig: readonly TurnServerConfigLike[];
    readonly expiresAt: number;
  } | null = null;

  private readonly joinErrorNoticesShown = new Set<string>();

  constructor(
    private readonly state: PartyEngineContext,
    private readonly services: () => Pick<
      PartyEngineServices,
      "snapshot" | "connection" | "source" | "game"
    >,
  ) {}

  /** An omitted source opens an empty lobby; a supplied source is announced immediately. */
  async createParty(input?: PartySourceSpec): Promise<void> {
    if (this.state.leaveInFlight !== null && !(await this.waitForLeaveBeforeSetup())) return;
    if (this.rejectUnsafeSetup()) return;
    this.prepareSetup();
    const setup = this.state.setupAbort!;
    const identity = this.state.identity;
    this.state.lastSetup = { kind: "create", input };
    this.state.phase = "creating";
    this.state.phaseDetail = "Creating your private party…";
    this.state.lastError = null;
    this.services().snapshot.emit();
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
      this.state.game = input === undefined ? null : { gameId: input.gameId, title: input.title };
      await this.establish(party);
      if (setup.signal.aborted) return;
      this.state.phase = "lobby";
      this.state.phaseDetail = null;
      this.state.lastSetup = null;
      this.services().connection.saveRecovery();
      this.services().snapshot.emit();
      if (input !== undefined) {
        this.services().source.registerSource(input);
      }
    } catch (error) {
      await this.finishFailedSetup(setup, error);
    } finally {
      if (this.state.setupAbort === setup) this.state.setupAbort = null;
    }
  }

  /** Join a party from an invite-link secret (ADR-0011). */
  async joinByInvite(input: { secret: string }): Promise<void> {
    if (this.state.leaveInFlight !== null && !(await this.waitForLeaveBeforeSetup())) return;
    if (this.rejectUnsafeSetup()) return;
    this.prepareSetup();
    const setup = this.state.setupAbort!;
    const identity = this.state.identity;
    const normalizedInput = input;
    this.state.lastSetup = { kind: "join-invite", input: normalizedInput };
    const startedAt = performance.now();
    this.state.phase = "joining";
    this.state.joinStage = "discovering";
    this.state.phaseDetail = "Joining the party from your invite…";
    this.state.lastError = null;
    this.services().snapshot.emit();
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
        await this.services()
          .connection.leaveParty("idle", true)
          .catch(() => undefined);
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
      this.state.phase = "lobby";
      this.state.phaseDetail = null;
      this.state.joinStage = null;
      this.state.lastSetup = null;
      this.services().connection.saveRecovery();
      this.services().snapshot.emit();
      void this.state.coordinator
        ?.refresh()
        .catch((error: unknown) =>
          this.services().snapshot.addNotice(
            "warn",
            `Could not ask the party for the game: ${errorMessage(error)}`,
          ),
        );
      this.services().game.askForExternalRoom();
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
    this.state.phase = "idle";
    this.state.phaseDetail = null;
    this.state.joinStage = null;
    this.state.notices = [];
    this.services().snapshot.emit();
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

  stopObservingSignaling(): void {
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
    const options = {
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
      onTunnel: () => {
        if (this.state.activeErrorScope !== scope || setup?.signal.aborted) return;
        this.state.peerLink.switched();
      },
      onTunnelFailure: () => {
        if (this.state.activeErrorScope !== scope || setup?.signal.aborted) return;
        this.state.peerLink.failed();
      },
    };
    if (!turnCredsConfigured()) {
      this.state.turnStatus = "disabled";
      return createTrysteroPartyTransportFactory(options);
    }
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
      this.services().snapshot.addNotice(
        "warn",
        "Incompatible Nova version. Everyone should update/reload Nova and rejoin the party.",
      );
      this.services().snapshot.emit();
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
      this.services().snapshot.addNotice("warn", message);
      this.services().snapshot.emit();
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
    this.state.connectionState = party.privateTransport.connectionState;
    this.state.unsubParty = party.onEvent((event) => this.services().game.handlePartyEvent(event));
    this.state.unsubTransport = [
      party.privateTransport.on("connection:state", (state) =>
        this.services().connection.handleTransportState(state),
      ),
      party.privateTransport.on("peer:joined", () => this.state.peerLink.peerJoined()),
      ...this.subscribeRelayState(party),
    ];
    this.state.coordinator = new GameSourceCoordinator({
      transport: party.privateTransport,
    });
    this.state.unsubCoordinator = this.state.coordinator.subscribe((event) =>
      this.services().source.handleCoordinatorEvent(event),
    );
    await this.services().game.replaceGameSession(party);
  }

  /** The optional adapter hook replays relay state immediately; other transports need no subscription. */
  private subscribeRelayState(party: PartySession): Array<() => void> {
    const transport = party.privateTransport as unknown as {
      onRelayStateChange?: (handler: () => void) => () => void;
    };
    if (typeof transport.onRelayStateChange !== "function") {
      return [];
    }
    return [transport.onRelayStateChange(() => this.services().snapshot.emit())];
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
    this.state.phase = "error";
    this.state.phaseDetail = null;
    this.state.joinStage = null;
    this.services().snapshot.emit();
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
    this.state.joinStage = "connecting";
    this.state.phaseDetail = "Connecting to the host…";
    this.services().snapshot.emit();
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
      await this.services()
        .connection.leaveParty("idle", true)
        .catch(() => undefined);
      this.state.lastSetup = lastSetup;
    }
    this.state.pendingSetupTransport = null;
    this.stopObservingSignaling();
    if (!this.rejectUnsafeSetup()) this.failSetup(error);
  }

  private rejectUnsafeSetup(): boolean {
    if (!this.state.teardownFailed) return false;
    this.state.phase = "error";
    this.state.lastError = UNSAFE_TEARDOWN_MESSAGE;
    this.services().snapshot.emit();
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
    this.state.phase = "idle";
    this.state.phaseDetail = null;
    this.state.joinStage = null;
    this.state.notices = [];
    this.services().snapshot.emit();
  }
}
