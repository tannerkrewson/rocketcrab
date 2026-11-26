import { GameByteBudget } from "./game-byte-budget";
import { GameFiles } from "./game-files";
import type {
  NovaTransport,
  TransportConnectionState,
  TransportMessage,
  TransportPeerInfo,
} from "@rocketcrab/core";
import { tickRateDefault, type GameEndReason, type PeerMessage } from "@rocketcrab/protocol";
import {
  createNovaClient,
  type NovaClient,
  type NovaClientBackend,
  type NovaSessionEvent,
} from "./client";
import { NovaError } from "./errors";
import { NOVA_API_VERSION } from "./version";
import {
  buildGameEndMessage,
  buildGameReadyMessage,
  buildGameStartMessage,
  buildPlayerIdentityMessage,
  type PeerMessageBase,
} from "./messages";
import { NovaStateEngine, type StateEngineHost, type StateSnapshotEnvelope } from "./state-engine";
import { LocalGameExecutor, type NovaStateExecutor } from "./state-executor";
import type {
  NovaAction,
  NovaConnectionStatus,
  NovaGameDeclaration,
  NovaPlayer,
  NovaStateDiagnostics,
  NovaStateHandlers,
} from "./types";
import {
  type NovaSessionOptions,
  type NovaSessionPlayer,
  type PlayerRecord,
  mapConnectionState,
  type OutboxEntry,
  type BufferedDispatch,
  toNovaPlayer,
} from "./session-shared";

/** Owns connection, game lifecycle, and the bound game-facing client. */
export abstract class SessionLifecycle implements NovaClientBackend {
  readonly transport: NovaTransport;
  readonly room: string;
  readonly sessionId: string;
  readonly game: NovaSessionOptions["game"];

  /** The game-facing API object bound to this session. */
  readonly client: NovaClient;
  readonly files: GameFiles;

  /** The schema-validated registration the game declared (informational). */
  declaration: NovaGameDeclaration | null = null;

  protected readonly engine: NovaStateEngine;
  protected readonly injectedExecutor: NovaStateExecutor | undefined;
  protected stateHandlers: NovaStateHandlers | null = null;

  /** Every player's latest controls (filled on the authority; ticks read it). */
  protected readonly controlsByMember = new Map<string, unknown>();
  /** This player's controls as last set, and as last sent to the authority. */
  protected myControls: { value: unknown; json: string } | null = null;
  protected sentControlsJson: string | null = null;
  protected controlsTimer: ReturnType<typeof setTimeout> | null = null;
  /** Controls go out at most once per tick (the game's declared rate). */
  protected controlsIntervalMs = 1000 / tickRateDefault;
  protected readonly isHost: (memberId: string) => boolean;
  protected readonly acceptStartRequest: (memberId: string) => boolean;

  protected readonly selfPlayer: PlayerRecord;
  protected readonly playersMap = new Map<string, PlayerRecord>();
  protected readonly gameByteBudget = new GameByteBudget();
  private readonly listeners = new Set<(event: NovaSessionEvent) => void>();
  private readonly transportUnsubscribers: Array<() => void> = [];
  protected readonly outbox: OutboxEntry[] = [];
  /** Dispatches held while no authority is known (election buffering). */
  protected readonly dispatchBuffer: BufferedDispatch[] = [];
  /** Dispatches sent but not yet acked (re-sent when the authority changes). */
  protected readonly inflightDispatches = new Map<string, BufferedDispatch>();
  /** Dispatches waiting for an in-flight state delta to settle. */
  protected readonly deltaWaiters: Array<() => void> = [];
  /** Protocol messages held while a state delta is being verified, in arrival order. */
  protected readonly deferredProtocolMessages: TransportMessage[] = [];
  /** Ack-timeout re-send timer per in-flight dispatch (cleared on ack). */
  protected readonly dispatchRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  protected nextSeq = 0;
  protected readySent = false;
  protected started = false;
  protected startEmitted = false;
  protected ended = false;
  private status: NovaConnectionStatus = "disconnected";
  private lastLeaderId: string | null = null;
  protected disposed = false;

