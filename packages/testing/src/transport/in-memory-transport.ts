import type { ConnectionId, MemberId, SessionId, Timestamp } from "@rocketcrab/protocol";
import type {
  NovaTransport,
  TransportConnectionState,
  TransportEventMap,
  TransportJoinRequest,
  TransportMessage,
  TransportPeerInfo,
  TransportReconnectEvent,
  TransportSendOptions,
} from "@rocketcrab/core";
import type { ChunkRecord, InMemoryPeer, InMemoryTransportHub } from "./hub";
import type { RequiredFaultProfile } from "./faults";

/**
 * In-memory transport (U5): one simulated player connection driven by an
 * {@link InMemoryTransportHub}. Implements the transport-neutral
 * {@link NovaTransport} interface (ADR-0003) so the game-facing Nova API
 * behaves identically in the local test arena (U6) and over a real party
 * transport (P1). No WebRTC, no Trystero.
 *
 * Receiver-side rules implemented here:
 * - ordered channels buffer and reorder by monotonic `seq` (F6);
 * - duplicated messages (same seq) are dropped;
 * - chunked transfers are reassembled and reported with progress;
 * - messages arriving while suspended are buffered or dropped per profile.
 */
export class InMemoryTransport implements NovaTransport, InMemoryPeer {
  readonly kind = "in-memory";
  readonly hub: InMemoryTransportHub;
  readonly selfMemberId: MemberId;
  readonly displayName?: string;
  /** Link fault profile for this transport's outgoing messages. */
  readonly faultProfile: RequiredFaultProfile;

  selfConnectionId: ConnectionId;
  connectionState: TransportConnectionState = "idle";

  /** Session this transport is joined to; null until join completes. */
  sessionId: SessionId | null = null;
  /** Room name this transport joined (or is suspended from). */
  roomName = "";

  private readonly listeners = new Map<keyof TransportEventMap, Set<unknown>>();
  private peersList: TransportPeerInfo[] = [];
  private readonly ordered = new Map<string, OrderedState>();
  private readonly pendingTransfers = new Map<MessageIdKey, PendingTransfer>();
  private suspendedBuffer: Array<TransportMessage | ChunkRecord> = [];
  private lifecycle: { resolve: () => void; reject: (error: unknown) => void } | null = null;
  private disposed = false;

  constructor(
    hub: InMemoryTransportHub,
    identity: {
      memberId: MemberId;
      connectionId: ConnectionId;
      displayName?: string;
      profile: RequiredFaultProfile;
    },
  ) {
    this.hub = hub;
    this.selfMemberId = identity.memberId;
    this.selfConnectionId = identity.connectionId;
    this.displayName = identity.displayName;
    this.faultProfile = identity.profile;
  }

