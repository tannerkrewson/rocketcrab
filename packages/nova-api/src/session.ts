/**
 * The Nova session: the host-side engine that makes the game-facing
 * API function over the transport.
 *
 * A session owns one player's connection to the party: it joins the
 * transport, tracks players and connection status, exchanges validated
 * protocol messages, and drives the client object games use.
 * Everything here is transport-neutral — it implements {@link NovaClientBackend}
 * against {@link NovaTransport}, so the same session (and therefore the same
 * game code) works over InMemoryTransport (the test arena) and
 * TrysteroTransport (real parties). The game-facing client exposes no
 * Trystero terminology, authority roles, or hosting concepts.
 *
 * The session supports readiness, game start/end, player lists, connection
 * status, dispatch, state subscriptions, raw channels, simulation inputs,
 * and logging over the transport. State and simulation modes add authority election,
 * action application, snapshots and the simulation clock on top (see the
 * state and simulation engines).
 */
import type {
  NovaTransport,
  TransportConnectionState,
  TransportMessage,
  TransportPeerInfo,
} from "@rocketcrab/core";
import {
  PROTOCOL_VERSION,
  actionTimeoutMs,
  gameBytesBurst,
  gameBytesPerSecond,
  gameBytesWarn,
  parsePeerMessage,
  rawMessageBytes,
  rawRatePerSecond,
  rawMessageWarnBytes,
  rawWarnRatePerSecond,
  type GameEndReason,
  type GameMode,
  type PeerMessage,
} from "@rocketcrab/protocol";
import {
  createNovaClient,
  type NovaClient,
  type NovaClientBackend,
  type NovaSessionEvent,
} from "./client";
import { NOVA_PROTOCOL_CHANNEL } from "./constants";
import { NovaError, endedMessage, toErrorCode } from "./errors";
import { NOVA_API_VERSION } from "./version";
import { newInputId } from "./ids";
import {
  buildActionAckMessage,
  buildActionDispatchMessage,
  buildAuthorityAnnounceMessage,
  buildAuthorityElectionMessage,
  buildAuthorityHeartbeatMessage,
  buildGameEndMessage,
  buildGameReadyMessage,
  buildGameStartMessage,
  buildPlayerIdentityMessage,
  buildRawChannelCloseMessage,
  buildRawChannelMessage,
  buildSimulationInputMessage,
  buildSimulationSnapshotMessage,
  buildStateResyncMessage,
  buildStateSnapshotMessage,
  buildStateViewMessage,
  type PeerMessageBase,
} from "./messages";
import {
  NovaStateEngine,
  type AuthorityAnnounceEnvelope,
  type AuthorityElectionEnvelope,
  type AuthorityHeartbeatEnvelope,
  type StateEngineEvent,
  type StateEngineHost,
  type StateResyncEnvelope,
  type StateSnapshotEnvelope,
  type StateViewEnvelope,
} from "./state-engine";
import { LocalGameExecutor, type NovaStateExecutor } from "./state-executor";
import {
  LocalSimulationExecutor,
  NovaSimulationEngine,
  type NovaSimulationExecutor,
  type RetainedSimulationSnapshot,
  type SimulationEngineEvent,
  type SimulationEngineHost,
  type SimulationSnapshotEnvelope,
} from "./simulation-engine";
import type {
  NovaAction,
  NovaActionAck,
  NovaConnectionStatus,
  NovaGameDeclaration,
  NovaPlayer,
  NovaRawChannelSpec,
  NovaRawDiagnostics,
  NovaRawSendOptions,
  NovaSimulationDiagnostics,
  NovaSimulationHandlers,
  NovaSimulationInput,
  NovaSimulationSnapshot,
  NovaStateDiagnostics,
  NovaStateHandlers,
} from "./types";
import {
  assertStructuredCloneSafe,
  isBinaryPayload,
  novaActionSchema,
  novaRawChannelSpecSchema,
  novaSimulationInputSchema,
} from "./validation";

/** Options for {@link NovaSession}. */
export interface NovaSessionOptions {
  /** The transport-neutral connection this session drives. */
  readonly transport: NovaTransport;

  readonly room: string;
  /** Party session id that labels every message this session sends. */
  readonly sessionId: string;
  /** This player's identity (ADR-0007 member identity). */
  readonly player: { readonly memberId: string; readonly displayName?: string };
  /** The game being played (from the host bootstrap). */
  readonly game: {
    readonly gameId: string;
    readonly mode: GameMode;
    readonly title?: string;
    readonly version?: string;
  };
  /**
   * The state-mode executor. The arena injects a frame executor that
   * runs the game's handlers inside the authority's runtime frame; when
   * omitted, handlers registered through `nova.defineGame` run in-process
   * (contract suite / tests) with the real immer package.
   */
  readonly stateExecutor?: NovaStateExecutor;
  /**
   * The simulation-mode executor. The arena injects a frame executor
   * that asks the authority's game frame to serialize its simulation state
   * (`nova.simulation.register({ serializeState })`); when omitted, the
   * in-process handlers registered through `nova.simulation.register` run
   * directly (contract suite / tests).
   */
  readonly simulationExecutor?: NovaSimulationExecutor;
  /**
   * Decides whether a `game.start` request from another member starts the
   * game. The elected authority asks it for each request; a request it
   * rejects is ignored and reported as a session error. Omitted means every
   * admitted member's request is accepted (the arena and tests). The party
   * engine accepts only the host, once every member has the game source.
   */
  readonly acceptStartRequest?: (memberId: string) => boolean;
  /**
   * Simulation-mode configuration. Defaults follow the protocol
   * limits; values are clamped into the Nova bounds (see
   * `@rocketcrab/protocol` limits) so games can never exceed them.
   */
  readonly simulation?: {
    /** Simulation time step in ms (default 100 = 10 Hz; 16..500). */
    readonly tickMs?: number;
    /** Snapshot cadence in ms (default 1000; 50..10000). */
    readonly snapshotIntervalMs?: number;
    /** Epoch-ms clock (tests inject a fake). */
    readonly now?: () => number;
  };
  /**
   * Authority election timings (ADR-0007). Defaults follow the protocol
   * limits; tests inject small deterministic values with fake timers.
   */
  readonly authority?: {
    /** Authority heartbeat interval. */
    readonly heartbeatIntervalMs?: number;
    /** Missing-heartbeat grace period before suspicion. */
    readonly gracePeriodMs?: number;
    /** How long an election collects candidates before finalizing. */
    readonly electionWindowMs?: number;
    /** How long the winner collects state pushes before restoring. */
    readonly restoreWindowMs?: number;
    /** Epoch-ms clock (tests inject a fake). */
    readonly now?: () => number;
  };
}

/** One connected player as tracked by the session (host-side view). */
export interface NovaSessionPlayer extends NovaPlayer {
  readonly connectionId: string;
  readonly ready: boolean;
  readonly joinedAt: number;
  /** Authority eligibility (ADR-0007 member identity; all players are eligible). */
  readonly authorityEligible: boolean;
}

/** Internal mutable player record (the host-side view is a snapshot). */
interface PlayerRecord {
  id: string;
  name: string;
  connectionId: string;
  ready: boolean;
  joinedAt: number;
  authorityEligible: boolean;
}
/** One open raw channel (raw mode). Every raw channel is reliable and ordered. */
export interface NovaRawChannelState {
  /** True when THIS session declared the channel; peer declarations are informational. */
  readonly declaredBySelf: boolean;
}