  constructor(options: NovaSessionOptions) {
    this.transport = options.transport;
    this.room = options.room;
    this.sessionId = options.sessionId;
    this.game = options.game;
    this.injectedExecutor = options.stateExecutor;
    this.isHost = options.isHost ?? (() => false);
    this.acceptStartRequest = options.acceptStartRequest ?? (() => true);
    const memberId = options.player.memberId;
    this.selfPlayer = {
      id: memberId,
      name: options.player.displayName ?? memberId,
      connectionId: this.transport.selfConnectionId,
      ready: false,
      joinedAt: Date.now(),
      authorityEligible: true,
    };
    this.files = new GameFiles(
      this.transport,
      this.game.gameId,
      () => this.engine.getAuthorityMemberId(),
      (bytes) => this.gameByteBudget.consume(bytes, (event) => this.emit(event)),
    );
    this.client = createNovaClient(this);
    this.engine = new NovaStateEngine({
      host: this.buildEngineHost(),
      executor: this.injectedExecutor ?? new LocalGameExecutor(null),
      selfMemberId: memberId,
      ...(options.authority?.now !== undefined ? { now: options.authority.now } : {}),
      ...(options.authority?.heartbeatIntervalMs !== undefined
        ? { heartbeatIntervalMs: options.authority.heartbeatIntervalMs }
        : {}),
      ...(options.authority?.gracePeriodMs !== undefined
        ? { gracePeriodMs: options.authority.gracePeriodMs }
        : {}),
      ...(options.authority?.electionWindowMs !== undefined
        ? { electionWindowMs: options.authority.electionWindowMs }
        : {}),
      ...(options.authority?.restoreWindowMs !== undefined
        ? { restoreWindowMs: options.authority.restoreWindowMs }
        : {}),
      ...(options.authority?.playerLeaveGraceMs !== undefined
        ? { playerLeaveGraceMs: options.authority.playerLeaveGraceMs }
        : {}),
    });
  }

  /** This player's identity (never null — the session knows it). */
  get player(): NovaPlayer {
    return { id: this.selfPlayer.id, name: this.selfPlayer.name };
  }

  /** Every player in the party, self first, then peers in join order. */
  get players(): readonly NovaPlayer[] {
    return [this.player, ...[...this.playersMap.values()].map(toNovaPlayer)];
  }

  /** Host-side view of every connected peer, in join order. */
  get peerPlayers(): readonly NovaSessionPlayer[] {
    return [...this.playersMap.values()].map((player) => ({
      id: player.id,
      name: player.name,
      connectionId: player.connectionId,
      ready: player.ready,
      joinedAt: player.joinedAt,
      authorityEligible: player.authorityEligible,
    }));
  }

  /** The connected player who is the party host (`leaderId` to games), or null. */
  leaderId(): string | null {
    return this.players.find((player) => this.isHost(player.id))?.id ?? null;
  }

  /** Tell the game when the leader changed; the session calls it on joins and leaves. */
  refreshLeader(): void {
    const leaderId = this.leaderId();
    if (leaderId === this.lastLeaderId) return;
    this.lastLeaderId = leaderId;
    this.emit({ type: "leader", leaderId });
  }

  /** This player's current connection status. */
  get connectionStatus(): NovaConnectionStatus {
    return this.status;
  }

  /** State-size and action-rate diagnostics (host/arena visible). */
  getStateModeDiagnostics(): NovaStateDiagnostics {
    return this.engine.getDiagnostics();
  }

  /**
   * The replicated canonical state this shell retains for migration,
   * or null before the first snapshot. Host-side only — game
   * frames receive their selected view, never this state.
   */
  getCanonicalState(): {
    state: unknown;
    revision: number;
    stateHash: string | null;
    processedActionIds: readonly string[];
  } | null {
    if (this.engine.getCanonicalState() === null) {
      return null;
    }
    return {
      state: this.engine.getCanonicalState(),
      revision: this.engine.getRevision(),
      stateHash: this.engine.getDiagnostics().stateHash,
      processedActionIds: this.engine.processedActionIds(),
    };
  }

