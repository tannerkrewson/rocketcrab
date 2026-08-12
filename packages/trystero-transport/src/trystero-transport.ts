import { getRelaySockets, joinRoom, selfId } from "trystero";
import type {
  DataPayload,
  JoinRoomCallbacks,
  JoinRoomConfig,
  JsonValue,
  MessageAction,
  MessageContext,
  Room,
  TurnServerConfig,
} from "trystero";
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
} from "@rocketcrab/core";
import { currentAppIdEnvironment, resolveAppId, type AppIdEnvironment } from "./app-id";
import { TrysteroJoinError, toTrysteroJoinError, type TrysteroJoinErrorReport } from "./errors";
import {
  DEFAULT_RELAY_REDUNDANCY,
  GOOD_RELAYS,
  relayDiagnosticsEqual,
  snapshotRelays,
  type RelayDiagnostics,
} from "./relays";
import {
  buildWireEnvelope,
  isBinaryPayload,
  normalizePayload,
  parseIdentityPayload,
  parseWireEnvelope,
  payloadSize,
  type IdentityPayload,
} from "./wire";

/**
 * Trystero transport (P1): the real-party implementation of the
 * transport-neutral {@link NovaTransport} interface (ADR-0003), built on
 * Trystero 0.25.3's Nostr strategy.
 *
 * Game-facing code never sees this class (engineering rule 1): it is the
 * production twin of `InMemoryTransport` (U5, @rocketcrab/testing) and must
 * pass the same contract suite, so the Nova API behaves identically in the
 * local test arena and over real parties.
 *
 * Design decisions (see the F5 findings and ADR-0003):
 * - **Nostr strategy** for discovery, relays pinned to the verified
 *   `GOOD_RELAYS` set (F10) with redundancy 5.
 * - **Environment-specific appId** (`rocketcrab-nova-dev` / `-prod`,
 *   `app-id.ts`) so dev and prod rooms never collide.
 * - **Identity handshake**: peers exchange `{ memberId, connectionId,
 *   displayName }` inside Trystero's built-in `onPeerHandshake` (the same
 *   surface F5 used for admission policy). Peers are only activated after
 *   both handshakes complete, so `peer:joined` always carries real identity.
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
 * - `connectionId` is the page's Trystero peer ID (`selfId`), re-suffixed
 *   (`selfId#n`) on reconnect/resume so every connection gets a fresh ID.
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
  private readonly now: () => number;
  private readonly scheduleFn: (callback: () => void, delayMs: number) => () => void;
  /** Page-level Trystero peer ID, captured once (per-module constant). */
  private readonly selfIdBase: string;

  private readonly listeners = new Map<keyof TransportEventMap, Set<unknown>>();
  private readonly relayStateHandlers = new Set<(diagnostics: RelayDiagnostics) => void>();
  private peersList: TransportPeerInfo[] = [];
  /** trystero peerId → identity announced during the peer handshake. */
  private readonly identityByPeerId = new Map<string, PeerIdentity>();
  /** announced connectionId → trystero peerId (targeting). */
  private readonly connectionToPeerId = new Map<ConnectionId, string>();
  private readonly peerJoinedAt = new Map<string, Timestamp>();
  private readonly deliverySeqCounters = new Map<string, number>();
  private readonly joinErrors: TrysteroJoinError[] = [];
  private qualitySamples: ConnectionQualitySample[] = [];

  private room: Room | null = null;
  private action: MessageAction | null = null;
  private connectionEpoch = 0;
  private joinWaiter: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private joinTimers: Array<() => void> = [];
  private relayMonitorTimer: (() => void) | null = null;
  private lastRelayDiagnostics: RelayDiagnostics | null = null;

  constructor(options: TrysteroTransportOptions) {
    this.options = {
      ...options,
      relays: options.relays ?? GOOD_RELAYS,
      redundancy: options.redundancy ?? DEFAULT_RELAY_REDUNDANCY,
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
    if (this.options.redundancy < 1) {
      throw new TrysteroJoinError({
        category: "invalid_state",
        message: "TrysteroTransport: redundancy must be at least 1.",
      });
    }
    this.selfMemberId = options.memberId;
    this.displayName = options.displayName;
    const env: AppIdEnvironment = options.env ?? currentAppIdEnvironment();
    this.appId = resolveAppId(options.appId, env);
    // Trystero's selfId is a per-page constant; capture it once so every
    // connection of this transport shares the same base peer identity.
    this.selfIdBase = selfId;
    this.selfConnectionId = this.selfIdBase;
    this.now = options.now ?? (() => Date.now());
    this.scheduleFn = options.schedule ?? defaultScheduler;
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
  onRelayStateChange(handler: (diagnostics: RelayDiagnostics) => void): () => void {
    this.relayStateHandlers.add(handler);
    if (this.lastRelayDiagnostics !== null) {
      handler(this.lastRelayDiagnostics);
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
    this.connectionState = "joining";
    this.emit("connection:state", "joining");
    this.roomName = request.room;
    this.sessionId = request.sessionId;
    this.connectionEpoch = 0;
    this.selfConnectionId = this.selfIdBase;
    let room: Room;
    try {
      room = joinRoom(this.buildConfig(), request.room, this.buildCallbacks());
    } catch (cause) {
      this.connectionState = "idle";
      this.emit("connection:state", "idle");
      this.roomName = "";
      this.sessionId = null;
      throw new TrysteroJoinError({
        category: "invalid_state",
        message: "TrysteroTransport.join: joinRoom failed.",
        cause,
      });
    }
    this.wireRoom(room);
    this.startRelayMonitor();
    await this.waitForJoin();
  }

  async leave(): Promise<void> {
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
    const oldConnectionId = this.selfConnectionId;
    const roomName = this.roomName;
    const room = this.room;
    this.teardownRoom(room);
    if (room !== null) {
      await room.leave(); // peers observe peer:left for the old connection
    }
    this.connectionEpoch += 1;
    this.selfConnectionId = `${this.selfIdBase}#${this.connectionEpoch}`;
    this.connectionState = "joining";
    this.emit("connection:state", "joining");
    this.wireRoom(joinRoom(this.buildConfig(), roomName, this.buildCallbacks()));
    this.startRelayMonitor();
    await this.waitForJoin();
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
    const room = this.room;
    this.teardownRoom(room);
    if (room !== null) {
      await room.leave();
    }
    this.connectionState = "suspended";
    this.emit("connection:state", "suspended");
  }

  /** Re-join after {@link TrysteroTransport.suspend} (fresh connection ID). */
  async resume(): Promise<void> {
    if (this.connectionState !== "suspended") {
      throw new TrysteroJoinError({
        category: "invalid_state",
        message: `TrysteroTransport.resume: not suspended (state: ${this.connectionState}).`,
      });
    }
    const oldConnectionId = this.selfConnectionId;
    const roomName = this.roomName;
    this.connectionEpoch += 1;
    this.selfConnectionId = `${this.selfIdBase}#${this.connectionEpoch}`;
    this.connectionState = "joining";
    this.emit("connection:state", "joining");
    this.wireRoom(joinRoom(this.buildConfig(), roomName, this.buildCallbacks()));
    this.startRelayMonitor();
    await this.waitForJoin();
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
    await action.send(options.payload as DataPayload, {
      target,
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
  }

  // ------------------------------------------------------------------
  // Diagnostics (adapter-specific; not part of the NovaTransport surface)
  // ------------------------------------------------------------------

  /** Latest relay socket snapshot, or null before the first poll. */
  getRelayDiagnostics(): RelayDiagnostics | null {
    return this.lastRelayDiagnostics;
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
      relays: this.lastRelayDiagnostics,
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

  private buildConfig(): JoinRoomConfig {
    const config: JoinRoomConfig = {
      appId: this.appId,
      relayConfig: {
        urls: [...this.options.relays],
        redundancy: this.options.redundancy,
      },
    };
    if (this.options.password !== undefined) {
      config.password = this.options.password;
    }
    if (this.options.turnConfig !== undefined && this.options.turnConfig.length > 0) {
      config.turnConfig = [...this.options.turnConfig];
    }
    if (this.options.rtcConfig !== undefined) {
      config.rtcConfig = this.options.rtcConfig;
    }
    return config;
  }

  private buildCallbacks(): JoinRoomCallbacks {
    return {
      onJoinError: (report) => this.handleJoinError(report),
      onPeerHandshake: (peerId, send, receive) => this.handlePeerHandshake(peerId, send, receive),
      handshakeTimeoutMs: this.options.handshakeTimeoutMs,
    };
  }

  private wireRoom(room: Room): void {
    this.room = room;
    const action = room.makeAction(ACTION_NAMESPACE, {
      onMessage: (data, context) => this.handleActionMessage(data, context),
      onReceiveProgress: (percent, context) => this.handleReceiveProgress(percent, context),
    });
    this.action = action;
    room.onPeerJoin = (peerId) => this.handlePeerJoin(peerId);
    room.onPeerLeave = (peerId) => this.handlePeerLeave(peerId);
  }

  /**
   * Symmetric identity exchange (F5 handshake pattern). Throwing here fails
   * the peer with a structured join error; peers are only activated after
   * both sides complete the handshake.
   */
  private async handlePeerHandshake(
    peerId: string,
    send: (data: DataPayload) => Promise<void>,
    receive: () => Promise<{ data: DataPayload }>,
  ): Promise<void> {
    const identity: IdentityPayload = {
      v: 1,
      memberId: this.selfMemberId,
      connectionId: this.selfConnectionId,
      displayName: this.displayName,
    };
    await send({
      v: 1,
      memberId: identity.memberId,
      connectionId: identity.connectionId,
      ...(identity.displayName !== undefined ? { displayName: identity.displayName } : {}),
    });
    const { data } = await receive();
    const remote = parseIdentityPayload(data);
    if (remote === null) {
      throw new Error("peer sent an invalid identity handshake");
    }
    this.identityByPeerId.set(peerId, remote);
    this.connectionToPeerId.set(remote.connectionId, peerId);
  }

  private handlePeerJoin(peerId: string): void {
    const identity = this.identityForPeer(peerId);
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

  private handlePeerLeave(peerId: string): void {
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
    const identity = this.identityForPeer(context.peerId);
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

  private handleReceiveProgress(progress01: number, context: MessageContext): void {
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

  private handleJoinError(report: TrysteroJoinErrorReport): void {
    const error = toTrysteroJoinError(report);
    this.joinErrors.push(error);
    if (this.joinErrors.length > this.options.historyLimit) {
      this.joinErrors.shift();
    }
    this.options.onJoinError?.(error);
    // Fatal errors while the join is still pending fail it fast (F4: failed
    // joiners must leave the rendezvous immediately). Errors arriving after
    // join() resolved (the common case for password mismatch, which Trystero
    // reports during the slow discovery phase) are delivered to the observer.
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
    const sockets = getRelaySockets() as Record<string, { readonly readyState: number }>;
    const diagnostics = snapshotRelays(sockets, this.now());
    const changed =
      this.lastRelayDiagnostics === null ||
      !relayDiagnosticsEqual(this.lastRelayDiagnostics, diagnostics);
    if (changed) {
      this.lastRelayDiagnostics = diagnostics;
      for (const handler of this.relayStateHandlers) {
        handler(diagnostics);
      }
      this.options.onRelayStateChange?.(diagnostics);
    }
    if (this.joinWaiter !== null && diagnostics.connectedCount > 0) {
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

  private waitForJoin(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.joinWaiter = { resolve, reject };
      this.joinTimers = [
        this.scheduleFn(() => {
          this.failJoin(
            new TrysteroJoinError({
              category: "relay_unreachable",
              message:
                `No Nostr relay reached an open socket within ` +
                `${this.options.relayConnectTimeoutMs}ms. Check network connectivity to the ` +
                `pinned relays (${this.options.relays.join(", ")}).`,
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
        }, this.options.joinTimeoutMs),
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
      void room.leave().catch(() => undefined); // fail fast and leave (F4)
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

  private identityForPeer(peerId: string): PeerIdentity {
    return (
      this.identityByPeerId.get(peerId) ?? {
        v: 1,
        memberId: peerId,
        connectionId: peerId,
      }
    );
  }

  private resolveTarget(targetConnectionId: ConnectionId | undefined): string | string[] | null {
    if (targetConnectionId === undefined) {
      return null; // broadcast to every connected peer
    }
    const peerId = this.connectionToPeerId.get(targetConnectionId);
    if (peerId === undefined) {
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

  private teardownRoom(room: Room | null): void {
    if (room !== null) {
      room.onPeerJoin = null;
      room.onPeerLeave = null;
    }
    if (this.action !== null) {
      this.action.onMessage = null;
      this.action.onReceiveProgress = null;
    }
    this.room = null;
    this.action = null;
    this.stopRelayMonitor();
    this.peersList = [];
    this.identityByPeerId.clear();
    this.connectionToPeerId.clear();
    this.peerJoinedAt.clear();
    this.deliverySeqCounters.clear();
    this.lastRelayDiagnostics = null;
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
  | "relays"
  | "redundancy"
  | "relayConnectTimeoutMs"
  | "joinTimeoutMs"
  | "handshakeTimeoutMs"
  | "relayPollMs"
  | "historyLimit"
> & {
  relays: readonly string[];
  redundancy: number;
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
  readonly relays: RelayDiagnostics | null;
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
   * (`rocketcrab-nova-dev` / `-prod`); every peer in a party must use the
   * same appId.
   */
  readonly appId?: string;
  /** Environment flags used to derive the default appId (tests override). */
  readonly env?: AppIdEnvironment;
  /** Nostr relay URLs to pin (default: verified GOOD_RELAYS, F10). */
  readonly relays?: readonly string[];
  /** Relay redundancy (default 5, F5 recommendation). */
  readonly redundancy?: number;
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
  readonly onRelayStateChange?: (diagnostics: RelayDiagnostics) => void;
  /** Cap on retained join-error history (default 100). */
  readonly historyLimit?: number;
}

/** Re-export the category union for adapter consumers. */
export type { TrysteroJoinErrorCategory } from "./errors";
