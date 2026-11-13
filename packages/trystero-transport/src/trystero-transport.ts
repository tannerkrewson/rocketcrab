import { getRelaySockets, joinRoom } from "@trystero-p2p/ws-relay";
import { signalUrl } from "./signal-url";
import type {
  DataPayload,
  JoinRoomConfig,
  JsonValue,
  MessageAction,
  RequestAction,
  MessageContext,
  ActionProgressContext,
  Room,
  TurnServerConfig,
} from "@trystero-p2p/ws-relay";
import type { ConnectionId, MemberId, MessageId, SessionId, Timestamp } from "@rocketcrab/protocol";
import { LIMITS } from "@rocketcrab/protocol";
import type {
  NovaTransport,
  TransportConnectionState,
  TransportEventMap,
  TransportJoinRequest,
  TransportMessage,
  TransportPeerInfo,
  TransportSendOptions,
  TransportRequestOptions,
  TransportRequestHandler,
} from "@rocketcrab/core";
import { currentAppIdEnvironment, resolveAppId, type AppIdEnvironment } from "./app-id";
import { TrysteroJoinError, fromRoomError } from "./errors";
import {
  buildWireEnvelope,
  isBinaryPayload,
  normalizePayload,
  parseIdentityPayload,
  parseWireEnvelope,
  payloadSize,
  TRANSPORT_VERSION,
} from "./wire";

/**
 * Trystero transport (P1): the real-party implementation of the
 * transport-neutral {@link NovaTransport} interface (ADR-0003), built on
 * Trystero 0.27.0's self-hosted WebSocket relay strategy.
 *
 * Game-facing code never sees this class (engineering rule 1): it is the
 * production twin of `InMemoryTransport` (U5, @rocketcrab/testing) and must
 * pass the same contract suite, so the Nova API behaves identically in the
 * local test arena and over real parties.
 *
 * Design decisions (see the F5 findings and ADR-0003):
 * - **Room-scoped signaling** through the configured edge Worker.
 * - **Environment-specific appId** (`rocketcrab-nova-dev` / `-prod`,
 *   `app-id.ts`) so dev and prod rooms never collide.
 * - **Identity admission**: per-room ephemeral Trystero identities carry Nova
 *   member and connection IDs in validated user state. A bilateral ack gates
 *   peer publication and early traffic is bounded until admission completes.
 * - **Join errors** are categorized (`errors.ts`). Trystero only reports
 *   handshake-stage failures (F5 finding F5); the adapter detects relay
 *   failure itself (relay socket readyState + join/relay timeouts) and
 *   rejects `join()` with `relay_unreachable` / `join_timeout`. Errors that
 *   arrive after `join()` resolved (e.g. password mismatch during the slow
 *   discovery phase) are delivered to the `onJoinError` observer and kept in
 *   `getDiagnostics()`.
 * - **Relay-state diagnostics** come from polling `getRelaySockets()`
 *   (the only relay observables Trystero exposes); the same monitor drives
 *   the join-time relay-reachability check.
 * - **TURN configuration stays a hook** (`turnConfig` option, never
 *   hardcoded credentials; owned with M3 / Blocker B2).
 * - **Every long-running listener has explicit cleanup** (engineering rule
 *   22): `leave()`/`suspend()`/failed joins detach room + action handlers,
 *   stop the relay monitor, and call `room.leave()`.
 *
 * Differences from InMemoryTransport (documented, not silent):
 * - Trystero's action channel is always reliable+ordered; `unreliable` /
 *   `unordered` send options are accepted and degrade to reliable/ordered.
 * - There is no simulated message loss, so `message:lost` never fires; the
 *   optional `validate` hook (when configured) emits `message:invalid`.
 * - `connectionId` derives from `room.getSelf().peerId`, re-suffixed on
 *   reconnect/resume so every connection gets a fresh ID.
 */
export class TrysteroTransport implements NovaTransport {
  readonly kind = "trystero";
  readonly selfMemberId: MemberId;
  readonly displayName?: string;
  readonly appId: string;

  /** Current connection identity; Trystero peer ID, fresh suffix per reconnect. */
  selfConnectionId: ConnectionId;
  connectionState: TransportConnectionState = "idle";

  /** Session this transport is joined to; null until join completes. */
  sessionId: SessionId | null = null;
  /** Room name this transport joined (or is suspended from). */
  roomName = "";

  private readonly options: InternalOptions;
  // Keep this array stable: Trystero 0.25.3's offer pool closes over the
  // initial room config, including when allocating peers for later rooms.
  private readonly now: () => number;
  private readonly scheduleFn: (callback: () => void, delayMs: number) => () => void;
  /** Trystero peer ID once initialized; provisional until room.getSelf(). */
  private selfIdBase: string;
  private roomUnsubscribers: Array<() => void> = [];

  private readonly listeners = new Map<keyof TransportEventMap, Set<unknown>>();
  private readonly relayStateHandlers = new Set<(connected: boolean) => void>();
  private peersList: TransportPeerInfo[] = [];
  /** trystero peerId → identity announced during the peer handshake. */
  private readonly identityByPeerId = new Map<string, PeerIdentity>();
  private readonly acknowledgedPeers = new Set<string>();
  private readonly sentAcknowledgements = new Set<string>();
  private readonly readyPeers = new Set<string>();
  private readonly pendingMessages = new Map<
    string,
    { items: Array<{ data: unknown; context: MessageContext }>; bytes: number }
  >();
  private readonly rejectedPeers = new Set<string>();
  private readonly readyWaiters = new Map<string, Set<(ready: boolean) => void>>();
  private readonly admissionTimers = new Map<string, () => void>();
  /** announced connectionId → trystero peerId (targeting). */
  private readonly connectionToPeerId = new Map<ConnectionId, string>();
  private readonly peerJoinedAt = new Map<string, Timestamp>();
  private readonly deliverySeqCounters = new Map<string, number>();
  private readonly joinErrors: TrysteroJoinError[] = [];
  private qualitySamples: ConnectionQualitySample[] = [];

