/**
 * The Nova session (S1): the host-side engine that makes the game-facing
 * API function over the transport.
 *
 * A session owns one player's connection to the party: it joins the
 * transport, tracks players and connection status, exchanges validated
 * protocol messages (F6 schemas), and drives the client object games use.
 * Everything here is transport-neutral — it implements {@link NovaClientBackend}
 * against {@link NovaTransport}, so the same session (and therefore the same
 * game code) works over InMemoryTransport (the test arena, U5) and later
 * over TrysteroTransport (real parties, P1). No Trystero terminology, no
 * authority roles, no hosting concepts (engineering rules 1/7/15).
 *
 * S1 scope: the ready lifecycle, game start/end, player lists, connection
 * status, dispatch (send side), state subscription (receive side), raw
 * channels, simulation registration and inputs, and logging all function
 * over the transport. Deeper mode semantics (authority election, action
 * application, snapshots, the simulation clock) land with S2/S3/A1.
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
  parsePeerMessage,
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
import { NOVA_ERROR_CODES, NovaError, endedMessage, type NovaErrorCode } from "./errors";
import { NOVA_API_VERSION } from "./version";
import { newInputId } from "./ids";
import {
  buildActionAckMessage,
  buildActionDispatchMessage,
  buildAuthorityAnnounceMessage,
  buildGameEndMessage,
  buildGameReadyMessage,
  buildGameStartMessage,
  buildPlayerIdentityMessage,
  buildRawChannelMessage,
  buildSimulationInputMessage,
  buildStateSnapshotMessage,
  buildStateViewMessage,
  type PeerMessageBase,
} from "./messages";
import {
  NovaStateEngine,
  type AuthorityAnnounceEnvelope,
  type StateEngineEvent,
  type StateEngineHost,
  type StateSnapshotEnvelope,
  type StateViewEnvelope,
} from "./state-engine";
import { LocalGameExecutor, type NovaStateExecutor } from "./state-executor";
import type {
  NovaAction,
  NovaActionAck,
  NovaConnectionStatus,
  NovaGameDeclaration,
  NovaPlayer,
  NovaRawChannelSpec,
  NovaRawSendOptions,
  NovaSimulationInput,
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
  /** The transport-neutral connection this session drives (U5/P1). */
  readonly transport: NovaTransport;
  /** Simulated room / rendezvous room name to join. */
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
   * The state-mode executor (S2). The arena injects a frame executor that
   * runs the game's handlers inside the authority's runtime frame; when
   * omitted, handlers registered through `nova.defineGame` run in-process
   * (contract suite / tests) with the real immer package.
   */
  readonly stateExecutor?: NovaStateExecutor;
}

/** One connected player as tracked by the session (host-side view). */
export interface NovaSessionPlayer extends NovaPlayer {
  readonly connectionId: string;
  readonly ready: boolean;
  readonly joinedAt: number;
}