  /**
   * Re-send this session's start request while the authority has not started
   * the game (a request the authority rejected, for example before every
   * source was verified). A no-op for the elected authority, which starts the
   * game itself, and once this session has received the authority's start.
   */
  resendStartRequest(): void {
    if (!this.started || this.startEmitted || this.engine.isAuthorityElect()) return;
    void this.sendProtocol((base) => buildGameStartMessage(base)).catch((error: unknown) =>
      this.emitError(error),
    );
  }

  /** True once this session broadcast game start. */
  isStarted(): boolean {
    return this.started;
  }

  /**
   * Read-only diagnostics for stalled starts: whether this session has
   * requested the start, has emitted it locally, and which member it believes
   * is the elected authority (null before the game begins).
   */
  debugState(): {
    started: boolean;
    startEmitted: boolean;
    isAuthorityElect: boolean;
    authorityMemberId: string | null;
  } {
    return {
      started: this.started,
      startEmitted: this.startEmitted,
      isAuthorityElect: this.engine.isAuthorityElect(),
      authorityMemberId: this.engine.getAuthorityMemberId(),
    };
  }

  /** True once this session broadcast (or observed) game end. */
  isEnded(): boolean {
    return this.ended;
  }

  /** Host-side readiness of one player (by member id). */
  readyOf(memberId: string): boolean {
    if (memberId === this.selfPlayer.id) {
      return this.readySent;
    }
    return this.playersMap.get(memberId)?.ready ?? false;
  }