  /** True while the transport is in background-suspension simulation. */
  get suspended(): boolean {
    return this.connectionState === "suspended";
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

  async join(request: TransportJoinRequest): Promise<void> {
    this.assertAlive();
    await this.waitForLifecycle(this.hub.join(this, request.room, request.sessionId));
  }

  async leave(): Promise<void> {
    this.assertAlive();
    await this.hub.leave(this);
  }

  async reconnect(): Promise<void> {
    this.assertAlive();
    const promise = this.hub.reconnect(this);
    await this.waitForLifecycle(promise);
  }

  async suspend(): Promise<void> {
    this.assertAlive();
    await this.hub.suspend(this);
  }

  async resume(): Promise<void> {
    this.assertAlive();
    const promise = this.hub.resume(this);
    await this.waitForLifecycle(promise);
  }

  async send(options: TransportSendOptions): Promise<void> {
    this.assertAlive();
    await this.hub.send(this, options);
  }

  // ------------------------------------------------------------------
  // Hub-driven internals (the hub is the only caller)
  // ------------------------------------------------------------------

  /** Deliver one complete message; receiver-side delivery rules apply. */
  deliver(message: TransportMessage): void {
    if (this.connectionState === "suspended") {
      if (this.faultProfile.dropWhileSuspended) {
        return;
      }
      this.suspendedBuffer.push(message);
      return;
    }
    if (this.connectionState !== "connected") {
      return; // idle/disconnected: teardown discards in-flight messages
    }
    if (message.ordering === "ordered" && message.deliverySeq !== undefined) {
      this.deliverOrdered(message);
    } else {
      this.deliverNow(message);
    }
  }

  /** Deliver one chunk of a chunked transfer (reassembly + progress). */
  deliverChunk(chunk: ChunkRecord): void {
    if (this.connectionState === "suspended") {
      if (this.faultProfile.dropWhileSuspended) {
        return;
      }
      this.suspendedBuffer.push(chunk);
      return;
    }
    if (this.connectionState !== "connected") {
      return;
    }
    this.acceptChunk(chunk);
  }

  notifyPeerJoined(peer: TransportPeerInfo): void {
    if (!this.peersList.some((p) => p.connectionId === peer.connectionId)) {
      this.peersList.push(peer);
    }
    this.emit("peer:joined", peer);
  }

  notifyPeerLeft(peer: TransportPeerInfo): void {
    const index = this.peersList.findIndex((p) => p.connectionId === peer.connectionId);
    if (index >= 0) {
      this.peersList.splice(index, 1);
    }
    this.emit("peer:left", peer);
  }

  notifyReconnected(event: TransportReconnectEvent): void {
    // A fresh connection id means every per-(sender, channel) ordered stream
    // and every in-flight chunk transfer from the old connection is stale:
    // peers restart their delivery sequence for the new connection pairing
    // (the hub stamps per sender→receiver connection). Without this reset, a
    // receiver reconnect would drop the first post-reconnect messages as
    // "stale" because the sender restarted at deliverySeq 1 while this
    // transport still expected the old stream's next sequence.
    this.ordered.clear();
    this.pendingTransfers.clear();
    this.emit("peer:reconnected", event);
  }

  notifyConnectionState(state: TransportConnectionState): void {
    const previous = this.connectionState;
    this.connectionState = state;
    if (state === "connected" && previous === "suspended") {
      this.flushSuspendedBuffer();
    }
    this.emit("connection:state", state);
  }

  /** Emit a `message:lost` (sender-side loss observability). */
  emitLost(message: TransportMessage): void {
    this.emit("message:lost", message);
  }

  /** Emit a `message:invalid` (validation failure, threat T10). */
  emitInvalid(message: TransportMessage, reason: string): void {
    this.emit("message:invalid", message, reason);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.lifecycle?.reject(new Error("InMemoryTransport: disposed during a lifecycle operation."));
    this.lifecycle = null;
    this.listeners.clear();
    this.peersList = [];
    this.suspendedBuffer = [];
    this.pendingTransfers.clear();
    this.ordered.clear();
  }

  // ------------------------------------------------------------------
  // Receiver-side delivery rules
  // ------------------------------------------------------------------

  /**
   * Ordered delivery by the transport's per-(sender, channel) delivery stamp
   * (starts at 1 for every new connection, like SCTP sequence numbers). The
   * fixed base makes both reordering and duplication deterministic: out-of-
   * order messages buffer until the gap fills; anything below the expected
   * stamp was already delivered and is dropped as a duplicate.
   */
  private deliverOrdered(message: TransportMessage): void {
    const seq = message.deliverySeq as number;
    const key = `${message.senderConnectionId}:${message.channel}`;
    let state = this.ordered.get(key);
    if (state === undefined) {
      state = { expectedSeq: 1, buffered: new Map() };
      this.ordered.set(key, state);
    }
    if (seq < state.expectedSeq) {
      return; // duplicate or stale: drop
    }
    if (seq === state.expectedSeq) {
      state.expectedSeq += 1;
      this.deliverNow(message);
      this.flushBuffered(state);
      return;
    }
    if (!state.buffered.has(seq)) {
      state.buffered.set(seq, message);
    }
  }

  private flushBuffered(state: OrderedState): void {
    for (;;) {
      const next = state.buffered.get(state.expectedSeq);
      if (next === undefined) {
        break;
      }
      state.buffered.delete(state.expectedSeq);
      state.expectedSeq += 1;
      this.deliverNow(next);
    }
  }

  private deliverNow(message: TransportMessage): void {
    const payload =
      message.binary && message.payload instanceof Uint8Array
        ? message.payload.slice()
        : message.binary && message.payload instanceof ArrayBuffer
          ? message.payload.slice(0)
          : message.payload;
    this.emit("message:received", { ...message, payload });
  }

  private acceptChunk(chunk: ChunkRecord): void {
    let transfer = this.pendingTransfers.get(chunk.messageId);
    if (transfer === undefined) {
      transfer = {
        chunkCount: chunk.chunkCount,
        totalBytes: chunk.totalBytes,
        received: new Map(),
        receivedBytes: 0,
        meta: {
          version: chunk.version,
          sessionId: chunk.sessionId,
          channel: chunk.channel,
          senderMemberId: chunk.senderMemberId,
          senderConnectionId: chunk.senderConnectionId,
          sentAt: chunk.sentAt,
          seq: chunk.seq,
          deliverySeq: chunk.deliverySeq,
          reliability: chunk.reliability,
          ordering: chunk.ordering,
          kind: chunk.kind,
        },
      };
      this.pendingTransfers.set(chunk.messageId, transfer);
    }
    if (transfer.received.has(chunk.chunkIndex)) {
      return; // duplicate chunk
    }
    transfer.received.set(chunk.chunkIndex, chunk.bytes);
    transfer.receivedBytes += chunk.bytes.byteLength;
    this.emit("transfer:progress", {
      direction: "receive",
      messageId: chunk.messageId,
      channel: chunk.channel,
      bytesTransferred: transfer.receivedBytes,
      totalBytes: transfer.totalBytes,
      fraction: transfer.totalBytes === 0 ? 1 : transfer.receivedBytes / transfer.totalBytes,
    });
    if (transfer.received.size !== transfer.chunkCount) {
      return;
    }
    this.pendingTransfers.delete(chunk.messageId);
    const payload = reassemblePayload(transfer);
    this.deliver({
      version: transfer.meta.version,
      sessionId: transfer.meta.sessionId,
      channel: transfer.meta.channel,
      senderMemberId: transfer.meta.senderMemberId,
      senderConnectionId: transfer.meta.senderConnectionId,
      messageId: chunk.messageId,
      sentAt: transfer.meta.sentAt,
      seq: transfer.meta.seq,
      deliverySeq: transfer.meta.deliverySeq,
      reliability: transfer.meta.reliability,
      ordering: transfer.meta.ordering,
      binary: transfer.meta.kind === "binary",
      payload,
    });
  }

  private flushSuspendedBuffer(): void {
    const buffered = this.suspendedBuffer;
    this.suspendedBuffer = [];
    for (const item of buffered) {
      if ("bytes" in item) {
        this.acceptChunk(item);
      } else {
        this.deliver(item);
      }
    }
  }

  private waitForLifecycle(promise: Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.lifecycle = { resolve, reject };
      promise.then(
        () => {
          this.lifecycle = null;
          resolve();
        },
        (error: unknown) => {
          this.lifecycle = null;
          reject(error);
        },
      );
    });
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