  private room: Room | null = null;
  private action: MessageAction | null = null;
  private signalRelayUrl = "";
  private readonly requestHandlers = new Map<string, TransportRequestHandler>();
  private readonly requestActions = new Map<string, RequestAction>();
  private readonly pendingRequests = new Map<string, TransportRequestOptions>();
  private connectionEpoch = 0;
  /** Invalidates asynchronous lifecycle continuations after leave or replacement. */
  private lifecycleGeneration = 0;
  private pendingTeardown: Promise<void> | null = null;
  private cancelPendingTeardownWait: (() => void) | null = null;
  private cancelSignalDerivation: (() => void) | null = null;
  private suspendPending = false;
  private joinWaiter: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private joinTimers: Array<() => void> = [];
  private relayMonitorTimer: (() => void) | null = null;
  private signalingConnected: boolean | null = null;

  constructor(options: TrysteroTransportOptions) {
    this.options = {
      ...options,
      relayConnectTimeoutMs: options.relayConnectTimeoutMs ?? 15_000,
      joinTimeoutMs: options.joinTimeoutMs ?? LIMITS.handshakeTimeoutMs,
      handshakeTimeoutMs: options.handshakeTimeoutMs ?? LIMITS.handshakeTimeoutMs,
      relayPollMs: options.relayPollMs ?? 1_000,
      historyLimit: options.historyLimit ?? 100,
    };
    // The relay-reachability timeout and the overall join timeout race; the
    // first to elapse wins with its own category (F5: distinguish "still
    // connecting" — join_timeout — from "relay unreachable"). Defaults are
    // 15 s vs 30 s so relay failures surface first on the default profile.
    this.selfMemberId = options.memberId;
    this.displayName = options.displayName;
    const env: AppIdEnvironment = options.env ?? currentAppIdEnvironment();
    this.appId = resolveAppId(options.appId, env);
    // A provisional ID is replaced by room.getSelf() before join resolves.
    this.selfIdBase = globalThis.crypto.randomUUID();
    this.selfConnectionId = this.selfIdBase;
    this.now = options.now ?? (() => Date.now());
    this.scheduleFn = options.schedule ?? defaultScheduler;
  }

  handleRequest(channel: string, handler: TransportRequestHandler): () => void {
    if (this.requestHandlers.has(channel)) throw new Error("Request handler already registered.");
    this.requestHandlers.set(channel, handler);
    if (this.room !== null) this.requestAction(channel);
    return () => {
      if (this.requestHandlers.get(channel) === handler) this.requestHandlers.delete(channel);
    };
  }