/** Sliding-window send rate for the raw rate limit. */
interface RawRateWindow {
  /** Send timestamps within the window, in send order. */
  timestamps: number[];
  /** Sends rejected by the hard rate limit. */
  rejections: number;
}

/** Raw-mode traffic counters. */
interface RawStats {
  sent: number;
  received: number;
  sentBytes: number;
  receivedBytes: number;
  oversizedRejections: number;
  warned: boolean;
}

/** Length of the raw rate window (matches the state-mode action window). */
const RAW_RATE_WINDOW_MS = 10_000;

/** Messages allowed within one window: the per-second rate × window. */
const RAW_RATE_WINDOW_CAPACITY = Math.floor((rawRatePerSecond * RAW_RATE_WINDOW_MS) / 1000);

function mapConnectionState(state: TransportConnectionState): NovaConnectionStatus {
  switch (state) {
    case "idle":
      return "disconnected";
    case "joining":
      return "connecting";
    case "connected":
      return "connected";
    case "suspended":
      return "suspended";
    case "disconnected":
      return "disconnected";
  }
}

interface OutboxEntry {
  build: (base: PeerMessageBase) => PeerMessage;
  targetMemberId?: string;
  seq?: number;
}

/** One action dispatch held or in flight (election buffering). */
interface BufferedDispatch {
  readonly actionId: string;
  readonly type: string;
  readonly payload: unknown;
  readonly baseRevision: number;
  /**
   * When this dispatch stops being valid, fixed at first dispatch. Every send
   * carries this same expiry (never a fresh one), so a late copy cannot commit
   * an action the game was already told timed out.
   */
  readonly deadlineMs: number;
}

/** Interval between re-sends of an unacknowledged dispatch (half its lifetime). */
const dispatchRetryIntervalMs = actionTimeoutMs / 2;

/**
 * Hard cap on dispatches held while no authority is known. The byte budget
 * alone does not bound this (many tiny dispatches fit inside it), and an
 * overflow is refused at once rather than queued.
 */
const MAX_BUFFERED_DISPATCHES = 256;

/** Create a session over a transport and its game-facing client. */
export function createNovaSession(options: NovaSessionOptions): NovaSession {
  return new NovaSession(options);
}

export class NovaSession implements NovaClientBackend {
  readonly transport: NovaTransport;
  readonly room: string;
  readonly sessionId: string;
  readonly game: NovaSessionOptions["game"];

  /** The game-facing API object bound to this session. */
  readonly client: NovaClient;

  /** The schema-validated registration the game declared (informational). */
  declaration: NovaGameDeclaration | null = null;

  private readonly engine: NovaStateEngine;
  private readonly injectedExecutor: NovaStateExecutor | undefined;
  private stateHandlers: NovaStateHandlers | null = null;

  /** The simulation engine (simulation mode; inert in other modes). */
  private readonly simulationEngine: NovaSimulationEngine;
  private readonly injectedSimulationExecutor: NovaSimulationExecutor | undefined;
  private readonly acceptStartRequest: (memberId: string) => boolean;

  private readonly selfPlayer: PlayerRecord;
  private readonly playersMap = new Map<string, PlayerRecord>();
  private readonly channels = new Map<string, NovaRawChannelState>();
  private readonly rawStats: RawStats = {
    sent: 0,
    received: 0,
    sentBytes: 0,
    receivedBytes: 0,
    oversizedRejections: 0,
    warned: false,
  };
  private readonly rawRate: RawRateWindow = { timestamps: [], rejections: 0 };
  private gameByteTokens = gameBytesBurst;
  private gameByteUpdatedAt = performance.now();
  private gameByteWarned = false;
  private readonly listeners = new Set<(event: NovaSessionEvent) => void>();
  private readonly transportUnsubscribers: Array<() => void> = [];
  private readonly outbox: OutboxEntry[] = [];
  /** Dispatches held while no authority is known (election buffering). */
  private readonly dispatchBuffer: BufferedDispatch[] = [];
  /** Dispatches sent but not yet acked (re-sent when the authority changes). */
  private readonly inflightDispatches = new Map<string, BufferedDispatch>();
  /** Dispatches waiting for an in-flight state delta to settle. */
  private readonly deltaWaiters: Array<() => void> = [];
  /** Protocol messages held while a state delta is being verified, in arrival order. */
  private readonly deferredProtocolMessages: TransportMessage[] = [];
  /** Ack-timeout re-send timer per in-flight dispatch (cleared on ack). */
  private readonly dispatchRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private nextSeq = 0;
  private readySent = false;
  private started = false;
  private startEmitted = false;
  private ended = false;
  private status: NovaConnectionStatus = "disconnected";
  private disposed = false;