  private assertAlive(): void {
    if (this.disposed) {
      throw new Error("InMemoryTransport: transport is disposed.");
    }
  }
}

interface OrderedState {
  expectedSeq: number;
  buffered: Map<number, TransportMessage>;
}

type MessageIdKey = string;

interface PendingTransfer {
  chunkCount: number;
  totalBytes: number;
  received: Map<number, Uint8Array>;
  receivedBytes: number;
  meta: {
    version?: number;
    sessionId: SessionId;
    channel: string;
    senderMemberId: MemberId;
    senderConnectionId: ConnectionId;
    sentAt: Timestamp;
    seq?: number;
    deliverySeq?: number;
    reliability: TransportMessage["reliability"];
    ordering: TransportMessage["ordering"];
    kind: "binary" | "string" | "json";
  };
}

function reassemblePayload(transfer: PendingTransfer): unknown {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < transfer.chunkCount; i += 1) {
    const bytes = transfer.received.get(i);
    if (bytes === undefined) {
      throw new Error("InMemoryTransport: reassembly with a missing chunk.");
    }
    parts.push(bytes);
  }
  const total = new Uint8Array(transfer.totalBytes);
  let offset = 0;
  for (const part of parts) {
    total.set(part, offset);
    offset += part.byteLength;
  }
  if (transfer.meta.kind === "binary") {
    return total;
  }
  const text = new TextDecoder().decode(total);
  if (transfer.meta.kind === "string") {
    return text;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