  async request(options: TransportRequestOptions): Promise<unknown> {
    const peerId = this.connectionToPeerId.get(options.targetConnectionId);
    if (
      !peerId ||
      !this.readyPeers.has(peerId) ||
      !this.room ||
      this.connectionState !== "connected"
    )
      throw new Error("Peer disconnected.");
    const key = options.channel + ":" + peerId;
    if (this.pendingRequests.has(key))
      throw new Error("A request to this peer/channel is already active.");
    if (this.pendingRequests.size >= 32) throw new Error("Too many requests.");
    this.pendingRequests.set(key, options);
    try {
      return await this.requestAction(options.channel).request(options.payload as DataPayload, {
        target: peerId,
        timeoutMs: options.timeoutMs ?? 120_000,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } finally {
      if (this.pendingRequests.get(key) === options) this.pendingRequests.delete(key);
    }
  }

  private requestAction(channel: string): RequestAction {
    const existing = this.requestActions.get(channel);
    if (existing) return existing;
    if (!this.room || !/^[a-zA-Z0-9._-]{1,23}$/.test(channel))
      throw new Error("Invalid request channel.");
    const action = this.room.makeAction("nova.rpc:" + channel, { kind: "request" });
    this.roomUnsubscribers.push(
      action.onReceive((context) => {
        if (!this.identityByPeerId.has(context.peerId) || this.rejectedPeers.has(context.peerId))
          return false;
        const limit =
          context.kind === "response"
            ? (this.pendingRequests.get(channel + ":" + context.peerId)?.maxResponseBytes ??
              2 * 1024 * 1024)
            : 16 * 1024;
        return context.byteLength <= limit;
      }),
      action.onReceiveProgress((fraction, context) => {
        this.pendingRequests.get(channel + ":" + context.peerId)?.onProgress?.(fraction);
      }),
      action.onRequest(async (data, context) => {
        if (!(await this.waitForPeerReady(context.peerId, context.signal)))
          throw new Error("Request rejected.");
        const identity = this.identityByPeerId.get(context.peerId);
        const handler = this.requestHandlers.get(channel);
        if (!identity || !this.readyPeers.has(context.peerId) || !handler)
          throw new Error("Request rejected.");
        return (await handler(data, {
          senderMemberId: identity.memberId,
          senderConnectionId: identity.connectionId,
          signal: context.signal,
        })) as DataPayload;
      }),
    );
    this.requestActions.set(channel, action);
    return action;
  }

  /** Peers currently connected, in join order. */
  get peers(): readonly TransportPeerInfo[] {
    return [...this.peersList];
  }

  on<K extends keyof TransportEventMap>(event: K, handler: TransportEventMap[K]): () => void {
    let set = this.listeners.get(event);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  /** Subscribe to relay-state diagnostics; immediately replayed when set. */
  onRelayStateChange(handler: (connected: boolean) => void): () => void {
    this.relayStateHandlers.add(handler);
    if (this.signalingConnected !== null) {
      handler(this.signalingConnected);
    }
    return () => {
      this.relayStateHandlers.delete(handler);
    };
  }

  async join(request: TransportJoinRequest): Promise<void> {
    if (this.connectionState !== "idle") {
      throw new TrysteroJoinError({
        category: "already_joined",
        message: `TrysteroTransport.join: already ${this.connectionState}; leave() first.`,
      });
    }
    const generation = ++this.lifecycleGeneration;
    const startedAt = this.now();
    this.connectionState = "joining";
    this.emit("connection:state", "joining");
    if (generation !== this.lifecycleGeneration) {
      throw new TrysteroJoinError({ category: "cancelled", message: "Join was cancelled." });
    }
    this.roomName = request.room;
    this.sessionId = request.sessionId;
    this.connectionEpoch = 0;
    this.selfConnectionId = this.selfIdBase;
    if (this.pendingTeardown) {
      const teardown = this.pendingTeardown;
      let cancelTimeout = () => {};
      const cancellation = new Promise<never>((_resolve, reject) => {
        this.cancelPendingTeardownWait = () =>
          reject(
            new TrysteroJoinError({
              category: "cancelled",
              message: "Join was cancelled while waiting for room teardown.",
            }),
          );
        cancelTimeout = this.scheduleFn(
          () =>
            reject(
              new TrysteroJoinError({
                category: "join_timeout",
                message: "Join timed out waiting for room teardown.",
              }),
            ),
          Math.max(0, this.options.joinTimeoutMs - (this.now() - startedAt)),
        );
      });
      try {
        await Promise.race([teardown, cancellation]);
      } catch (cause) {
        if (generation !== this.lifecycleGeneration) {
          throw new TrysteroJoinError({
            category: "cancelled",
            message: "Join was cancelled while waiting for room teardown.",
            cause,
          });
        }
        this.connectionState = "idle";
        this.roomName = "";
        this.sessionId = null;
        this.emit("connection:state", "idle");
        if (cause instanceof TrysteroJoinError) throw cause;
        throw new TrysteroJoinError({
          category: "invalid_state",
          message: "Previous room teardown failed.",
          cause,
        });
      } finally {
        cancelTimeout();
        if (generation === this.lifecycleGeneration) this.cancelPendingTeardownWait = null;
      }
      if (generation !== this.lifecycleGeneration) {
        throw new TrysteroJoinError({
          category: "cancelled",
          message: "Join was cancelled while waiting for room teardown.",
        });
      }
    }
    let room: Room;
    try {
      const url = await this.deriveSignalUrl(
        request.room,
        Math.max(0, this.options.joinTimeoutMs - (this.now() - startedAt)),
      );
      if (generation !== this.lifecycleGeneration)
        throw new TrysteroJoinError({ category: "cancelled", message: "Join was cancelled." });
      this.signalRelayUrl = url;
      room = joinRoom(this.buildConfig(url), request.room);
    } catch (cause) {
      if (generation !== this.lifecycleGeneration) throw cause;
      this.connectionState = "idle";
      this.roomName = "";
      this.sessionId = null;
      this.emit("connection:state", "idle");
      if (cause instanceof TrysteroJoinError) throw cause;
      throw new TrysteroJoinError({
        category: "invalid_state",
        message: "TrysteroTransport.join: joinRoom failed.",
        cause,
      });
    }
    await this.startRoom(room, Math.max(0, this.options.joinTimeoutMs - (this.now() - startedAt)));
  }

  async leave(): Promise<void> {
    this.lifecycleGeneration += 1;
    this.cancelSignalDerivation?.();
    const cancelPending = this.cancelPendingTeardownWait;
    this.cancelPendingTeardownWait = null;
    cancelPending?.();
    if (this.connectionState === "idle") {
      return;
    }
    const wasJoining = this.connectionState === "joining";
    const room = this.room;
    this.cancelJoinWaiter(
      new TrysteroJoinError({
        category: "cancelled",
        message: "TrysteroTransport.leave: leave() during join.",
      }),
    );
    this.teardownRoom(room);
    if (room !== null) {
      await room.leave();
    }
    this.sessionId = null;
    this.roomName = "";
    this.connectionState = wasJoining ? "idle" : "disconnected";
    this.emit("connection:state", this.connectionState);
  }

  /** Drop the current connection and re-join with a fresh connection ID. */
  async reconnect(): Promise<void> {
    if (this.connectionState !== "connected") {
      throw new TrysteroJoinError({
        category: "invalid_state",
        message: `TrysteroTransport.reconnect: not connected (state: ${this.connectionState}).`,
      });
    }
    const generation = ++this.lifecycleGeneration;
    const oldConnectionId = this.selfConnectionId;
    const roomName = this.roomName;
    const room = this.room;
    this.connectionState = "joining";
    this.emit("connection:state", "joining");
    this.teardownRoom(room);
    if (room !== null) {
      await room.leave(); // peers observe peer:left for the old connection
    }
    if (generation !== this.lifecycleGeneration) {
      throw new TrysteroJoinError({ category: "cancelled", message: "Reconnect was cancelled." });
    }
    this.connectionEpoch += 1;
    this.selfConnectionId = `${this.selfIdBase}#${this.connectionEpoch}`;
    let nextRoom: Room;
    const startedAt = this.now();
    try {
      const url = await this.deriveSignalUrl(roomName);
      if (generation !== this.lifecycleGeneration)
        throw new TrysteroJoinError({ category: "cancelled", message: "Reconnect was cancelled." });
      this.signalRelayUrl = url;
      nextRoom = joinRoom(this.buildConfig(url), roomName);
    } catch (cause) {
      if (generation !== this.lifecycleGeneration) throw cause;
      this.connectionState = "disconnected";
      this.emit("connection:state", "disconnected");
      if (cause instanceof TrysteroJoinError) throw cause;
      throw new TrysteroJoinError({
        category: "invalid_state",
        message: "Reconnect failed to create a room.",
        cause,
      });
    }
    await this.startRoom(
      nextRoom,
      Math.max(0, this.options.joinTimeoutMs - (this.now() - startedAt)),
    );
    this.emit("peer:reconnected", {
      memberId: this.selfMemberId,
      oldConnectionId,
      newConnectionId: this.selfConnectionId,
    });
  }

  /** Drop the connection (Mobile Safari backgrounding; threat T15). */
  async suspend(): Promise<void> {
    if (this.connectionState !== "connected") {
      throw new TrysteroJoinError({
        category: "invalid_state",
        message: `TrysteroTransport.suspend: not connected (state: ${this.connectionState}).`,
      });
    }
    const generation = ++this.lifecycleGeneration;
    const room = this.room;
    this.connectionState = "suspended";
    this.suspendPending = true;
    this.teardownRoom(room);
    try {
      if (room !== null) await room.leave();
    } finally {
      this.suspendPending = false;
    }
    if (generation !== this.lifecycleGeneration) {
      throw new TrysteroJoinError({ category: "cancelled", message: "Suspend was cancelled." });
    }
    this.emit("connection:state", "suspended");
  }

  /** Re-join after {@link TrysteroTransport.suspend} (fresh connection ID). */
  async resume(): Promise<void> {
    if (this.connectionState !== "suspended" || this.suspendPending) {
      throw new TrysteroJoinError({
        category: "invalid_state",
        message: `TrysteroTransport.resume: not suspended (state: ${this.connectionState}).`,
      });
    }
    const generation = ++this.lifecycleGeneration;
    const oldConnectionId = this.selfConnectionId;
    const roomName = this.roomName;
    this.connectionEpoch += 1;
    this.selfConnectionId = `${this.selfIdBase}#${this.connectionEpoch}`;
    this.connectionState = "joining";
    this.emit("connection:state", "joining");
    if (generation !== this.lifecycleGeneration) {
      throw new TrysteroJoinError({ category: "cancelled", message: "Resume was cancelled." });
    }
    let room: Room;
    const startedAt = this.now();
    try {
      const url = await this.deriveSignalUrl(roomName);
      if (generation !== this.lifecycleGeneration)
        throw new TrysteroJoinError({ category: "cancelled", message: "Resume was cancelled." });
      this.signalRelayUrl = url;
      room = joinRoom(this.buildConfig(url), roomName);
    } catch (cause) {
      if (generation !== this.lifecycleGeneration) throw cause;
      this.connectionState = "suspended";
      this.emit("connection:state", "suspended");
      if (cause instanceof TrysteroJoinError) throw cause;
      throw new TrysteroJoinError({
        category: "invalid_state",
        message: "Resume failed to create a room.",
        cause,
      });
    }
    await this.startRoom(room, Math.max(0, this.options.joinTimeoutMs - (this.now() - startedAt)));
    this.emit("peer:reconnected", {
      memberId: this.selfMemberId,
      oldConnectionId,
      newConnectionId: this.selfConnectionId,
    });
  }

  async send(options: TransportSendOptions): Promise<void> {
    this.assertConnected();
    const action = this.action;
    const sessionId = this.sessionId;
    if (action === null || sessionId === null) {
      throw new TrysteroJoinError({
        category: "not_connected",
        message: "TrysteroTransport.send: not connected (join() first).",
      });
    }
    const binary = options.binary === true || isBinaryPayload(options.payload);
    if (!binary && this.options.validate !== undefined) {
      const result = this.options.validate(options.payload);
      if (!result.ok) {
        const message = this.buildMessage(sessionId, options, binary);
        this.emit("message:invalid", message, result.error);
        throw new TrysteroJoinError({
          category: "invalid_state",
          message: `TrysteroTransport.send: payload failed validation: ${result.error}`,
        });
      }
    }
    const messageId = this.nextMessageId();
    const sentAt = this.now();
    const ordered = (options.ordering ?? "ordered") === "ordered";
    const deliverySeq = ordered ? this.nextDeliverySeq(options.channel) : undefined;
    const target = this.resolveTarget(options.targetConnectionId);
    const totalBytes = payloadSize(options.payload);
    const metadata = buildWireEnvelope({
      messageId,
      sentAt,
      channel: options.channel,
      sessionId,
      totalBytes,
      seq: options.seq,
      version: options.version,
      deliverySeq,
      binary: binary || undefined,
    });
    const sendTo = (peerId: string) =>
      action.send(options.payload as DataPayload, {
        target: peerId,
        metadata: metadata as unknown as JsonValue,
        onProgress:
          options.onProgress === undefined
            ? undefined
            : (fraction01: number) => {
                // Trystero reports progress as a fraction in [0, 1] (its docs
                // call it "a percentage value between 0 and 1").
                const fraction = Math.max(0, Math.min(1, fraction01));
                options.onProgress?.({
                  direction: "send",
                  messageId,
                  channel: options.channel,
                  bytesTransferred: Math.round(fraction * totalBytes),
                  totalBytes,
                  fraction,
                });
              },
      });
    if (target !== null) {
      await sendTo(target);
    } else {
      // Broadcast only to peers whose identities have been admitted. A peer
      // disappearing during a broadcast must not prevent delivery to others.
      await Promise.all(
        [...this.readyPeers].map(async (peerId) => {
          try {
            await sendTo(peerId);
          } catch (error) {
            if (
              !(
                typeof error === "object" &&
                error !== null &&
                "kind" in error &&
                error.kind === "disconnected"
              )
            )
              throw error;
          }
        }),
      );
    }
  }

  // ------------------------------------------------------------------
  // Diagnostics (adapter-specific; not part of the NovaTransport surface)
  // ------------------------------------------------------------------

  /** Signaling socket state, or null before the first poll. */
  getSignalingConnected(): boolean | null {
    return this.signalingConnected;
  }

  /** Aggregated adapter diagnostics (join errors, relays, quality). */
  getDiagnostics(): TrysteroTransportDiagnostics {
    return {
      kind: this.kind,
      connectionState: this.connectionState,
      selfMemberId: this.selfMemberId,
      selfConnectionId: this.selfConnectionId,
      room: this.roomName,
      sessionId: this.sessionId,
      appId: this.appId,
      signalingConnected: this.signalingConnected,
      peers: [...this.peersList],
      joinErrors: [...this.joinErrors],
      lastQuality: [...this.qualitySamples],
    };
  }

  /** Round-trip latency to one peer (ms), or null when unreachable. */
  async ping(connectionId: ConnectionId): Promise<number | null> {
    const room = this.room;
    if (room === null || this.connectionState !== "connected") {
      return null;
    }
    const peerId = this.connectionToPeerId.get(connectionId);
    if (peerId === undefined) {
      return null;
    }
    try {
      return await room.ping(peerId);
    } catch {
      return null;
    }
  }

  /** Ping every connected peer and record a quality sample. */
  async sampleQuality(): Promise<readonly ConnectionQualitySample[]> {
    const samples: ConnectionQualitySample[] = [];
    for (const peer of this.peersList) {
      const peerId = this.connectionToPeerId.get(peer.connectionId);
      const pingMs =
        peerId === undefined || this.room === null ? null : await this.ping(peer.connectionId);
      samples.push({
        connectionId: peer.connectionId,
        memberId: peer.memberId,
        pingMs,
        sampledAt: this.now(),
      });
    }
    this.qualitySamples = samples;
    return samples;
  }

  // ------------------------------------------------------------------
  // Trystero wiring
  // ------------------------------------------------------------------

  private buildConfig(url: string): JoinRoomConfig & { relayConfig: { urls: string[] } } {
    const config: JoinRoomConfig & { relayConfig: { urls: string[] } } = {
      appId: this.appId,
      identity: "none",
      maxReceiveBytes: 8 * 1024 * 1024,
      relayConfig: { urls: [url] },
    };
    if (this.options.password !== undefined) {
      config.password = this.options.password;
    }
    config.turnConfig = [...(this.options.turnConfig ?? [])];
    if (this.options.rtcConfig !== undefined) {
      config.rtcConfig = this.options.rtcConfig;
    }
    return config;
  }

  private async deriveSignalUrl(
    roomName: string,
    timeoutMs = this.options.joinTimeoutMs,
  ): Promise<string> {
    let cancelTimeout = () => {};
    let cancel = () => {};
    const interrupted = new Promise<never>((_resolve, reject) => {
      cancel = () =>
        reject(
          new TrysteroJoinError({
            category: "cancelled",
            message: "Signaling setup was cancelled.",
          }),
        );
      this.cancelSignalDerivation = cancel;
      cancelTimeout = this.scheduleFn(
        () =>
          reject(
            new TrysteroJoinError({
              category: "join_timeout",
              message: `Join did not complete within ${this.options.joinTimeoutMs}ms.`,
            }),
          ),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([
        signalUrl(this.options.edgeOrigin ?? "http://localhost:8787", this.appId, roomName),
        interrupted,
      ]);
    } finally {
      cancelTimeout();
      if (this.cancelSignalDerivation === cancel) this.cancelSignalDerivation = null;
    }
  }

  private async startRoom(room: Room, timeoutMs: number): Promise<void> {
    const joined = this.waitForJoin(timeoutMs);
    void this.wireRoom(room)
      .then(() => {
        if (this.room === room && this.connectionState === "joining") this.startRelayMonitor();
      })
      .catch((cause: unknown) => {
        if (this.room === room) {
          this.failJoin(
            new TrysteroJoinError({
              category: "invalid_state",
              message: "TrysteroTransport: room initialization failed.",
              cause,
            }),
          );
        }
      });
    await joined;
  }

  private async wireRoom(room: Room): Promise<void> {
    this.room = room;
    for (const channel of this.requestHandlers.keys()) this.requestAction(channel);
    const action = room.makeAction(ACTION_NAMESPACE);
    const acknowledgement = room.makeAction("nova.identity.ack");
    const state = room.makeUserState<JsonValue>("nova.identity", null, { maxBytes: 1024 });
    this.action = action;
    const maybeReady = (peerId: string): void => {
      if (
        this.room === room &&
        this.identityByPeerId.has(peerId) &&
        this.acknowledgedPeers.has(peerId) &&
        this.sentAcknowledgements.has(peerId) &&
        !this.readyPeers.has(peerId) &&
        !this.rejectedPeers.has(peerId)
      ) {
        this.readyPeers.add(peerId);
        this.admissionTimers.get(peerId)?.();
        this.admissionTimers.delete(peerId);
        this.handlePeerJoin(peerId);
        this.settlePeerWaiters(peerId, true);
        const pending = this.pendingMessages.get(peerId);
        this.pendingMessages.delete(peerId);
        for (const item of pending?.items ?? []) {
          if (this.room !== room || !this.readyPeers.has(peerId)) break;
          this.handleActionMessage(item.data, item.context);
        }
      }
    };
    const rejectIdentity = (peerId: string, incompatible: boolean): void => {
      this.handlePeerLeave(peerId);
      this.rejectedPeers.add(peerId);
      this.recordJoinError(
        new TrysteroJoinError({
          category: incompatible ? "incompatible_version" : "rejected",
          appId: this.appId,
          roomId: this.roomName,
          peerId,
          message: incompatible
            ? "Incompatible Nova version. Everyone should update/reload Nova and rejoin the party."
            : "Identity handshake failed: peer sent an invalid identity.",
        }),
      );
    };
    const accept = (peerId: string, userId: string): void => {
      if (
        this.room !== room ||
        this.rejectedPeers.has(peerId) ||
        room.getPeers()[peerId]?.userId !== userId
      )
        return;
      const meta = state.getMeta(userId);
      if (!meta || !meta.online || meta.peerId !== peerId || meta.userId !== userId) return;
      const identity = parseIdentityPayload(state.get(userId));
      const previous = this.identityByPeerId.get(peerId);
      if (previous) {
        if (
          !identity ||
          identity.transportVersion !== TRANSPORT_VERSION ||
          identity.memberId !== previous.memberId ||
          identity.connectionId !== previous.connectionId ||
          identity.displayName !== previous.displayName
        ) {
          rejectIdentity(
            peerId,
            identity !== null && identity.transportVersion !== TRANSPORT_VERSION,
          );
        }
        return;
      }
      if (!identity || identity.transportVersion !== TRANSPORT_VERSION) {
        rejectIdentity(
          peerId,
          identity !== null && identity.transportVersion !== TRANSPORT_VERSION,
        );
        return;
      }
      if (this.connectionToPeerId.has(identity.connectionId)) {
        rejectIdentity(peerId, false);
        return;
      }
      this.identityByPeerId.set(peerId, identity);
      this.connectionToPeerId.set(identity.connectionId, peerId);
      void acknowledgement
        .send(identity.connectionId, { target: peerId })
        .then(() => {
          if (this.room !== room || this.identityByPeerId.get(peerId) !== identity) return;
          this.sentAcknowledgements.add(peerId);
          maybeReady(peerId);
        })
        .catch(() => undefined);
    };
    this.roomUnsubscribers.push(
      acknowledgement.onMessage((data, context) => {
        if (
          this.room !== room ||
          data !== this.selfConnectionId ||
          !room.getPeers()[context.peerId]
        )
          return;
        this.acknowledgedPeers.add(context.peerId);
        maybeReady(context.peerId);
      }),
      action.onMessage((data, context) => this.handleActionMessage(data, context)),
      action.onReceiveProgress((percent, context) => this.handleReceiveProgress(percent, context)),
      room.onPeerJoin(({ peerId, userId }) => {
        if (!this.admissionTimers.has(peerId)) {
          this.admissionTimers.set(
            peerId,
            this.scheduleFn(() => {
              this.admissionTimers.delete(peerId);
              if (this.room !== room || this.readyPeers.has(peerId)) return;
              this.handlePeerLeave(peerId);
              this.rejectedPeers.add(peerId);
              this.recordJoinError(
                new TrysteroJoinError({
                  category: "handshake_timeout",
                  message: "Peer identity admission timed out.",
                  peerId,
                  appId: this.appId,
                  roomId: this.roomName,
                }),
              );
            }, this.options.handshakeTimeoutMs),
          );
        }
        accept(peerId, userId);
      }),
      room.onPeerLeave(({ peerId }) => this.handlePeerLeave(peerId)),
      room.onError((error) => this.recordJoinError(fromRoomError(error))),
      state.onChange((_value, context) => {
        if (context.self || this.room !== room) return;
        if (context.removed) {
          if (this.identityByPeerId.has(context.peerId)) {
            this.handlePeerLeave(context.peerId);
            this.rejectedPeers.add(context.peerId);
          }
          return;
        }
        accept(context.peerId, context.userId);
      }),
    );
    const self = await room.getSelf();
    if (this.room !== room) throw new Error("Room closed while joining.");
    this.selfIdBase = self.peerId;
    this.selfConnectionId =
      this.connectionEpoch === 0 ? self.peerId : `${self.peerId}#${this.connectionEpoch}`;
    await state.set({
      v: 1,
      transportVersion: TRANSPORT_VERSION,
      memberId: this.selfMemberId,
      connectionId: this.selfConnectionId,
      ...(this.displayName !== undefined ? { displayName: this.displayName } : {}),
    });
    if (this.room !== room) throw new Error("Room closed while joining.");
  }

  private handlePeerJoin(peerId: string): void {
    const identity = this.identityByPeerId.get(peerId);
    if (!identity) return;
    if (!this.peersList.some((peer) => peer.connectionId === identity.connectionId)) {
      const joinedAt = this.now();
      this.peerJoinedAt.set(identity.connectionId, joinedAt);
      this.peersList.push({
        memberId: identity.memberId,
        connectionId: identity.connectionId,
        displayName: identity.displayName,
        joinedAt,
      });
    }
    const peer = this.peersList.find((entry) => entry.connectionId === identity.connectionId);
    if (peer !== undefined) {
      this.emit("peer:joined", peer);
    }
  }

  private settlePeerWaiters(peerId: string, ready: boolean): void {
    const waiters = this.readyWaiters.get(peerId);
    this.readyWaiters.delete(peerId);
    for (const settle of waiters ?? []) settle(ready);
  }

  private waitForPeerReady(peerId: string, signal: AbortSignal): Promise<boolean> {
    if (this.readyPeers.has(peerId)) return Promise.resolve(true);
    if (!this.identityByPeerId.has(peerId) || this.rejectedPeers.has(peerId) || signal.aborted)
      return Promise.resolve(false);
    const waiters = this.readyWaiters.get(peerId) ?? new Set<(ready: boolean) => void>();
    if (waiters.size >= 32) return Promise.resolve(false);
    this.readyWaiters.set(peerId, waiters);
    return new Promise((resolve) => {
      const settle = (ready: boolean): void => {
        cancel();
        signal.removeEventListener("abort", abort);
        waiters.delete(settle);
        if (waiters.size === 0 && this.readyWaiters.get(peerId) === waiters)
          this.readyWaiters.delete(peerId);
        resolve(ready);
      };
      const abort = (): void => settle(false);
      const cancel = this.scheduleFn(() => settle(false), this.options.handshakeTimeoutMs);
      waiters.add(settle);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) settle(false);
    });
  }

  private handlePeerLeave(peerId: string): void {
    this.admissionTimers.get(peerId)?.();
    this.admissionTimers.delete(peerId);
    this.acknowledgedPeers.delete(peerId);
    this.sentAcknowledgements.delete(peerId);
    this.readyPeers.delete(peerId);
    this.pendingMessages.delete(peerId);
    this.rejectedPeers.delete(peerId);
    this.settlePeerWaiters(peerId, false);
    const identity = this.identityByPeerId.get(peerId);
    this.identityByPeerId.delete(peerId);
    this.peerJoinedAt.delete(identity?.connectionId ?? peerId);
    for (const [connectionId, mappedPeerId] of this.connectionToPeerId) {
      if (mappedPeerId === peerId) {
        this.connectionToPeerId.delete(connectionId);
      }
    }
    const connectionId = identity?.connectionId ?? peerId;
    const index = this.peersList.findIndex((peer) => peer.connectionId === connectionId);
    if (index >= 0) {
      const [peer] = this.peersList.splice(index, 1);
      if (peer !== undefined) {
        this.emit("peer:left", peer);
      }
    }
  }

  private handleActionMessage(data: unknown, context: MessageContext): void {
    const envelope = parseWireEnvelope(context.metadata);
    if (envelope === null) {
      return; // malformed metadata: drop (threat model T10)
    }
    const identity = this.identityByPeerId.get(context.peerId);
    if (!identity || this.rejectedPeers.has(context.peerId)) return;
    if (!this.readyPeers.has(context.peerId)) {
      let bytes: number;
      try {
        bytes = payloadSize(data) + payloadSize(context.metadata);
      } catch {
        return;
      }
      const pending = this.pendingMessages.get(context.peerId) ?? { items: [], bytes: 0 };
      if (pending.items.length >= 32 || bytes > 8 * 1024 * 1024 - pending.bytes) {
        this.pendingMessages.delete(context.peerId);
        this.rejectedPeers.add(context.peerId);
        this.settlePeerWaiters(context.peerId, false);
        return;
      }
      pending.items.push({ data, context });
      pending.bytes += bytes;
      this.pendingMessages.set(context.peerId, pending);
      return;
    }
    const message: TransportMessage = {
      version: envelope.version,
      sessionId: envelope.sessionId,
      channel: envelope.channel,
      senderMemberId: identity.memberId,
      senderConnectionId: identity.connectionId,
      messageId: envelope.messageId,
      sentAt: envelope.sentAt,
      seq: envelope.seq,
      deliverySeq: envelope.deliverySeq,
      reliability: "reliable",
      ordering: "ordered",
      binary: envelope.binary === true || isBinaryPayload(data),
      payload: normalizePayload(data),
    };
    this.emit("message:received", message);
  }

  private handleReceiveProgress(progress01: number, context: ActionProgressContext): void {
    if (!this.readyPeers.has(context.peerId)) return;
    const envelope = parseWireEnvelope(context.metadata);
    if (envelope === null) {
      return;
    }
    const totalBytes = envelope.totalBytes ?? 0;
    const fraction = Math.max(0, Math.min(1, progress01));
    this.emit("transfer:progress", {
      direction: "receive",
      messageId: envelope.messageId,
      channel: envelope.channel,
      bytesTransferred: Math.round(fraction * totalBytes),
      totalBytes,
      fraction,
    });
  }

  private recordJoinError(error: TrysteroJoinError): void {
    this.joinErrors.push(error);
    if (this.joinErrors.length > this.options.historyLimit) {
      this.joinErrors.shift();
    }
    this.options.onJoinError?.(error);
    if (this.joinWaiter !== null && this.connectionState === "joining" && error.isFatal) {
      this.failJoin(error);
    }
  }

  // ------------------------------------------------------------------
  // Relay monitor + join settlement
  // ------------------------------------------------------------------

  private startRelayMonitor(): void {
    this.pollRelays();
  }

  private pollRelays(): void {
    const socket = getRelaySockets()[this.signalRelayUrl];
    const connected = socket?.readyState === 1;
    if (this.signalingConnected !== connected) {
      this.signalingConnected = connected;
      for (const handler of this.relayStateHandlers) handler(connected);
      this.options.onRelayStateChange?.(connected);
    }
    if (this.joinWaiter !== null && connected) {
      this.settleJoin();
    }
    if (this.connectionState === "joining" || this.connectionState === "connected") {
      this.relayMonitorTimer = this.scheduleFn(() => this.pollRelays(), this.options.relayPollMs);
    }
  }

  private stopRelayMonitor(): void {
    if (this.relayMonitorTimer !== null) {
      this.relayMonitorTimer();
      this.relayMonitorTimer = null;
    }
  }

  private waitForJoin(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.joinWaiter = { resolve, reject };
      this.joinTimers = [
        this.scheduleFn(() => {
          this.failJoin(
            new TrysteroJoinError({
              category: "relay_unreachable",
              message: `Signaling did not connect within ${this.options.relayConnectTimeoutMs}ms. Check your network connection.`,
            }),
          );
        }, this.options.relayConnectTimeoutMs),
        this.scheduleFn(() => {
          this.failJoin(
            new TrysteroJoinError({
              category: "join_timeout",
              message: `Join did not complete within ${this.options.joinTimeoutMs}ms.`,
            }),
          );
        }, timeoutMs),
      ];
    });
  }

  private settleJoin(): void {
    const waiter = this.joinWaiter;
    if (waiter === null) {
      return;
    }
    this.joinWaiter = null;
    this.cancelJoinTimers();
    this.connectionState = "connected";
    this.emit("connection:state", "connected");
    waiter.resolve();
  }

  /** Fail the pending join, tear the room down, and return to idle. */
  private failJoin(error: TrysteroJoinError): void {
    const waiter = this.joinWaiter;
    if (waiter === null) {
      return;
    }
    this.joinWaiter = null;
    this.cancelJoinTimers();
    const room = this.room;
    this.teardownRoom(room);
    if (room !== null) {
      const teardown = room.leave();
      this.pendingTeardown = teardown;
      void teardown.then(
        () => {
          if (this.pendingTeardown === teardown) this.pendingTeardown = null;
        },
        () => undefined,
      );
    }
    this.sessionId = null;
    this.roomName = "";
    this.connectionState = "idle";
    this.emit("connection:state", "idle");
    waiter.reject(error);
  }

  private cancelJoinWaiter(error: TrysteroJoinError): void {
    this.cancelJoinTimers();
    const waiter = this.joinWaiter;
    this.joinWaiter = null;
    if (waiter !== null) {
      waiter.reject(error);
    }
  }

  private cancelJoinTimers(): void {
    const timers = this.joinTimers;
    this.joinTimers = [];
    for (const cancel of timers) {
      cancel();
    }
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private resolveTarget(targetConnectionId: ConnectionId | undefined): string | null {
    if (targetConnectionId === undefined) {
      return null; // broadcast to admitted peers only
    }
    const peerId = this.connectionToPeerId.get(targetConnectionId);
    if (peerId === undefined || !this.readyPeers.has(peerId)) {
      throw new TrysteroJoinError({
        category: "not_connected",
        message: `TrysteroTransport.send: no connected peer with connectionId "${targetConnectionId}".`,
      });
    }
    return peerId;
  }

  private buildMessage(
    sessionId: SessionId,
    options: TransportSendOptions,
    binary: boolean,
  ): TransportMessage {
    return {
      version: options.version,
      sessionId,
      channel: options.channel,
      senderMemberId: this.selfMemberId,
      senderConnectionId: this.selfConnectionId,
      messageId: this.nextMessageId(),
      sentAt: this.now(),
      seq: options.seq,
      reliability: options.reliability ?? "reliable",
      ordering: options.ordering ?? "ordered",
      binary,
      payload: options.payload,
    };
  }

  private nextDeliverySeq(channel: string): number {
    const key = `${this.selfConnectionId}:${channel}`;
    const next = (this.deliverySeqCounters.get(key) ?? 0) + 1;
    this.deliverySeqCounters.set(key, next);
    return next;
  }

  private nextMessageId(): MessageId {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === "function") {
      return cryptoApi.randomUUID();
    }
    return `msg-${this.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  private teardownRoom(_room: Room | null): void {
    for (const unsubscribe of this.roomUnsubscribers.splice(0)) unsubscribe();
    this.requestActions.clear();
    this.pendingRequests.clear();
    this.room = null;
    this.action = null;
    this.stopRelayMonitor();
    this.peersList = [];
    this.identityByPeerId.clear();
    this.acknowledgedPeers.clear();
    this.sentAcknowledgements.clear();
    this.readyPeers.clear();
    this.pendingMessages.clear();
    this.rejectedPeers.clear();
    for (const cancel of this.admissionTimers.values()) cancel();
    this.admissionTimers.clear();
    for (const peerId of this.readyWaiters.keys()) this.settlePeerWaiters(peerId, false);
    this.connectionToPeerId.clear();
    this.peerJoinedAt.clear();
    this.deliverySeqCounters.clear();
    this.signalingConnected = null;
  }

  private assertConnected(): void {
    if (this.connectionState !== "connected") {
      throw new TrysteroJoinError({
        category: "not_connected",
        message: `TrysteroTransport: not connected (state: ${this.connectionState}).`,
      });
    }
  }

  private emit<K extends keyof TransportEventMap>(
    event: K,
    ...args: Parameters<TransportEventMap[K]>
  ): void {
    const set = this.listeners.get(event);
    if (set === undefined) {
      return;
    }
    for (const handler of set) {
      (handler as (...a: unknown[]) => void)(...args);
    }
  }
}

/** Identity Trystero peers announce during the handshake. */
interface PeerIdentity {
  readonly v: 1;
  readonly memberId: MemberId;
  readonly connectionId: ConnectionId;
  readonly displayName?: string;
}

/**
 * Adapter options after defaulting. Defaulted fields are mutable so the
 * constructor can clamp `relayConnectTimeoutMs` to the join timeout.
 */
type InternalOptions = Omit<
  TrysteroTransportOptions,
  "relayConnectTimeoutMs" | "joinTimeoutMs" | "handshakeTimeoutMs" | "relayPollMs" | "historyLimit"
> & {
  relayConnectTimeoutMs: number;
  joinTimeoutMs: number;
  handshakeTimeoutMs: number;
  relayPollMs: number;
  historyLimit: number;
};

/** One ping sample for a peer (connection-quality sampling). */
export interface ConnectionQualitySample {
  readonly connectionId: ConnectionId;
  readonly memberId: MemberId;
  /** Round-trip ms, or null when the peer did not answer. */
  readonly pingMs: number | null;
  readonly sampledAt: Timestamp;
}

/** Aggregate adapter diagnostics (local telemetry; F5 recommendation). */
export interface TrysteroTransportDiagnostics {
  readonly kind: "trystero";
  readonly connectionState: TransportConnectionState;
  readonly selfMemberId: MemberId;
  readonly selfConnectionId: ConnectionId;
  readonly room: string;
  readonly sessionId: SessionId | null;
  readonly appId: string;
  readonly signalingConnected: boolean | null;
  readonly peers: readonly TransportPeerInfo[];
  readonly joinErrors: readonly TrysteroJoinError[];
  readonly lastQuality: readonly ConnectionQualitySample[];
}

/** Trystero action namespace (well under Trystero's 32-byte type limit). */
const ACTION_NAMESPACE = "nova";

/** Optional structured-payload validator (protocol boundary, threat T10). */
export type PayloadValidator = (payload: unknown) => { ok: true } | { ok: false; error: string };

/** Injectable scheduler: run `callback` after `delayMs`; return a cancel fn. */
export type Scheduler = (callback: () => void, delayMs: number) => () => void;

function defaultScheduler(callback: () => void, delayMs: number): () => void {
  const id = setTimeout(callback, delayMs);
  return () => {
    clearTimeout(id);
  };
}

/** Options for {@link TrysteroTransport}. */
export interface TrysteroTransportOptions {
  /** Stable per-player identity (ADR-0007); assigned by the layer above. */
  readonly memberId: MemberId;
  /** Optional player-facing name, announced to peers. */
  readonly displayName?: string;
  /**
   * Trystero appId override. Defaults to the environment-specific ID
   * (`rocketcrab-nova-v027-dev` / `-prod`); every peer in a party must use the
   * same appId.
   */
  readonly appId?: string;
  /** Environment flags used to derive the default appId (tests override). */
  readonly env?: AppIdEnvironment;
  /** Edge Worker origin used for room-scoped signaling. */
  readonly edgeOrigin?: string;
  /**
   * TURN configuration hook (F5 verdict / P0 rocketcrab-23s). Credentials
   * are owned by M3 and never hardcoded here.
   */
  readonly turnConfig?: readonly TurnServerConfig[];
  /** Extra RTC configuration (e.g. STUN servers). */
  readonly rtcConfig?: RTCConfiguration;
  /** Room password (optional in P1; P2 owns admission on top of it). */
  readonly password?: string;
  /** Timeout before join fails with `relay_unreachable` (default 15 s). */
  readonly relayConnectTimeoutMs?: number;
  /** Overall join timeout (default `LIMITS.handshakeTimeoutMs`, 30 s). */
  readonly joinTimeoutMs?: number;
  /** Trystero peer handshake timeout (default `LIMITS.handshakeTimeoutMs`). */
  readonly handshakeTimeoutMs?: number;
  /** Relay socket poll interval in ms (default 1000). */
  readonly relayPollMs?: number;
  /** Injectable clock (epoch ms). Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Injectable scheduler. Defaults to `setTimeout`. */
  readonly schedule?: Scheduler;
  /** Optional structured-payload validator (threat T10 parity with the hub). */
  readonly validate?: PayloadValidator;
  /** Join-error observer (post-resolve errors; diagnostics telemetry). */
  readonly onJoinError?: (error: TrysteroJoinError) => void;
  /** Relay-state change observer (signaling-up/down diagnostics). */
  readonly onRelayStateChange?: (connected: boolean) => void;
  /** Cap on retained join-error history (default 100). */
  readonly historyLimit?: number;
}

/** Re-export the category union for adapter consumers. */
export type { TrysteroJoinErrorCategory } from "./errors";