/** Internal mutable player record (the host-side view is a snapshot). */
interface PlayerRecord {
  id: string;
  name: string;
  connectionId: string;
  ready: boolean;
  joinedAt: number;
}
/** Delivery guarantees recorded for one raw channel (S1 raw mode). */
export interface NovaRawChannelState {
  readonly reliable: boolean;
  readonly ordered: boolean;
  readonly binary: boolean;
}

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

  private readonly selfPlayer: PlayerRecord;
  private readonly playersMap = new Map<string, PlayerRecord>();
  private readonly channels = new Map<string, NovaRawChannelState>();
  private readonly listeners = new Set<(event: NovaSessionEvent) => void>();
  private readonly transportUnsubscribers: Array<() => void> = [];
  private readonly outbox: OutboxEntry[] = [];
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
    const memberId = options.player.memberId;
    this.selfPlayer = {
      id: memberId,
      name: options.player.displayName ?? memberId,
      connectionId: this.transport.selfConnectionId,
      ready: false,
      joinedAt: Date.now(),
    };
    this.client = createNovaClient(this);
    this.engine = new NovaStateEngine({
      host: this.engineHost,
      executor: this.injectedExecutor ?? new LocalGameExecutor(null),
      selfMemberId: memberId,
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
    }));
  }

  /** This player's current connection status. */
  get connectionStatus(): NovaConnectionStatus {
    return this.status;
  }

  /** State-size and action-rate diagnostics (S2; host/arena visible). */
  getStateModeDiagnostics(): NovaStateDiagnostics {
    return this.engine.getDiagnostics();
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

  /** True once this session broadcast game start. */
  isStarted(): boolean {
    return this.started;
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
    this.transportUnsubscribers.push(
      this.transport.on("connection:state", (state) => this.handleConnectionState(state)),
      this.transport.on("peer:joined", (peer) => this.handlePeerJoined(peer)),
      this.transport.on("peer:left", (peer) => this.handlePeerLeft(peer)),
      this.transport.on("peer:reconnected", () => this.handleReconnected()),
      this.transport.on("message:received", (message) => this.handleMessage(message)),
    );
    await this.transport.join({ room: this.room, sessionId: this.sessionId });
  }

  /** Leave the party cleanly; pending outgoing messages are discarded. */
  async leave(): Promise<void> {
    this.assertAlive();
    this.outbox.length = 0;
    await this.transport.leave();
  }

  /**
   * Start the game (host/arena policy, never game code): broadcasts
   * `game.start`. The fixed initial authority (ADR-0007) first creates the
   * canonical state and publishes revision 1 + per-player views, then
   * announces, then broadcasts start — so every frame sees state and the
   * authority before `nova.onStart` fires. Followers broadcast start but
   * emit it locally only when the authority's `game.start` (or the catch-up
   * snapshot, for late joiners) arrives. Idempotent.
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
    this.engine.dispose();
    for (const unsubscribe of this.transportUnsubscribers) {
      unsubscribe();
    }
    this.transportUnsubscribers.length = 0;
    this.outbox.length = 0;
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
   * Dispatch one action (S2): validate, assign the base revision, and either
   * apply locally (this session is the fixed initial authority) or send the
   * action to the authority for sequential application. Resolves once the
   * action is accepted for delivery; the game-facing promise resolves on the
   * authority's ack (see the client).
   */
  dispatch(action: NovaAction, actionId: string): Promise<void> {
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
    const baseRevision = action.baseRevision ?? this.engine.getRevision();
    if (this.engine.isAuthorityElect()) {
      this.engine.handleLocalAction({
        actionId,
        type: action.type,
        payload: action.payload,
        baseRevision,
      });
      return Promise.resolve();
    }
    if (this.engine.getAuthorityMemberId() === null) {
      throw new NovaError(
        "no_authority",
        "No authority is currently active; the action was not sent (authority election lands with S3).",
      );
    }
    const seq = this.takeSeq();
    const now = Date.now();
    return this.sendProtocol(
      (base) =>
        buildActionDispatchMessage(base, {
          seq,
          actionId,
          baseRevision,
          actionType: action.type,
          payload: action.payload,
          expiresAtMs: now + actionTimeoutMs,
        }),
      { seq },
    );
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
    const state: NovaRawChannelState = {
      reliable: spec.reliable ?? true,
      ordered: spec.ordered ?? true,
      binary: spec.binary ?? false,
    };
    this.channels.set(spec.name, state);
    void this.sendProtocol((base) =>
      buildRawChannelMessage(base, {
        channelName: spec.name,
        reliability: state.reliable ? "reliable" : "unreliable",
        ordering: state.ordered ? "ordered" : "unordered",
        binaryPayloads: state.binary,
        broadcast: true,
      }),
    ).catch((error: unknown) => this.emitError(error));
  }

  async sendRaw(name: string, payload: unknown, options: NovaRawSendOptions): Promise<void> {
    this.assertAlive();
    const channel = this.channels.get(name);
    if (channel === undefined) {
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
    const targetConnectionId =
      options.to === undefined ? undefined : this.connectionIdOf(options.to);
    if (options.to !== undefined && targetConnectionId === undefined) {
      throw new NovaError("not_connected", `Player "${options.to}" is not connected.`);
    }
    await this.transport.send({
      channel: name,
      payload,
      binary: isBinaryPayload(payload),
      reliability: (options.reliable ?? channel.reliable) ? "reliable" : "unreliable",
      ordering: (options.ordered ?? channel.ordered) ? "ordered" : "unordered",
      ...(targetConnectionId !== undefined ? { targetConnectionId } : {}),
    });
  }

  registerSimulation(): void {
    this.assertAlive();
    // Registration is local for S1: the game's handlers stay in its context
    // and the session routes inbound simulation messages to them. The
    // simulation clock and snapshot protocol arrive with A1.
  }

  sendSimulationInput(input: NovaSimulationInput): void {
    this.assertAlive();
    assertValidSchema(
      novaSimulationInputSchema.safeParse(input),
      "nova.simulation.sendInput options failed validation.",
    );
    assertStructuredCloneSafe(input.payload, "nova.simulation.sendInput payload");
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
  }

  onEvent(handler: (event: NovaSessionEvent) => void): () => void {
    return this.onSessionEvent(handler);
  }

  // ------------------------------------------------------------------
  // Transport event handling
  // ------------------------------------------------------------------

  private handleConnectionState(state: TransportConnectionState): void {
    this.status = mapConnectionState(state);
    if (state === "connected") {
      this.flushOutbox();
      // A reconnected/left-then-rejoined authority re-announces so followers
      // restore the authority after a disconnect window (S2; S3 adds terms).
      if (
        this.started &&
        this.engine.isAuthorityElect() &&
        this.engine.getCanonicalState() !== null
      ) {
        this.engine.announce();
      }
    }
    this.emit({ type: "connection", status: this.status });
  }

  private handlePeerJoined(peer: TransportPeerInfo): void {
    const existing = this.playersMap.get(peer.memberId);
    if (existing !== undefined) {
      // A reconnect of a known member (peer:left then peer:joined): update
      // the connection id and treat it as a fresh join (documented S1 rule).
      existing.connectionId = peer.connectionId;
      existing.name = peer.displayName ?? existing.name;
    } else {
      this.playersMap.set(peer.memberId, {
        id: peer.memberId,
        name: peer.displayName ?? peer.memberId,
        connectionId: peer.connectionId,
        ready: false,
        joinedAt: peer.joinedAt,
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
    // S2 late join: the authority hands the new shell the current canonical
    // state (migration copy) and computes the new player's selected view.
    if (
      this.started &&
      this.engine.isAuthorityElect() &&
      this.engine.getCanonicalState() !== null
    ) {
      this.sendCatchUp(peer.memberId, joined.name);
    }
  }

  /** Send the current canonical state + the new player's view (S2). */
  private sendCatchUp(memberId: string, displayName: string): void {
    const snapshot = this.engine.getDiagnostics();
    if (snapshot.revision === 0 || this.engine.getCanonicalState() === null) return;
    this.sendEngineSnapshot(
      {
        revision: snapshot.revision,
        stateHash: snapshot.stateHash,
        term: 1,
        authorityMemberId: this.selfPlayer.id,
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
      // The fixed initial authority left: no authority until S3 election.
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
    if (
      this.started &&
      this.engine.isAuthorityElect() &&
      this.engine.getCanonicalState() !== null
    ) {
      this.engine.announce();
    }
  }

  private handleMessage(message: TransportMessage): void {
    if (message.channel !== NOVA_PROTOCOL_CHANNEL) {
      this.handleRawMessage(message);
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
        }
        break;
      }
      case "game.ready": {
        const player = this.playersMap.get(peerMessage.senderMemberId);
        if (player !== undefined) {
          player.ready = true;
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
        // Host-side observability; only the authority applies actions.
        this.emit({
          type: "actionReceived",
          action: {
            type: peerMessage.actionType,
            payload: peerMessage.payload,
            baseRevision: peerMessage.baseRevision,
          },
        });
        if (this.engine.isAuthorityElect()) {
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
        }
        break;
      case "action.ack":
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
          processedActionIds: peerMessage.processedActionIds,
          state: peerMessage.state,
        });
        if (!this.startEmitted) {
          // A late joiner starts from the catch-up snapshot.
          this.startEmitted = true;
          this.engine.beginGame();
          this.emit({ type: "start" });
        }
        break;
      case "state.view":
        if (peerMessage.forMemberId === this.selfPlayer.id) {
          this.emit({ type: "state", state: peerMessage.view });
        }
        break;
      case "authority.announce":
        this.engine.handleAnnounce({
          authorityMemberId: peerMessage.authorityMemberId,
          stateRevision: peerMessage.stateRevision,
        });
        break;
      case "simulation.input":
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
      case "simulation.snapshot":
        this.emit({ type: "simulationSnapshot", snapshot: peerMessage.state });
        break;
      case "raw.channel":
        // Peer channel declarations are recorded implicitly: raw payloads
        // are routed by channel name on arrival. Nothing further needed in
        // S1 (guarantees travel with each transport message).
        break;
      default:
        // peer.capabilities, join.*, party.*, game.source.* and
        // peer.connectionStatus are host/protocol-level traffic that the
        // game-facing API does not expose (P2/P3 own them); authority.* is
        // handled above (announce) or is S3 traffic (heartbeat/election).
        break;
    }
  }

  private handleRawMessage(message: TransportMessage): void {
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

  /** The transport-facing half the state engine uses to send and emit. */
  private get engineHost(): StateEngineHost {
    return {
      players: () => this.players,
      isConnected: (memberId) => memberId === this.selfPlayer.id || this.playersMap.has(memberId),
      sendAck: (targetMemberId, ack) => this.sendEngineAck(targetMemberId, ack),
      sendSnapshot: (snapshot, targetMemberId) => this.sendEngineSnapshot(snapshot, targetMemberId),
      sendView: (targetMemberId, view) => this.sendEngineView(targetMemberId, view),
      sendAnnounce: (announcement) => this.sendEngineAnnounce(announcement),
      emit: (event) => this.handleEngineEvent(event),
    };
  }

  /** Emit one action ack (targeted; local when the actor is this session). */
  private sendEngineAck(targetMemberId: string, ack: NovaActionAck): void {
    if (targetMemberId === this.selfPlayer.id) {
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
          processedActionIds: snapshot.processedActionIds,
          state: snapshot.state,
        }),
      options,
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

  /** Broadcast an authority announcement. */
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

  /** Map state-engine events onto session events (client + host). */
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
    }
  }

  /** Next monotonic per-sender sequence for ordered message families. */
  private takeSeq(): number {
    this.nextSeq += 1;
    return this.nextSeq;
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

  private assertAlive(): void {
    if (this.disposed) {
      throw new NovaError("ended", "NovaSession: session was disposed.");
    }
  }
}

function toNovaPlayer(player: PlayerRecord): NovaPlayer {
  return { id: player.id, name: player.name };
}

/** Map a state-engine error code onto the stable NovaError code set. */
function toErrorCode(code: string): NovaErrorCode {
  if (code in NOVA_ERROR_CODES) {
    return code as NovaErrorCode;
  }
  return "invalid_options";
}

function assertValidSchema(result: { success: boolean }, message: string): void {
  if (!result.success) {
    throw new NovaError("invalid_options", message);
  }
}