  constructor(options: NovaSessionOptions) {
    this.transport = options.transport;
    this.room = options.room;
    this.sessionId = options.sessionId;
    this.game = options.game;
    this.injectedExecutor = options.stateExecutor;
    this.injectedSimulationExecutor = options.simulationExecutor;
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
    this.client = createNovaClient(this);
    this.engine = new NovaStateEngine({
      host: this.engineHost,
      executor: this.injectedExecutor ?? new LocalGameExecutor(null),
      selfMemberId: memberId,
      simulation: options.game.mode === "simulation",
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
    });
    this.simulationEngine = new NovaSimulationEngine({
      host: this.simulationHost,
      executor: this.injectedSimulationExecutor ?? new LocalSimulationExecutor(null),
      selfMemberId: memberId,
      ...(options.simulation?.tickMs !== undefined ? { tickMs: options.simulation.tickMs } : {}),
      ...(options.simulation?.snapshotIntervalMs !== undefined
        ? { snapshotIntervalMs: options.simulation.snapshotIntervalMs }
        : {}),
      ...(options.authority?.restoreWindowMs !== undefined
        ? { restoreWindowMs: options.authority.restoreWindowMs }
        : {}),
      ...(options.simulation?.now !== undefined
        ? { now: options.simulation.now }
        : options.authority?.now !== undefined
          ? { now: options.authority.now }
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

  /** This player's current connection status. */
  get connectionStatus(): NovaConnectionStatus {
    return this.status;
  }

  /** State-size and action-rate diagnostics (host/arena visible). */
  getStateModeDiagnostics(): NovaStateDiagnostics {
    return this.engine.getDiagnostics();
  }

  /** Simulation diagnostics (host/arena visible). */
  getSimulationDiagnostics(): NovaSimulationDiagnostics {
    return this.simulationEngine.getDiagnostics();
  }

  /**
   * The latest replicated authoritative simulation snapshot this shell
   * retains (host-side only — the game frame receives it through
   * `nova.simulation`'s `onSnapshot`). Null before the first snapshot.
   */
  getSimulationSnapshot(): {
    tick: number;
    state: unknown;
    stateHash: string | null;
  } | null {
    return this.simulationEngine.getLatestSnapshot();
  }

  /** Raw-mode traffic diagnostics (host/arena visible). */
  getRawDiagnostics(): NovaRawDiagnostics {
    this.pruneRawRateWindow();
    return {
      channelCount: this.channels.size,
      selfDeclaredChannelCount: this.selfDeclaredChannelCount(),
      sentCount: this.rawStats.sent,
      receivedCount: this.rawStats.received,
      sentBytes: this.rawStats.sentBytes,
      receivedBytes: this.rawStats.receivedBytes,
      oversizedRejections: this.rawStats.oversizedRejections,
      rateLimitRejections: this.rawRate.rejections,
      ratePerSecond: this.rawRatePerSecond(),
      warned: this.rawStats.warned,
    };
  }

  /**
   * The replicated canonical state this shell retains for migration
   * (ADR-0007), or null before the first snapshot. Host-side only — game
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
    // A left session can deliver nothing, so its clock and snapshot cadence
    // stop here; otherwise they keep ticking and queue snapshots forever.
    this.simulationEngine.end();
    await this.transport.leave();
  }

  /**
   * Start the game (host/arena policy, never game code): broadcasts
   * `game.start`. The fixed initial authority (ADR-0007) first creates the
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
    if (this.game.mode === "simulation") {
      // The initial authority's simulation engine starts producing
      // snapshots (no canonical state to create in simulation mode).
      this.simulationEngine.onAuthorityChanged(this.selfPlayer.id, this.engine.getTerm());
    }
    await this.sendProtocol((base) => buildGameStartMessage(base));
    if (this.startEmitted) return;
    this.startEmitted = true;
    this.emit({ type: "start" });
    if (this.game.mode === "simulation") {
      // Every session runs its own local clock from game start.
      this.simulationEngine.begin();
    }
  }

  /**
   * End the game (host/arena policy, never game code): broadcasts
   * `game.end` and fires `nova.onEnd` locally. Idempotent.
   */
  end(reason: GameEndReason): void {
    if (this.ended) return;
    this.ended = true;
    this.engine.endGame();
    this.simulationEngine.end();
    void this.sendProtocol((base) => buildGameEndMessage(base, reason)).catch((error: unknown) =>
      this.emitError(error),
    );
    this.emit({ type: "end", reason });
  }

  /** Tear down the session: unsubscribe, drop the outbox, detach the client. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.engine.dispose();
    this.simulationEngine.dispose();
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

  // ------------------------------------------------------------------
  // NovaClientBackend (called by the game-facing client)
  // ------------------------------------------------------------------

  get apiVersion(): number {
    return NOVA_API_VERSION;
  }

  get self(): NovaPlayer {
    return this.player;
  }

  register(declaration: NovaGameDeclaration, handlers?: NovaStateHandlers): void {
    this.assertAlive();
    this.declaration = declaration;
    if (handlers !== undefined) {
      this.stateHandlers = handlers;
      if (this.injectedExecutor === undefined) {
        this.engine.setExecutor(new LocalGameExecutor(handlers));
      }
    }
  }

  ready(): void {
    this.assertAlive();
    this.readySent = true;
    this.selfPlayer.ready = true;
    void this.sendProtocol((base) => buildGameReadyMessage(base)).catch((error: unknown) =>
      this.emitError(error),
    );
  }

  /**
   * Dispatch one action: validate, assign the base revision, and
   * either apply locally (this session is the current authority), send the
   * action to the authority, or — when no authority is known (election in
   * progress) — buffer it until the new authority is announced (ADR-0007:
   * actions buffer during election). In-flight dispatches are re-sent when
   * the authority changes so an action whose ack was lost in a migration is
   * applied exactly once (history + queue deduplication). Resolves once the
   * action is accepted for delivery; the game-facing promise resolves on the
   * authority's ack (see the client).
   */
  async dispatch(action: NovaAction, actionId: string): Promise<void> {
    this.assertAlive();
    assertValidSchema(
      novaActionSchema.safeParse(action),
      "nova.dispatch options failed validation.",
    );
    assertStructuredCloneSafe(action.payload, "nova.dispatch action payload");
    if (typeof actionId !== "string" || actionId.length < 1 || actionId.length > 64) {
      throw new NovaError("invalid_options", "nova.dispatch action id must be 1..64 characters.");
    }
    if (this.engine.isEnded()) {
      throw new NovaError("ended", endedMessage("dispatch"));
    }
    if (this.engine.isDeltaPending()) {
      // The base revision must be the state the game last saw: wait for the
      // delta in flight to settle, so an action is never stamped with a stale base.
      await new Promise<void>((resolve) => this.deltaWaiters.push(resolve));
    }
    this.consumeGameBytes(rawPayloadBytes(action));
    const baseRevision = action.baseRevision ?? this.engine.getRevision();
    const authority = this.engine.getAuthorityMemberId();
    const entry: BufferedDispatch = {
      actionId,
      type: action.type,
      payload: action.payload,
      baseRevision,
      deadlineMs: Date.now() + actionTimeoutMs,
    };
    if (authority === this.selfPlayer.id) {
      // Local dispatch on the authority session (no transport round trip).
      // Track it in-flight so that if the authority steps down mid-commit
      // (the async state-hash digest can race a peer campaign), the action
      // is re-sent to the new authority by flushDispatchBuffer and applied
      // exactly once (deduplication on the new authority; ADR-0007). The
      // local ack (any status) removes the entry.
      this.trackInflight(entry);
      this.engine.handleLocalAction({
        actionId,
        type: action.type,
        payload: action.payload,
        baseRevision,
      });
      return Promise.resolve();
    }
    if (authority === null) {
      // Election in progress (or authority unknown): buffer until the new
      // authority is announced (the client promise resolves on its ack).
      if (this.dispatchBuffer.length >= MAX_BUFFERED_DISPATCHES) {
        // Entries past their deadline can never be applied: free their slots
        // before refusing anything new.
        const now = Date.now();
        const live = this.dispatchBuffer.filter((held) => held.deadlineMs > now);
        this.dispatchBuffer.splice(0, this.dispatchBuffer.length, ...live);
        if (this.dispatchBuffer.length >= MAX_BUFFERED_DISPATCHES) {
          throw new NovaError(
            "rate_limited",
            `nova.dispatch was refused: ${MAX_BUFFERED_DISPATCHES} actions are already waiting for an authority.`,
          );
        }
      }
      this.dispatchBuffer.push(entry);
      return Promise.resolve();
    }
    this.trackInflight(entry);
    this.sendBufferedDispatch(entry);
    return Promise.resolve();
  }

  createRawChannel(spec: NovaRawChannelSpec): void {
    this.assertAlive();
    assertValidSchema(
      novaRawChannelSpecSchema.safeParse(spec),
      "nova.raw.createChannel options failed validation.",
    );
    if (spec.name === NOVA_PROTOCOL_CHANNEL) {
      throw new NovaError(
        "reserved_channel",
        `Raw channel name "${spec.name}" is reserved by the Nova protocol.`,
      );
    }
    if (this.channels.has(spec.name)) {
      throw new NovaError(
        "invalid_options",
        `Raw channel "${spec.name}" was already created (nova.raw.createChannel once per channel).`,
      );
    }
    this.channels.set(spec.name, { declaredBySelf: true });
    void this.sendProtocol((base) =>
      buildRawChannelMessage(base, { channelName: spec.name }),
    ).catch((error: unknown) => this.emitError(error));
  }

  /**
   * Close a raw channel: local sends on it fail with
   * `unknown_channel` afterwards and peers are told the channel closed.
   * Peers that declared the channel themselves keep their own declaration.
   * Idempotent: closing an unknown channel is a no-op.
   */
  closeRawChannel(name: string): void {
    this.assertAlive();
    const channel = this.channels.get(name);
    // Only a self declaration can be closed; peer declarations are
    // informational (idempotent close for unknown/peer-only channels).
    if (channel === undefined || !channel.declaredBySelf) {
      return;
    }
    this.channels.delete(name);
    void this.sendProtocol((base) => buildRawChannelCloseMessage(base, name)).catch(
      (error: unknown) => this.emitError(error),
    );
  }

  async sendRaw(name: string, payload: unknown, options: NovaRawSendOptions = {}): Promise<void> {
    this.assertAlive();
    const channel = this.channels.get(name);
    // Sending requires this session's own declaration (create the channel
    // before sending on it). Peer declarations are lifecycle
    // bookkeeping only and never authorize sends.
    if (channel === undefined || !channel.declaredBySelf) {
      throw new NovaError(
        "unknown_channel",
        `No raw channel named "${name}" was created (nova.raw.createChannel first).`,
      );
    }
    if (this.transport.connectionState !== "connected") {
      throw new NovaError(
        "not_connected",
        `nova.raw.send failed: not connected to the party (status: ${this.status}).`,
      );
    }
    // Size limit: payloads are measured at the send boundary
    // (byte length for binary, UTF-8 serialized size for structured data).
    // Oversized sends are rejected with a clear error so the host can show a
    // diagnostic; the warn threshold is recorded for the diagnostics view.
    const sizeBytes = rawPayloadBytes(payload);
    if (sizeBytes > rawMessageBytes) {
      this.rawStats.oversizedRejections += 1;
      throw new NovaError(
        "payload_too_large",
        `The raw payload on channel "${name}" is ${sizeBytes} bytes; the hard limit is ${rawMessageBytes} bytes.`,
      );
    }
    if (sizeBytes > rawMessageWarnBytes) {
      this.rawStats.warned = true;
    }
    // Raw rate limit: a sliding 10-second window of sends per player. Bursts
    // beyond the hard rate are rejected with a clear error (diagnostics).
    // The per-window cap is the per-second rate × window length, so the
    // diagnostic `ratePerSecond` stays comparable to state-mode action rates.
    this.recordRawSend();
    if (this.rawRate.timestamps.length > RAW_RATE_WINDOW_CAPACITY) {
      this.rawRate.rejections += 1;
      throw new NovaError(
        "rate_limited",
        `Raw send on channel "${name}" exceeded ${rawRatePerSecond} messages/second; the send was dropped.`,
      );
    }
    if (this.rawRatePerSecond() > rawWarnRatePerSecond) {
      this.rawStats.warned = true;
    }
    const targetConnectionId =
      options.to === undefined ? undefined : this.connectionIdOf(options.to);
    if (options.to !== undefined && targetConnectionId === undefined) {
      throw new NovaError("not_connected", `Player "${options.to}" is not connected.`);
    }
    this.consumeGameBytes(Math.max(1, sizeBytes));
    this.rawStats.sent += 1;
    this.rawStats.sentBytes += sizeBytes;
    await this.transport.send({
      channel: name,
      payload,
      binary: isBinaryPayload(payload),
      reliability: "reliable",
      ordering: "ordered",
      ...(targetConnectionId !== undefined ? { targetConnectionId } : {}),
    });
  }

  /**
   * Signal that the game registered simulation handlers. In-process
   * games pass the handlers so the session can run `serializeState` for
   * snapshot production; the frame bridge never sends functions, and the
   * arena injects a frame executor that talks to the authority's frame
   * instead.
   */
  registerSimulation(handlers?: NovaSimulationHandlers): void {
    this.assertAlive();
    if (handlers !== undefined && this.injectedSimulationExecutor === undefined) {
      this.simulationEngine.setExecutor(new LocalSimulationExecutor(handlers));
    }
  }

  sendSimulationInput(input: NovaSimulationInput): void {
    this.assertAlive();
    assertValidSchema(
      novaSimulationInputSchema.safeParse(input),
      "nova.simulation.sendInput options failed validation.",
    );
    assertStructuredCloneSafe(input.payload, "nova.simulation.sendInput payload");
    if (!this.simulationEngine.recordInputSent()) {
      throw new NovaError(
        "rate_limited",
        "nova.simulation.sendInput exceeded the input rate limit; the input was dropped.",
      );
    }
    this.consumeGameBytes(rawPayloadBytes(input));
    const seq = (this.nextSeq += 1);
    const inputId = newInputId();
    void this.sendProtocol(
      (base) =>
        buildSimulationInputMessage(base, {
          seq,
          inputId,
          inputType: input.type,
          payload: input.payload,
          targetTick: input.tick,
        }),
      { seq },
    ).catch((error: unknown) => this.emitError(error));
    // Local loop-back: the sender's own frame receives its input exactly
    // like every other player's (a uniform onInput contract — the game
    // applies every input, including its own, in onInput/onTick; the
    // transport never loops a broadcast back to its sender).
    this.simulationEngine.handleInputReceived(Date.now());
    this.emit({
      type: "simulationInput",
      input: {
        type: input.type,
        payload: input.payload,
        ...(input.tick !== undefined ? { tick: input.tick } : {}),
        sender: this.player,
      },
    });
  }

  onEvent(handler: (event: NovaSessionEvent) => void): () => void {
    return this.onSessionEvent(handler);
  }

  // ------------------------------------------------------------------
  // Transport event handling
  // ------------------------------------------------------------------

  private wireTransport(): void {
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
    this.emit({ type: "playerJoined", player: toNovaPlayer(joined) });
    // Identity exchange: tell the new peer who we are, and (if we already
    // announced ready) that we are ready.
    void this.sendProtocol((base) => buildPlayerIdentityMessage(base, this.selfPlayer.name), {
      targetMemberId: peer.memberId,
    }).catch((error: unknown) => this.emitError(error));
    if (this.readySent) {
      void this.sendProtocol((base) => buildGameReadyMessage(base), {
        targetMemberId: peer.memberId,
      }).catch((error: unknown) => this.emitError(error));
    }
    // Re-announce open raw channels to mid-game joiners on the ordered
    // protocol channel. Peer declarations allow subscriptions, not sends;
    // sending still requires the joiner's own declaration.
    for (const [channelName, state] of this.channels) {
      if (!state.declaredBySelf) {
        continue;
      }
      void this.sendProtocol((base) => buildRawChannelMessage(base, { channelName }), {
        targetMemberId: peer.memberId,
      }).catch((error: unknown) => this.emitError(error));
    }
    // State-mode late join: the authority hands the new shell the current canonical
    // state (migration copy) and computes the new player's selected view.
    // Simulation-mode late join: the authority sends its latest authoritative
    // snapshot (the joiner restores from it and starts).
    if (this.started && this.engine.isAuthorityElect()) {
      if (this.game.mode === "simulation") {
        this.sendSimulationCatchUp(peer.memberId);
      } else if (this.engine.getCanonicalState() !== null) {
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
        processedActionIds: this.engine.processedActionIds(),
        state: this.engine.getCanonicalState(),
      },
      memberId,
    );
    void this.engine
      .computeViewFor({ id: memberId, name: displayName })
      .catch((error: unknown) => this.emitError(error));
  }

  private handlePeerLeft(peer: TransportPeerInfo): void {
    const player = this.playersMap.get(peer.memberId);
    if (player === undefined) return;
    this.playersMap.delete(peer.memberId);
    this.emit({ type: "playerLeft", player: toNovaPlayer(player) });
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

  private handleMessage(message: TransportMessage): void {
    if (message.channel !== NOVA_PROTOCOL_CHANNEL) {
      this.handleRawMessage(message);
      return;
    }
    if (this.engine.isDeltaPending()) {
      // A delta's hash is still being checked: the view and acks that follow
      // it must not reach the game before the state they belong to.
      this.deferredProtocolMessages.push(message);
      return;
    }
    const parsed = parsePeerMessage(message.payload);
    if (!parsed.ok) {
      this.emit({
        type: "error",
        error: new NovaError(
          "invalid_message",
          `Received an invalid protocol message: ${parsed.error.message}`,
        ),
      });
      return;
    }
    const peerMessage = parsed.value;
    switch (peerMessage.type) {
      case "player.identity": {
        const player = this.playersMap.get(peerMessage.senderMemberId);
        if (player !== undefined) {
          player.name = peerMessage.displayName;
          player.authorityEligible = peerMessage.authorityEligible;
        }
        // A peer that introduces itself may have attached its session after
        // our readiness announcement was sent: re-send our ready state so no
        // member is left thinking we are not ready.
        if (this.readySent) {
          void this.sendProtocol((base) => buildGameReadyMessage(base), {
            targetMemberId: peerMessage.senderMemberId,
          }).catch((error: unknown) => this.emitError(error));
        }
        break;
      }
      case "game.ready": {
        const player = this.playersMap.get(peerMessage.senderMemberId);
        // Only a change is news: a duplicate game.ready must not re-render.
        if (player !== undefined && !player.ready) {
          player.ready = true;
          this.emit({ type: "ready", memberId: player.id });
        }
        break;
      }
      case "game.start":
        // Followers emit start only when the authority's announcement
        // arrived first (same ordered channel), so frames never see onStart
        // before state and the authority are known.
        if (
          !this.startEmitted &&
          peerMessage.senderMemberId === this.engine.getAuthorityMemberId()
        ) {
          this.startEmitted = true;
          this.engine.beginGame();
          this.emit({ type: "start" });
          if (this.game.mode === "simulation") {
            // Every session runs its own local clock from game start.
            this.simulationEngine.begin();
          }
          break;
        }
        // A start request from another admitted member. The lowest eligible
        // member is the elected authority, and it is the only session that
        // can start the game as authority. A host that is not the lowest id
        // (the host's own start() sends game.start as a follower) would
        // otherwise leave the game stuck in "starting". The elected authority
        // honours the request only if `acceptStartRequest` allows it (the
        // party engine: the host, once sources are verified); it then calls
        // start(), whose authoritative game.start the others accept above.
        if (
          !this.started &&
          this.engine.wouldElectSelf() &&
          this.playersMap.has(peerMessage.senderMemberId)
        ) {
          if (this.acceptStartRequest(peerMessage.senderMemberId)) {
            this.start();
          } else {
            this.emitError(
              new NovaError(
                "invalid_state",
                `Ignored a start request from ${peerMessage.senderMemberId}: only the host can start the game, once every player has the source.`,
              ),
            );
          }
        }
        break;
      case "game.end":
        if (!this.ended) {
          this.ended = true;
          this.engine.endGame();
          this.emit({ type: "end", reason: peerMessage.reason });
        }
        break;
      case "action.dispatch":
        // Every shell routes the dispatch to its
        // engine, which applies only when this session is the current
        // authority (other shells drop it and re-send on authority change).
        this.emit({
          type: "actionReceived",
          action: {
            type: peerMessage.actionType,
            payload: peerMessage.payload,
            baseRevision: peerMessage.baseRevision,
          },
        });
        this.engine.handleInboundAction({
          actionId: peerMessage.actionId,
          seq: peerMessage.seq,
          actionType: peerMessage.actionType,
          payload: peerMessage.payload,
          baseRevision: peerMessage.baseRevision,
          sentAt: peerMessage.sentAt,
          ...(peerMessage.expiresAtMs !== undefined
            ? { expiresAtMs: peerMessage.expiresAtMs }
            : {}),
          senderMemberId: peerMessage.senderMemberId,
        });
        break;
      case "action.ack":
        this.noteActionAck(peerMessage.actionId);
        this.emit({
          type: "actionAck",
          ack: {
            actionId: peerMessage.actionId,
            status: peerMessage.status,
            ...(peerMessage.revision !== undefined ? { revision: peerMessage.revision } : {}),
            ...(peerMessage.errorCode !== undefined ? { errorCode: peerMessage.errorCode } : {}),
            ...(peerMessage.errorMessage !== undefined
              ? { errorMessage: peerMessage.errorMessage }
              : {}),
          },
        });
        break;
      case "state.snapshot":
        // Canonical state is replicated to every shell for migration; only
        // the player's selected view ever reaches the game frame.
        this.engine.handleSnapshot({
          revision: peerMessage.revision,
          stateHash: peerMessage.stateHash ?? null,
          term: peerMessage.term,
          authorityMemberId: peerMessage.authorityMemberId,
          historyMode: peerMessage.historyMode,
          baseStateHash: peerMessage.baseStateHash ?? null,
          historyComplete: peerMessage.historyComplete,
          stateMode: peerMessage.stateMode,
          ...(peerMessage.ops !== undefined ? { ops: peerMessage.ops } : {}),
          processedActionIds: peerMessage.processedActionIds,
          state: peerMessage.state,
          senderMemberId: peerMessage.senderMemberId,
        });
        if (!this.startEmitted) {
          // A late joiner starts from the catch-up snapshot.
          this.startEmitted = true;
          this.engine.beginGame();
          this.emit({ type: "start" });
        }
        break;
      case "state.resync":
        this.engine.handleResync({
          requesterMemberId: peerMessage.senderMemberId,
          knownRevision: peerMessage.knownRevision,
        });
        break;
      case "state.view":
        if (peerMessage.forMemberId === this.selfPlayer.id) {
          this.emit({ type: "state", state: peerMessage.view });
        }
        break;
      case "authority.announce":
        this.engine.handleAnnounce({
          term: peerMessage.term,
          authorityMemberId: peerMessage.authorityMemberId,
          stateRevision: peerMessage.stateRevision,
          ...(peerMessage.stateHash !== undefined ? { stateHash: peerMessage.stateHash } : {}),
          eligibleMemberIds: peerMessage.eligibleMemberIds,
        });
        break;
      case "authority.heartbeat":
        this.engine.handleHeartbeat({
          term: peerMessage.term,
          authorityMemberId: peerMessage.authorityMemberId,
          stateRevision: peerMessage.stateRevision,
          heartbeatSeq: peerMessage.heartbeatSeq,
        });
        break;
      case "authority.election":
        this.engine.handleElection({
          term: peerMessage.term,
          candidateMemberId: peerMessage.candidateMemberId,
          observed: peerMessage.observed,
        });
        break;
      case "simulation.input":
        this.simulationEngine.handleInputReceived(peerMessage.sentAt);
        this.emit({
          type: "simulationInput",
          input: {
            type: peerMessage.inputType,
            payload: peerMessage.payload,
            ...(peerMessage.targetTick !== undefined ? { tick: peerMessage.targetTick } : {}),
            sender: this.playerOf(peerMessage.senderMemberId),
          },
        });
        break;
      case "simulation.snapshot": {
        const retained = this.simulationEngine.handleSnapshot({
          tick: peerMessage.tick,
          term: peerMessage.term,
          authorityMemberId: peerMessage.authorityMemberId,
          stateHash: peerMessage.stateHash ?? null,
          state: peerMessage.state,
          sentAt: peerMessage.sentAt,
        });
        if (retained === null) break;
        if (!this.startEmitted) {
          // A late joiner starts from the targeted catch-up snapshot.
          this.startEmitted = true;
          this.engine.beginGame();
          this.simulationEngine.begin();
          this.emit({ type: "start" });
        }
        this.emit({
          type: "simulationSnapshot",
          snapshot: toNovaSimulationSnapshot(retained),
        });
        break;
      }
      case "raw.channel":
        // Peer channel declarations are recorded so channel lifecycle works
        // across the party: the session knows which names are in use, peer
        // closes remove only peer declarations, and this session re-announces
        // its own declarations when a peer joins mid-game.
        if (!this.channels.has(peerMessage.channelName)) {
          this.channels.set(peerMessage.channelName, { declaredBySelf: false });
        }
        break;
      case "raw.close": {
        // A peer closed its channel: drop the peer's declaration. A channel
        // this session declared itself stays open (each player owns its own
        // declarations; closing is per-declaring-player).
        const existing = this.channels.get(peerMessage.channelName);
        if (existing !== undefined && !existing.declaredBySelf) {
          this.channels.delete(peerMessage.channelName);
        }
        break;
      }
      default:
        // Capability, party, source, and connection-status messages stay on the
        // host side; the game-facing API does not expose them.
        break;
    }
  }

  private handleRawMessage(message: TransportMessage): void {
    this.rawStats.received += 1;
    this.rawStats.receivedBytes += rawPayloadBytes(message.payload);
    this.emit({
      type: "rawMessage",
      channel: message.channel,
      message: {
        from: this.playerOf(message.senderMemberId),
        payload: message.payload,
        binary: message.binary,
      },
    });
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /**
   * Send one buffered/in-flight dispatch to the current authority. Only the
   * authority applies dispatches (`handleInboundAction`), so the message is
   * targeted at it; a dispatch lost to a stale view is re-sent by
   * `flushDispatchBuffer` when the authority changes.
   */
  private sendBufferedDispatch(entry: BufferedDispatch): void {
    const authority = this.engine.getAuthorityMemberId();
    if (authority === this.selfPlayer.id) {
      this.engine.handleLocalAction({
        actionId: entry.actionId,
        type: entry.type,
        payload: entry.payload,
        baseRevision: entry.baseRevision,
      });
      return;
    }
    if (authority === null) return; // still electing; keep buffered
    const seq = this.takeSeq();
    void this.sendProtocol(
      (base) =>
        buildActionDispatchMessage(base, {
          seq,
          actionId: entry.actionId,
          baseRevision: entry.baseRevision,
          actionType: entry.type,
          payload: entry.payload,
          expiresAtMs: entry.deadlineMs,
        }),
      { seq, targetMemberId: authority },
    ).catch((error: unknown) => this.emitError(error));
  }

  /**
   * The authority changed: flush buffered dispatches toward the new
   * authority and re-send in-flight ones whose ack may have been lost in the
   * migration. Deduplication on the authority side (history + queue) makes
   * the re-sends exactly-once.
   */
  private flushDispatchBuffer(): void {
    const authority = this.engine.getAuthorityMemberId();
    if (authority === null) return;
    // Buffered entries become in-flight here and are sent exactly once: the
    // second loop covers everything in flight, including them.
    for (const entry of this.dispatchBuffer.splice(0)) {
      if (Date.now() < entry.deadlineMs) this.trackInflight(entry);
    }
    for (const entry of this.inflightDispatches.values()) {
      this.sendBufferedDispatch(entry);
    }
  }

  /**
   * Hold a dispatch as in flight until its ack arrives. While it is unacked,
   * re-send it to the current authority view every `dispatchRetryIntervalMs`,
   * and stop at its deadline. The authority deduplicates, so a re-send can
   * never apply the action twice, and the fixed deadline stops a late copy
   * from committing after the game was told the action timed out.
   */
  private trackInflight(entry: BufferedDispatch): void {
    this.inflightDispatches.set(entry.actionId, entry);
    this.armDispatchRetry(entry.actionId);
  }

  private armDispatchRetry(actionId: string): void {
    this.clearDispatchRetry(actionId);
    const timer = setTimeout(() => {
      this.dispatchRetryTimers.delete(actionId);
      const entry = this.inflightDispatches.get(actionId);
      if (entry === undefined || this.disposed || this.ended) return;
      if (Date.now() >= entry.deadlineMs) {
        // Expired: stop, so no copy can be sent (or applied) after the deadline.
        this.inflightDispatches.delete(actionId);
        return;
      }
      this.sendBufferedDispatch(entry);
      this.armDispatchRetry(actionId);
    }, dispatchRetryIntervalMs);
    this.dispatchRetryTimers.set(actionId, timer);
  }

  private clearDispatchRetry(actionId: string): void {
    const timer = this.dispatchRetryTimers.get(actionId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.dispatchRetryTimers.delete(actionId);
    }
  }

  /** Replay held protocol messages, in order, until another delta is pending. */
  private drainDeferredProtocolMessages(): void {
    while (this.deferredProtocolMessages.length > 0 && !this.engine.isDeltaPending()) {
      const next = this.deferredProtocolMessages.shift();
      if (next !== undefined) this.handleMessage(next);
    }
  }

  /** Drop an in-flight dispatch once its ack arrived (any status). */
  private noteActionAck(actionId: string): void {
    this.inflightDispatches.delete(actionId);
    this.clearDispatchRetry(actionId);
  }

  /** The transport-facing half the simulation engine uses to send/emit. */
  private get simulationHost(): SimulationEngineHost {
    return {
      players: () => this.players,
      sendSnapshot: (snapshot, targetMemberId) =>
        this.sendSimulationSnapshot(snapshot, targetMemberId),
      emit: (event) => this.handleSimulationEvent(event),
    };
  }

  private handleSimulationEvent(event: SimulationEngineEvent): void {
    switch (event.type) {
      case "tick":
        this.emit({ type: "simulationTick", tick: event.tick });
        break;
      case "error":
        this.emit({ type: "error", error: new NovaError(toErrorCode(event.code), event.message) });
        break;
    }
  }

  /** Send a simulation snapshot (broadcast, or targeted at one shell). */
  private sendSimulationSnapshot(
    snapshot: SimulationSnapshotEnvelope,
    targetMemberId?: string,
  ): void {
    const seq = this.takeSeq();
    const options: { targetMemberId?: string } = {};
    if (targetMemberId !== undefined) {
      options.targetMemberId = targetMemberId;
    }
    void this.sendProtocol(
      (base) =>
        buildSimulationSnapshotMessage(base, {
          seq,
          tick: snapshot.tick,
          ...(snapshot.stateHash !== null ? { stateHash: snapshot.stateHash } : {}),
          term: snapshot.term,
          authorityMemberId: snapshot.authorityMemberId,
          state: snapshot.state,
        }),
      options,
    ).catch((error: unknown) => this.emitError(error));
  }

  /** Send the latest authoritative simulation snapshot to a late joiner. */
  private sendSimulationCatchUp(memberId: string): void {
    const latest = this.simulationEngine.getLatestSnapshot();
    if (latest === null) return;
    this.sendSimulationSnapshot(
      {
        tick: latest.tick,
        state: latest.state,
        stateHash: latest.stateHash,
        term: this.engine.getTerm(),
        authorityMemberId: this.selfPlayer.id,
      },
      memberId,
    );
  }

  /** The transport-facing half the state engine uses to send and emit. */
  private get engineHost(): StateEngineHost {
    return {
      players: () => this.players,
      isConnected: (memberId) => memberId === this.selfPlayer.id || this.playersMap.has(memberId),
      selfConnected: () => this.transport.connectionState === "connected",
      eligibleMemberIds: () =>
        [this.selfPlayer, ...this.playersMap.values()]
          .filter((record) => record.authorityEligible)
          .map((record) => record.id),
      sendAck: (targetMemberId, ack) => this.sendEngineAck(targetMemberId, ack),
      sendSnapshot: (snapshot, targetMemberId) => this.sendEngineSnapshot(snapshot, targetMemberId),
      sendView: (targetMemberId, view) => this.sendEngineView(targetMemberId, view),
      sendResync: (targetMemberId, request) => this.sendEngineResync(targetMemberId, request),
      sendAnnounce: (announcement) => this.sendEngineAnnounce(announcement),
      sendHeartbeat: (heartbeat) => this.sendEngineHeartbeat(heartbeat),
      sendElection: (election) => this.sendEngineElection(election),
      emit: (event) => this.handleEngineEvent(event),
    };
  }

  /** Emit one action ack (targeted; local when the actor is this session). */
  private sendEngineAck(targetMemberId: string, ack: NovaActionAck): void {
    if (targetMemberId === this.selfPlayer.id) {
      this.noteActionAck(ack.actionId);
      this.emit({ type: "actionAck", ack });
      return;
    }
    const seq = this.takeSeq();
    void this.sendProtocol(
      (base) =>
        buildActionAckMessage(base, {
          seq,
          actionId: ack.actionId,
          status: ack.status,
          ...(ack.revision !== undefined ? { revision: ack.revision } : {}),
          ...(ack.errorCode !== undefined ? { errorCode: ack.errorCode } : {}),
          ...(ack.errorMessage !== undefined ? { errorMessage: ack.errorMessage } : {}),
        }),
      { seq, targetMemberId },
    ).catch((error: unknown) => this.emitError(error));
  }

  /** Send a state snapshot (broadcast, or targeted at one shell). */
  private sendEngineSnapshot(snapshot: StateSnapshotEnvelope, targetMemberId?: string): void {
    const seq = this.takeSeq();
    const options: { targetMemberId?: string } = {};
    if (targetMemberId !== undefined) {
      options.targetMemberId = targetMemberId;
    }
    void this.sendProtocol(
      (base) =>
        buildStateSnapshotMessage(base, {
          seq,
          revision: snapshot.revision,
          ...(snapshot.stateHash !== null ? { stateHash: snapshot.stateHash } : {}),
          term: snapshot.term,
          authorityMemberId: snapshot.authorityMemberId,
          historyMode: snapshot.historyMode,
          ...(snapshot.baseStateHash !== null ? { baseStateHash: snapshot.baseStateHash } : {}),
          historyComplete: snapshot.historyComplete,
          stateMode: snapshot.stateMode,
          ...(snapshot.ops !== null ? { ops: snapshot.ops } : {}),
          processedActionIds: snapshot.processedActionIds,
          state: snapshot.state,
        }),
      options,
    ).catch((error: unknown) => this.emitError(error));
  }

  /** Ask the current authority for a full snapshot (state.resync, targeted). */
  private sendEngineResync(targetMemberId: string, request: StateResyncEnvelope): void {
    const seq = this.takeSeq();
    void this.sendProtocol(
      (base) => buildStateResyncMessage(base, { seq, knownRevision: request.knownRevision }),
      { seq, targetMemberId },
    ).catch((error: unknown) => this.emitError(error));
  }

  /** Send one player's selected view (targeted). */
  private sendEngineView(targetMemberId: string, view: StateViewEnvelope): void {
    if (targetMemberId === this.selfPlayer.id) {
      // The transport cannot target this session itself (the self player is
      // not a peer); deliver the view locally instead.
      this.emit({ type: "state", state: view.view });
      return;
    }
    const seq = this.takeSeq();
    void this.sendProtocol(
      (base) =>
        buildStateViewMessage(base, {
          seq,
          revision: view.revision,
          ...(view.stateHash !== null ? { stateHash: view.stateHash } : {}),
          forMemberId: view.forMemberId,
          view: view.view,
        }),
      { seq, targetMemberId },
    ).catch((error: unknown) => this.emitError(error));
  }

  private sendEngineAnnounce(announcement: AuthorityAnnounceEnvelope): void {
    const seq = this.takeSeq();
    void this.sendProtocol(
      (base) =>
        buildAuthorityAnnounceMessage(base, {
          seq,
          term: announcement.term,
          authorityMemberId: announcement.authorityMemberId,
          stateRevision: announcement.stateRevision,
          ...(announcement.stateHash !== null ? { stateHash: announcement.stateHash } : {}),
          eligibleMemberIds: announcement.eligibleMemberIds,
        }),
      { seq },
    ).catch((error: unknown) => this.emitError(error));
  }

  /** Broadcast an authority heartbeat (live-only, never queued). */
  private sendEngineHeartbeat(heartbeat: AuthorityHeartbeatEnvelope): void {
    if (this.transport.connectionState !== "connected") return; // soft state
    const seq = this.takeSeq();
    void this.deliverProtocol(
      buildAuthorityHeartbeatMessage(this.base(), {
        seq,
        term: heartbeat.term,
        authorityMemberId: heartbeat.authorityMemberId,
        stateRevision: heartbeat.stateRevision,
        heartbeatSeq: heartbeat.heartbeatSeq,
      }),
      { seq },
    ).catch((error: unknown) => this.emitError(error));
  }

  /** Broadcast an authority election campaign (live-only, never queued). */
  private sendEngineElection(election: AuthorityElectionEnvelope): void {
    if (this.transport.connectionState !== "connected") return; // soft state
    const seq = this.takeSeq();
    void this.deliverProtocol(
      buildAuthorityElectionMessage(this.base(), {
        seq,
        term: election.term,
        candidateMemberId: election.candidateMemberId,
        observed: election.observed.map((observation) => ({
          memberId: observation.memberId,
          revision: observation.revision,
          ...(observation.stateHash !== null ? { stateHash: observation.stateHash } : {}),
        })),
      }),
      { seq },
    ).catch((error: unknown) => this.emitError(error));
  }

  private handleEngineEvent(event: StateEngineEvent): void {
    switch (event.type) {
      case "stateCommitted":
        this.emit({
          type: "stateCommitted",
          revision: event.revision,
          stateHash: event.stateHash,
          stateSizeBytes: event.stateSizeBytes,
          appliedCount: event.appliedCount,
          rejectedCount: event.rejectedCount,
          actionRatePerSecond: event.actionRatePerSecond,
        });
        break;
      case "actionRejected":
        this.emit({
          type: "actionRejected",
          actionId: event.actionId,
          code: event.code,
          message: event.message,
        });
        break;
      case "stateError":
        this.emit({ type: "error", error: new NovaError(toErrorCode(event.code), event.message) });
        break;
      case "authorityChanged":
        // Flush buffered dispatches toward the new authority and re-send
        // in-flight ones (deduplication makes the re-sends exactly-once).
        this.flushDispatchBuffer();
        if (this.game.mode === "simulation") {
          // Authority changes notify the simulation loop (restore after
          // migration / follower snapshot pushes).
          this.simulationEngine.onAuthorityChanged(event.authorityMemberId, event.term);
        }
        // Host-side only: the arena displays authority migration, but the
        // game-facing client ignores this event.
        this.emit({
          type: "authorityChanged",
          authorityMemberId: event.authorityMemberId,
          term: event.term,
        });
        break;
      case "electionStarted":
        // Host/arena diagnostics only (visible through getStateModeDiagnostics).
        break;
      case "deltaSettled":
        // Replay held traffic first, so waiting dispatches see the new revision.
        this.drainDeferredProtocolMessages();
        for (const resolve of this.deltaWaiters.splice(0)) resolve();
        break;
      case "historyIncomplete":
        // Host-side diagnostic: a gapped window does not affect the game.
        this.emit({
          type: "historyIncomplete",
          authorityMemberId: event.authorityMemberId,
          term: event.term,
        });
        break;
      case "snapshotFallback":
        // Host-side diagnostic: a delta fell back to the full state; the game is unaffected.
        this.emit({ type: "snapshotFallback", reason: event.reason });
        break;
    }
  }

  /** Next monotonic per-sender sequence for ordered message families. */
  private takeSeq(): number {
    this.nextSeq += 1;
    return this.nextSeq;
  }

  private recordRawSend(): void {
    this.pruneRawRateWindow();
    this.rawRate.timestamps.push(Date.now());
  }

  /** Raw sends per second over the current window. */
  private rawRatePerSecond(): number {
    return this.rawRate.timestamps.length / (RAW_RATE_WINDOW_MS / 1000);
  }

  private pruneRawRateWindow(): void {
    const cutoff = Date.now() - RAW_RATE_WINDOW_MS;
    while (this.rawRate.timestamps.length > 0 && (this.rawRate.timestamps[0] ?? 0) < cutoff) {
      this.rawRate.timestamps.shift();
    }
  }

  /** Channels declared by this session, excluding peer declarations. */
  private selfDeclaredChannelCount(): number {
    let count = 0;
    for (const state of this.channels.values()) {
      if (state.declaredBySelf) {
        count += 1;
      }
    }
    return count;
  }

  private base(): PeerMessageBase {
    return {
      sessionId: this.sessionId,
      senderMemberId: this.transport.selfMemberId,
      senderConnectionId: this.transport.selfConnectionId,
    };
  }

  /** Send a protocol message, or queue it until the transport connects. */
  private sendProtocol(
    build: (base: PeerMessageBase) => PeerMessage,
    options: { targetMemberId?: string; seq?: number } = {},
  ): Promise<void> {
    if (this.transport.connectionState === "connected") {
      return this.deliverProtocol(build(this.base()), options);
    }
    this.outbox.push({ build, ...options });
    return Promise.resolve();
  }

  private async deliverProtocol(
    message: PeerMessage,
    options: { targetMemberId?: string; seq?: number },
  ): Promise<void> {
    const targetConnectionId =
      options.targetMemberId === undefined
        ? undefined
        : this.connectionIdOf(options.targetMemberId);
    if (options.targetMemberId !== undefined && targetConnectionId === undefined) {
      return; // the target left before this message flushed
    }
    await this.transport.send({
      channel: NOVA_PROTOCOL_CHANNEL,
      payload: message,
      version: PROTOCOL_VERSION,
      ...(options.seq !== undefined ? { seq: options.seq } : {}),
      reliability: "reliable",
      ordering: "ordered",
      ...(targetConnectionId !== undefined ? { targetConnectionId } : {}),
    });
  }

  private flushOutbox(): void {
    const pending = this.outbox.splice(0);
    for (const entry of pending) {
      void this.deliverProtocol(entry.build(this.base()), entry).catch((error: unknown) =>
        this.emitError(error),
      );
    }
  }

  private connectionIdOf(memberId: string): string | undefined {
    return this.playersMap.get(memberId)?.connectionId;
  }

  private playerOf(memberId: string): NovaPlayer {
    const player = this.playersMap.get(memberId);
    return player === undefined ? { id: memberId, name: memberId } : toNovaPlayer(player);
  }

  private emit(event: NovaSessionEvent): void {
    for (const handler of this.listeners) {
      handler(event);
    }
  }

  private emitError(error: unknown): void {
    this.emit({
      type: "error",
      error: error instanceof NovaError ? error : new NovaError("invalid_options", String(error)),
    });
  }

  private consumeGameBytes(bytes: number): void {
    const now = performance.now();
    const elapsed = Math.max(0, now - this.gameByteUpdatedAt);
    this.gameByteTokens = Math.min(
      gameBytesBurst,
      this.gameByteTokens + (elapsed * gameBytesPerSecond) / 1000,
    );
    this.gameByteUpdatedAt = now;
    if (this.gameByteTokens < bytes) {
      throw new NovaError(
        "rate_limited",
        "Game bandwidth budget exceeded (256 KiB/s, 1 MiB burst); the send was dropped.",
      );
    }
    this.gameByteTokens -= bytes;
    if (gameBytesBurst - this.gameByteTokens >= gameBytesWarn && !this.gameByteWarned) {
      this.gameByteWarned = true;
      this.emit({
        type: "bandwidthWarning",
        message: "Game bandwidth budget is 80% exhausted (256 KiB/s, 1 MiB burst).",
      });
    } else if (gameBytesBurst - this.gameByteTokens < gameBytesWarn) {
      this.gameByteWarned = false;
    }
  }

  private assertAlive(): void {
    if (this.disposed) {
      throw new NovaError("ended", "NovaSession: session was disposed.");
    }
  }
}

function toNovaPlayer(player: PlayerRecord): NovaPlayer {
  return { id: player.id, name: player.name };
}

/** Map a retained engine snapshot onto the game-facing snapshot shape. */
function toNovaSimulationSnapshot(snapshot: RetainedSimulationSnapshot): NovaSimulationSnapshot {
  return {
    tick: snapshot.tick,
    state: snapshot.state,
    ...(snapshot.stateHash !== null ? { stateHash: snapshot.stateHash } : {}),
  };
}

/**
 * Size of one raw payload in bytes: byte length for binary
 * payloads, UTF-8 serialized size for structured data (the same measurement
 * the transports use for chunking and progress).
 */
function rawPayloadBytes(payload: unknown): number {
  if (payload instanceof Uint8Array) {
    return payload.byteLength;
  }
  if (payload instanceof ArrayBuffer) {
    return payload.byteLength;
  }
  const json = JSON.stringify(payload);
  return new TextEncoder().encode(json ?? "").length;
}

function assertValidSchema(result: { success: boolean }, message: string): void {
  if (!result.success) {
    throw new NovaError("invalid_options", message);
  }
}