  /** Subscribe to session events (host-side; the client subscribes itself). */
  onSessionEvent(handler: (event: NovaSessionEvent) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  /**
   * Join the party: subscribe to transport events and join the room.
   * Outgoing messages sent before the join (e.g. `nova.ready()` called by
   * game code that runs before the host connects) are flushed on connect.
   */
  async join(): Promise<void> {
    this.assertAlive();
    this.wireTransport();
    await this.transport.join({ room: this.room, sessionId: this.sessionId });
    this.refreshLeader();
  }

  /**
   * Attach to an ALREADY-JOINED transport. The party layer
   * joins the private room inside `createParty`/`joinPartyByInvite`, so this
   * session never calls `transport.join()`; it wires the same listeners
   * {@link NovaSession.join} would, seeds the connection status from the
   * transport's current state, and replays the current peers so the session
   * observes the party state it missed while the transport was being
   * established (player lists, identity exchange, readiness).
   */
  async attach(): Promise<void> {
    this.assertAlive();
    this.wireTransport();
    this.status = mapConnectionState(this.transport.connectionState);
    this.emit({ type: "connection", status: this.status });
    for (const peer of this.transport.peers) {
      this.handlePeerJoined(peer);
    }
    this.refreshLeader();
  }

  /** Leave the party cleanly; pending outgoing messages are discarded. */
  async leave(): Promise<void> {
    this.assertAlive();
    this.outbox.length = 0;
    this.dispatchBuffer.length = 0;
    this.inflightDispatches.clear();
    for (const timer of this.dispatchRetryTimers.values()) {
      clearTimeout(timer);
    }
    this.dispatchRetryTimers.clear();
    // A left session can deliver nothing, so its tick stops here.
    this.engine.setTickRate(null);
    await this.transport.leave();
  }

  /**
   * Start the game (host/arena policy, never game code): broadcasts
   * `game.start`. The fixed initial authority first creates the
   * canonical state and publishes revision 1 + per-player views, then
   * announces, then broadcasts start — so every frame sees state and the
   * authority before `nova.onStart` fires. Followers broadcast start but
   * emit it locally only when the authority's `game.start` (or the catch-up
   * snapshot, for late joiners) arrives. Idempotent. A start request from
   * another member, received by the elected authority before it has started,
   * also calls this (see the `game.start` case).
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.engine.beginGame();
    if (this.engine.isAuthorityElect()) {
      void this.startAsAuthority().catch((error: unknown) => this.emitError(error));
    } else {
      void this.sendProtocol((base) => buildGameStartMessage(base)).catch((error: unknown) =>
        this.emitError(error),
      );
    }
  }

  private async startAsAuthority(): Promise<void> {
    const initialized = await this.engine.initializeAsAuthority();
    if (!initialized || this.ended || this.disposed) return;
    await this.sendProtocol((base) => buildGameStartMessage(base));
    if (this.startEmitted) return;
    this.startEmitted = true;
    this.emit({ type: "start" });
  }

  /**
   * End the game (host/arena policy, never game code): broadcasts
   * `game.end` and fires `nova.onEnd` locally. Idempotent.
   */
  end(reason: GameEndReason): void {
    if (this.ended) return;
    this.ended = true;
    this.files.dispose();
    this.engine.endGame();
    void this.sendProtocol((base) => buildGameEndMessage(base, reason)).catch((error: unknown) =>
      this.emitError(error),
    );
    this.emit({ type: "end", reason });
  }

  /** Tear down the session: unsubscribe, drop the outbox, detach the client. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.files.dispose();
    this.engine.dispose();
    if (this.controlsTimer !== null) clearTimeout(this.controlsTimer);
    for (const unsubscribe of this.transportUnsubscribers) {
      unsubscribe();
    }
    this.transportUnsubscribers.length = 0;
    this.outbox.length = 0;
    this.dispatchBuffer.length = 0;
    this.deferredProtocolMessages.length = 0;
    for (const resolve of this.deltaWaiters.splice(0)) resolve();
    this.inflightDispatches.clear();
    for (const timer of this.dispatchRetryTimers.values()) {
      clearTimeout(timer);
    }
    this.dispatchRetryTimers.clear();
    this.listeners.clear();
    this.client.dispose();
  }

  get apiVersion(): number {
    return NOVA_API_VERSION;
  }

  get self(): NovaPlayer {
    return this.player;
  }

  onEvent(handler: (event: NovaSessionEvent) => void): () => void {
    return this.onSessionEvent(handler);
  }

  private wireTransport(): void {
    this.files.attach();
    this.transportUnsubscribers.push(
      this.transport.on("connection:state", (state) => this.handleConnectionState(state)),
      this.transport.on("peer:joined", (peer) => this.handlePeerJoined(peer)),
      this.transport.on("peer:left", (peer) => this.handlePeerLeft(peer)),
      this.transport.on("peer:reconnected", () => this.handleReconnected()),
      this.transport.on("message:received", (message) => this.handleMessage(message)),
    );
  }

  private handleConnectionState(state: TransportConnectionState): void {
    this.status = mapConnectionState(state);
    if (state === "connected") {
      this.flushOutbox();
      this.engine.onSelfReconnected();
    }
    this.emit({ type: "connection", status: this.status });
  }

  private handlePeerJoined(peer: TransportPeerInfo): void {
    const existing = this.playersMap.get(peer.memberId);
    if (existing !== undefined) {
      // A reconnect of a known member (peer:left then peer:joined): update
      // the connection id and treat it as a fresh join.
      existing.connectionId = peer.connectionId;
      existing.name = peer.displayName ?? existing.name;
    } else {
      this.playersMap.set(peer.memberId, {
        id: peer.memberId,
        name: peer.displayName ?? peer.memberId,
        connectionId: peer.connectionId,
        ready: false,
        joinedAt: peer.joinedAt,
        authorityEligible: true,
      });
    }
    const joined = this.playersMap.get(peer.memberId);
    if (joined === undefined) return;
    // The game sees the new leader before the join that changed it.
    this.refreshLeader();
    this.emit({ type: "playerJoined", player: toNovaPlayer(joined) });
    this.engine.reconcileRoster();
    // The authority dropped this player's controls when the link went down.
    if (peer.memberId === this.engine.getAuthorityMemberId()) this.flushControls(true);
    // Identity exchange: tell the new peer who we are, and (if we already
    // announced ready) that we are ready.
    void this.sendProtocol(
      (base) =>
        buildPlayerIdentityMessage(base, this.selfPlayer.name, this.selfPlayer.authorityEligible),
      { targetMemberId: peer.memberId },
    ).catch((error: unknown) => this.emitError(error));
    if (this.readySent) {
      void this.sendProtocol((base) => buildGameReadyMessage(base), {
        targetMemberId: peer.memberId,
      }).catch((error: unknown) => this.emitError(error));
    }
    // Late joins: the authority hands the new shell the current canonical
    // state (migration copy) and computes the new player's selected view.
    if (this.started && this.engine.isAuthorityElect()) {
      if (this.engine.getCanonicalState() !== null) {
        this.sendCatchUp(peer.memberId, joined.name);
      }
    }
  }

  /** Send the current canonical state + the new player's view. */
  private sendCatchUp(memberId: string, displayName: string): void {
    const snapshot = this.engine.getDiagnostics();
    if (snapshot.revision === 0 || this.engine.getCanonicalState() === null) return;
    this.sendEngineSnapshot(
      {
        revision: snapshot.revision,
        stateHash: snapshot.stateHash,
        term: this.engine.getTerm(),
        authorityMemberId: this.selfPlayer.id,
        historyMode: "full",
        baseStateHash: null,
        stateMode: "full",
        ops: null,
        historyComplete: this.engine.isHistoryComplete(),
        ...this.engine.actionHistory(),
        state: this.engine.getCanonicalState(),
        viewIsState: this.engine.viewsAreState(),
        roster: this.engine.getRoster(),
      },
      memberId,
    );
    if (this.engine.viewsAreState()) return; // the snapshot is the joiner's view
    void this.engine
      .computeViewFor({ id: memberId, name: displayName })
      .catch((error: unknown) => this.emitError(error));
  }

  private handlePeerLeft(peer: TransportPeerInfo): void {
    const player = this.playersMap.get(peer.memberId);
    if (player === undefined) return;
    this.playersMap.delete(peer.memberId);
    this.controlsByMember.delete(peer.memberId);
    this.refreshLeader();
    this.emit({ type: "playerLeft", player: toNovaPlayer(player) });
    this.engine.reconcileRoster();
    if (this.engine.getAuthorityMemberId() === peer.memberId) {
      // The authority left: wait for election before applying more actions.
      // Every shell keeps the last committed state (never corrupted).
      this.engine.notifyAuthorityLeft();
    }
  }

  private handleReconnected(): void {
    this.selfPlayer.connectionId = this.transport.selfConnectionId;
    // The transport is already connected again (its rejoin completed before
    // the reconnected event fires): surface the transient reconnecting state,
    // then settle on connected so games never see a stuck "reconnecting".
    this.status = "reconnecting";
    this.emit({ type: "connection", status: this.status });
    this.status = "connected";
    this.emit({ type: "connection", status: this.status });
    this.engine.onSelfReconnected();
  }

  protected connectionIdOf(memberId: string): string | undefined {
    return this.playersMap.get(memberId)?.connectionId;
  }

  private playerOf(memberId: string): NovaPlayer {
    const player = this.playersMap.get(memberId);
    return player === undefined ? { id: memberId, name: memberId } : toNovaPlayer(player);
  }

  protected emit(event: NovaSessionEvent): void {
    for (const handler of this.listeners) {
      handler(event);
    }
  }

  protected emitError(error: unknown): void {
    this.emit({
      type: "error",
      error: error instanceof NovaError ? error : new NovaError("invalid_options", String(error)),
    });
  }

  protected assertAlive(): void {
    if (this.disposed) {
      throw new NovaError("ended", "NovaSession: session was disposed.");
    }
  }

  protected abstract buildEngineHost(): StateEngineHost;
  protected abstract sendProtocol(
    build: (base: PeerMessageBase) => PeerMessage,
    options?: { targetMemberId?: string; seq?: number },
  ): Promise<void>;
  protected abstract handleMessage(message: TransportMessage): void;
  protected abstract flushOutbox(): void;
  protected abstract flushControls(force?: boolean): void;
  protected abstract sendEngineSnapshot(
    snapshot: StateSnapshotEnvelope,
    targetMemberId?: string,
  ): void;
  abstract register(declaration: NovaGameDeclaration, handlers?: NovaStateHandlers): void;
  abstract ready(): void;
  abstract dispatch(action: NovaAction, actionId: string): Promise<void>;
  abstract setControls(value: unknown): void;
}
