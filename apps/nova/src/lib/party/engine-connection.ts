import type { TransportConnectionState } from "@rocketcrab/core";
import { connectionErrorMessage } from "./connection-errors";
import { clearPartyRecovery, savePartyRecovery } from "./party-recovery";
import type { PartyPhase } from "./engine-types";
import type { PartyEngineContext } from "./engine-context";
import type { PartyEngineServices } from "./engine-services";
import {
  UNSAFE_TEARDOWN_MESSAGE,
  errorMessage,
  PARTY_HEALTH_PROBE_TIMEOUT_MS,
  RECONNECT_RETRY_BASE_MS,
  RECONNECT_RETRY_CAP_MS,
} from "./engine-utils";
import { isInPartyPhase } from "./engine-utils";

/** Party teardown, reconnect/backoff, and browser lifecycle health checks. */
export class PartyConnection {
  private readonly lifecycleUnsubscribers: Array<() => void> = [];

  private pageWasHidden = false;

  private reconnectInFlight: Promise<void> | null = null;

  private resumeCheckInFlight = false;

  private reconnectRetryTimer: (() => void) | null = null;

  constructor(
    private readonly state: PartyEngineContext,
    private readonly services: () => Pick<
      PartyEngineServices,
      "game" | "source" | "setup" | "snapshot" | "runtime"
    >,
  ) {}

  /** Includes setup and error phases, not just an established session. */
  isActive(): boolean {
    return this.state.phase !== "idle" || this.state.party !== null;
  }

  /** Resolve after teardown. Kicked members use "removed" to avoid flashing the entry UI. */
  leaveParty(nextPhase: PartyPhase = "idle", preserveSetup = false): Promise<void> {
    this.services().game.stopStartRetry();
    this.services().source.stopSourceRetransmit();
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
    this.services().setup.stopObservingSignaling();
    this.state.runtime?.destroy("user_exit");
    this.state.runtime = null;
    this.state.frameStarted = false;
    this.state.registered = false;
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
    this.state.lastStateApiEvent = null;
    this.state.pendingSource = null;
    this.state.sharedGames.clear();
    this.state.sourceApiVersions.clear();
    this.state.runtimeLogs = [];
    this.state.game = null;
    this.state.classic = null;
    this.state.transfers.clear();
    this.state.verifiedSha256.clear();
    this.state.selfVerified = false;
    this.state.selfVerifiedSha256 = null;
    this.state.currentSourceSha256 = null;
    this.state.endedReason = null;
    this.state.notices = [];
    this.state.removedMemberIds.clear();
    this.state.peerLink.clear();
    this.state.lastError = this.state.teardownFailed ? UNSAFE_TEARDOWN_MESSAGE : null;
    this.state.lastSetup = null;
    this.state.phase = this.state.teardownFailed ? "error" : nextPhase;
    this.state.phaseDetail = null;
    this.state.joinStage = null;
    this.state.gameStarted = false;
    this.state.reconnectAttempts = 0;
    this.pageWasHidden = false;
    this.reconnectInFlight = null;
    this.cancelReconnectRetry();
    clearPartyRecovery();
    this.state.leaving = false;
    this.services().snapshot.emit();
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
    this.state.phase = "reconnecting";
    this.state.phaseDetail = `Reconnecting… (attempt ${this.state.reconnectAttempts})`;
    this.services().snapshot.emit();
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
      this.services().snapshot.addNotice(
        "error",
        `Reconnect failed: ${connectionErrorMessage(error)}`,
      );
      this.state.phaseDetail = `Reconnect failed (attempt ${this.state.reconnectAttempts}) — will retry automatically.`;
      this.services().snapshot.emit();
      this.scheduleReconnectRetry();
    }
  }

  subscribeLifecycle(): void {
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
    this.services().runtime.recoverRuntimeAfterResume();
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
    this.services().snapshot.addNotice("info", "You're back online — reconnecting.");
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
    this.services().snapshot.addNotice(
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
      this.services().snapshot.addNotice("info", "Retrying the connection automatically…");
      void this.reconnect();
    }, delayMs);
  }

  private cancelReconnectRetry(): void {
    if (this.reconnectRetryTimer !== null) {
      this.reconnectRetryTimer();
      this.reconnectRetryTimer = null;
    }
  }

  handleTransportState(state: TransportConnectionState): void {
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
      this.state.phase = this.state.gameStarted ? "playing" : "lobby";
      this.state.phaseDetail = null;
      this.services().snapshot.emit();
      void this.state.coordinator
        ?.refresh()
        .catch((error: unknown) =>
          this.services().snapshot.addNotice(
            "warn",
            `Could not ask the party for the game: ${errorMessage(error)}`,
          ),
        );
      this.services().game.askForClassicRoom();
    }
  }

  enterReconnecting(detail: string): void {
    if (this.state.phase === "reconnecting") {
      return;
    }
    this.state.phase = "reconnecting";
    this.state.phaseDetail = detail;
    this.services().snapshot.emit();
    this.scheduleReconnectRetry();
  }

  /** Persist invite material, identity, and game selection for rejoin after a page reload. */
  saveRecovery(): void {
    const party = this.state.party;
    if (party === null) {
      return;
    }
    savePartyRecovery({
      role: party.role,
      secret: party.secret,
      memberId: this.state.identity.memberId,
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
}
