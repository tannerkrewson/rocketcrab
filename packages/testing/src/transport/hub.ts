import type { ConnectionId, MemberId, MessageId, SessionId, Timestamp } from "@rocketcrab/protocol";
import type {
  TransportConnectionState,
  TransportMessage,
  TransportOrdering,
  TransportPeerInfo,
  TransportReconnectEvent,
  TransportReliability,
  TransportSendOptions,
} from "@rocketcrab/core";
import type { Rng } from "./prng";
import { mulberry32, normalizeSeed, rngHex } from "./prng";
import {
  normalizeProfile,
  rollFaults,
  type FaultProfile,
  type RequiredFaultProfile,
} from "./faults";
import { InMemoryTransport } from "./in-memory-transport";

/**
 * In-memory transport hub (U5): simulates rooms, peer identities, message
 * delivery, and link faults — latency, jitter, loss, duplication, reordering,
 * background suspension — without any WebRTC or Trystero code, so the local
 * test arena (U6) can run several players on one page through the same
 * transport-neutral Nova interface (ADR-0003) a real party uses.
 *
 * Determinism: the hub owns a single seeded PRNG (mulberry32) and every
 * random decision (IDs, jitter, loss, duplication, reordering) draws from it
 * in a fixed order, so a seeded run is fully reproducible. `drain()` delivers
 * every pending message synchronously in scheduled order, which makes tests
 * and fast-check property runs free of real timers.
 */

/** Result of the optional payload validator (protocol boundary, threat T10). */
export type PayloadValidatorResult = { ok: true } | { ok: false; error: string };

/** Validates structured payloads at send time when configured. */
export type PayloadValidator = (payload: unknown) => PayloadValidatorResult;

/** Injectable scheduler: run `callback` after `delayMs`; return a cancel fn. */
export type Scheduler = (callback: () => void, delayMs: number) => () => void;

/** Default scheduler backed by real timers (arena mode). */
function defaultScheduler(callback: () => void, delayMs: number): () => void {
  const id = setTimeout(callback, delayMs);
  return () => {
    clearTimeout(id);
  };
}

export interface InMemoryHubOptions {
  /** Seed for the deterministic PRNG; reproducible runs (fast-check friendly). */
  seed?: number | string;
  /** Injectable clock (epoch ms). Defaults to `Date.now`. */
  now?: () => number;
  /** Injectable scheduler. Defaults to `setTimeout`. */
  schedule?: Scheduler;
  /** Default fault profile for transports created without one. */
  defaultFaults?: FaultProfile;
  /**
   * Optional validator for structured payloads. When set, every non-binary
   * send is validated first; invalid payloads reject the send and emit
   * `message:invalid` (threat T10 — the transport never bypasses the runtime
   * protocol).
   */
  validate?: PayloadValidator;
  /** Payloads above this size transfer in chunks with progress events. */
  chunkSizeBytes?: number;
}

export interface CreateInMemoryTransportOptions {
  /** Stable per-player identity (ADR-0007); the arena assigns one per frame. */
  memberId: MemberId;
  /** Connection identity; generated deterministically when omitted. */
  connectionId?: ConnectionId;
  /** Optional player-facing name. */
  displayName?: string;
  /** Link fault profile for this transport's outgoing messages. */
  faults?: FaultProfile;
}

/** One chunk of a chunked transfer (progress + loss observability). */
export interface ChunkRecord {
  readonly messageId: MessageId;
  readonly channel: string;
  readonly sessionId: SessionId;
  readonly senderMemberId: MemberId;
  readonly senderConnectionId: ConnectionId;
  readonly sentAt: Timestamp;
  readonly version?: number;
  readonly seq?: number;
  readonly deliverySeq?: number;
  readonly reliability: TransportReliability;
  readonly ordering: TransportOrdering;
  readonly kind: "binary" | "string" | "json";
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly bytes: Uint8Array;
  readonly totalBytes: number;
}

interface PendingDelivery {
  at: number;
  order: number;
  run: () => void;
  owner: InMemoryTransport;
}

/**
 * The subset of InMemoryTransport the hub drives. Structural typing keeps the
 * hub decoupled from the transport's public API.
 */
export interface InMemoryPeer {
  readonly selfMemberId: MemberId;
  readonly displayName?: string;
  readonly connectionState: TransportConnectionState;
  readonly sessionId: SessionId | null;
  readonly suspended: boolean;
  selfConnectionId: ConnectionId;
  /** Deliver one complete message (receiver-side rules apply). */
  deliver(message: TransportMessage): void;
  /** Deliver one chunk of a chunked transfer. */
  deliverChunk(chunk: ChunkRecord): void;
  notifyPeerJoined(peer: TransportPeerInfo): void;
  notifyPeerLeft(peer: TransportPeerInfo): void;
  notifyReconnected(event: TransportReconnectEvent): void;
  notifyConnectionState(state: TransportConnectionState): void;
  dispose(): void;
}

const DEFAULT_CHUNK_SIZE_BYTES = 64 * 1024;

/** A simulated room: named namespace holding connected transports. */
interface SimulatedRoom {
  readonly name: string;
  readonly members: InMemoryTransport[];
}

export class InMemoryTransportHub {
  /** Normalized 32-bit seed of this hub (for diagnostics/reproduction). */
  readonly seed: number;

  private readonly rng: Rng;
  private readonly clock: () => number;
  private readonly scheduleFn: Scheduler;
  private readonly defaultProfile: RequiredFaultProfile;
  private readonly validator: PayloadValidator | undefined;
  private readonly chunkSizeBytes: number;

  private readonly roomsMap = new Map<string, SimulatedRoom>();
  private readonly transports = new Set<InMemoryTransport>();
  private readonly heap: PendingDelivery[] = [];
  private readonly deliveryCounters = new Map<string, number>();
  private readonly lifecycleWaiters = new Map<InMemoryTransport, (error: Error) => void>();
  private readonly rejoining = new Set<InMemoryTransport>();
  private timer: (() => void) | null = null;
  private nextOrder = 1;
  private disposed = false;

  constructor(options: InMemoryHubOptions = {}) {
    this.seed = normalizeSeed(options.seed);
    this.rng = mulberry32(this.seed);
    this.clock = options.now ?? (() => Date.now());
    this.scheduleFn = options.schedule ?? defaultScheduler;
    this.defaultProfile = normalizeProfile(options.defaultFaults);
    this.validator = options.validate;
    this.chunkSizeBytes = options.chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
  }

  /** Current virtual time (epoch ms). */
  now(): number {
    return this.clock();
  }

  /** Number of rooms currently simulated. */
  get roomCount(): number {
    return this.roomsMap.size;
  }

  /** Room names currently simulated. */
  roomNames(): readonly string[] {
    return [...this.roomsMap.keys()];
  }

  /** Members currently connected to a room (join order). */
  membersOf(room: string): readonly InMemoryTransport[] {
    return this.roomsMap.get(room)?.members ?? [];
  }

  /** Create a simulated room explicitly (also auto-created on first join). */
  createRoom(name: string): void {
    this.assertNotDisposed();
    if (!this.roomsMap.has(name)) {
      this.roomsMap.set(name, { name, members: [] });
    }
  }

  /**
   * Create a transport with a simulated peer identity and connect it to the
   * hub. The transport joins a room via {@link InMemoryTransport.join}.
   */
  createTransport(options: CreateInMemoryTransportOptions): InMemoryTransport {
    this.assertNotDisposed();
    const profile = normalizeProfile(options.faults ?? this.defaultProfile);
    const connectionId = options.connectionId ?? this.nextConnectionId();
    const transport = new InMemoryTransport(this, {
      memberId: options.memberId,
      connectionId,
      displayName: options.displayName,
      profile,
    });
    this.transports.add(transport);
    return transport;
  }

  /** Messages scheduled but not yet delivered (diagnostics/tests). */
  pendingCount(): number {
    return this.heap.length;
  }

  /** Earliest scheduled delivery time, or null when the queue is empty. */
  nextDeliveryAt(): number | null {
    const head = this.heap[0];
    return head === undefined ? null : head.at;
  }

  /** Delivery times of every pending delivery (diagnostics/tests). */
  pendingDeliveries(): readonly number[] {
    return this.heap.map((delivery) => delivery.at);
  }

  /**
   * Deliver every pending message synchronously in scheduled order,
   * ignoring real time. Deterministic: the heap is ordered by (delivery
   * time, send order). Safe in both async (arena) and test usage.
   */
  drain(): void {
    this.assertNotDisposed();
    this.cancelTimer();
    while (this.heap.length > 0) {
      const delivery = this.popMin();
      delivery.run();
    }
  }

  /** Cancel pending deliveries owned by a transport (leave/suspend). */
  cancelOwnedBy(transport: InMemoryTransport): void {
    if (this.heap.length === 0) {
      return;
    }
    const kept: PendingDelivery[] = this.heap.filter((d) => d.owner !== transport);
    if (kept.length === this.heap.length) {
      return;
    }
    this.heap.length = 0;
    for (const delivery of kept) {
      this.push(delivery);
    }
    this.rearmTimer();
  }

  /** Dispose the hub: cancel timers and clear all state. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelTimer();
    this.heap.length = 0;
    for (const reject of this.lifecycleWaiters.values()) {
      reject(new Error("InMemoryTransportHub: hub disposed during a lifecycle operation."));
    }
    this.lifecycleWaiters.clear();
    for (const transport of this.transports) {
      transport.dispose();
    }
    this.transports.clear();
    this.roomsMap.clear();
  }

  // ------------------------------------------------------------------
  // Lifecycle orchestration (called by InMemoryTransport)
  // ------------------------------------------------------------------

  join(transport: InMemoryTransport, roomName: string, sessionId: SessionId): Promise<void> {
    this.assertNotDisposed();
    // "disconnected" joins like "idle": a transport that left cleanly can
    // re-join the same (or a new) room with a fresh connection, exactly
    // like a real transport (F11 rejoin). Sessions use this for the arena's
    // disconnect → reconnect controls.
    if (transport.connectionState !== "idle" && transport.connectionState !== "disconnected") {
      return Promise.reject(
        new Error(`InMemoryTransport.join: already ${transport.connectionState}; leave() first.`),
      );
    }
    transport.notifyConnectionState("joining");
    const profile = this.profileOf(transport);
    if (profile.joinDelayMs <= 0) {
      this.completeJoin(transport, roomName, sessionId);
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.lifecycleWaiters.set(transport, reject);
      this.schedule(
        () => {
          this.lifecycleWaiters.delete(transport);
          this.completeJoin(transport, roomName, sessionId);
          resolve();
        },
        profile.joinDelayMs,
        transport,
      );
    });
  }

  leave(transport: InMemoryTransport): Promise<void> {
    this.assertNotDisposed();
    this.cancelLifecycle(transport);
    if (transport.connectionState === "idle") {
      return Promise.resolve();
    }
    if (transport.connectionState === "joining") {
      this.cancelOwnedBy(transport);
      transport.notifyConnectionState("idle");
      return Promise.resolve();
    }
    if (transport.connectionState === "connected") {
      this.cancelOwnedBy(transport);
      this.removeFromRoom(transport);
      transport.notifyConnectionState("disconnected");
    }
    // Suspended transports are already out of their room; leaving while
    // suspended still moves the local state to disconnected.
    if (transport.connectionState === "suspended") {
      transport.notifyConnectionState("disconnected");
    }
    return Promise.resolve();
  }

  reconnect(transport: InMemoryTransport): Promise<void> {
    this.assertNotDisposed();
    if (transport.connectionState !== "connected") {
      return Promise.reject(
        new Error(
          `InMemoryTransport.reconnect: not connected (state: ${transport.connectionState}).`,
        ),
      );
    }
    if (this.rejoining.has(transport)) {
      return Promise.reject(new Error("InMemoryTransport.reconnect: already reconnecting."));
    }
    const oldConnectionId = transport.selfConnectionId;
    this.removeFromRoom(transport);
    transport.notifyConnectionState("suspended");
    const profile = this.profileOf(transport);
    if (profile.rejoinDelayMs <= 0) {
      this.completeRejoin(transport, oldConnectionId);
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.lifecycleWaiters.set(transport, reject);
      this.rejoining.add(transport);
      this.schedule(
        () => {
          this.lifecycleWaiters.delete(transport);
          this.rejoining.delete(transport);
          this.completeRejoin(transport, oldConnectionId);
          resolve();
        },
        profile.rejoinDelayMs,
        transport,
      );
    });
  }

  suspend(transport: InMemoryTransport): Promise<void> {
    this.assertNotDisposed();
    if (transport.connectionState !== "connected") {
      return Promise.reject(
        new Error(
          `InMemoryTransport.suspend: not connected (state: ${transport.connectionState}).`,
        ),
      );
    }
    this.cancelOwnedBy(transport);
    this.removeFromRoom(transport);
    transport.notifyConnectionState("suspended");
    return Promise.resolve();
  }

  resume(transport: InMemoryTransport): Promise<void> {
    this.assertNotDisposed();
    if (transport.connectionState !== "suspended") {
      return Promise.reject(
        new Error(`InMemoryTransport.resume: not suspended (state: ${transport.connectionState}).`),
      );
    }
    const oldConnectionId = transport.selfConnectionId;
    const profile = this.profileOf(transport);
    if (this.rejoining.has(transport)) {
      return Promise.reject(new Error("InMemoryTransport.resume: already reconnecting."));
    }
    if (profile.rejoinDelayMs <= 0) {
      this.completeRejoin(transport, oldConnectionId);
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.lifecycleWaiters.set(transport, reject);
      this.rejoining.add(transport);
      this.schedule(
        () => {
          this.lifecycleWaiters.delete(transport);
          this.rejoining.delete(transport);
          this.completeRejoin(transport, oldConnectionId);
          resolve();
        },
        profile.rejoinDelayMs,
        transport,
      );
    });
  }

  // ------------------------------------------------------------------
  // Send path
  // ------------------------------------------------------------------

  async send(transport: InMemoryTransport, options: TransportSendOptions): Promise<void> {
    this.assertNotDisposed();
    if (transport.connectionState !== "connected") {
      throw new Error(
        `InMemoryTransport.send: not connected (state: ${transport.connectionState}).`,
      );
    }
    const sessionId = transport.sessionId;
    if (sessionId === null) {
      throw new Error("InMemoryTransport.send: no session (join() first).");
    }
    const binary = options.binary === true || isBinaryPayload(options.payload);
    if (!binary && this.validator !== undefined) {
      const result = this.validator(options.payload);
      if (!result.ok) {
        const message = this.buildMessage(transport, sessionId, options, binary);
        transport.emitInvalid(message, result.error);
        throw new Error(`InMemoryTransport.send: payload failed validation: ${result.error}`);
      }
    }

    const message = this.buildMessage(transport, sessionId, options, binary);
    const targets = this.resolveTargets(transport, options.targetConnectionId);
    const profile = this.profileOf(transport);

    const size = payloadSize(options.payload);
    if (size <= this.chunkSizeBytes) {
      const roll = rollFaults(this.rng, profile, message.reliability === "reliable");
      if (roll.lost) {
        transport.emitLost(message);
        return;
      }
      // Per-link delivery stamps (sender→receiver, channel): each link's
      // ordered stream starts at 1, so late joiners and reordering both work
      // (mirrors WebRTC data-channel sequence spaces). Stamps are assigned in
      // send order at send time — never at delivery time — so a reordered
      // arrival can still be re-buffered by the receiver. Lost messages are
      // never stamped, so a dropped unreliable message leaves no gap.
      const deliveries = targets.map((target) => ({
        target,
        message: this.stampForTarget(message, transport, target),
      }));
      for (let copy = 0; copy <= roll.duplicateCount; copy += 1) {
        this.schedule(
          () => {
            for (const delivery of deliveries) {
              delivery.target.deliver(delivery.message);
            }
          },
          roll.delayMs,
          transport,
        );
      }
      return;
    }

    // Chunked transfer: simulate chunked delivery with progress on both
    // sides (F5 scenario 4 parity). Chunks inherit the message's delivery
    // guarantees; loss of any chunk aborts the transfer. The transfer's
    // per-link stamp is reserved up front (in send order); if every chunk is
    // lost the receiver sees a gap, matching head-of-line blocking on a
    // lossy ordered channel.
    const deliveries = targets.map((target) => ({
      target,
      message: this.stampForTarget(message, transport, target),
    }));
    const { bytes, kind } = serializePayload(options.payload);
    const chunkCount = Math.max(1, Math.ceil(bytes.byteLength / this.chunkSizeBytes));
    let bytesSent = 0;
    for (let i = 0; i < chunkCount; i += 1) {
      const start = i * this.chunkSizeBytes;
      const end = Math.min(start + this.chunkSizeBytes, bytes.byteLength);
      const chunk = bytes.slice(start, end);
      const baseChunk: ChunkRecord = {
        messageId: message.messageId,
        channel: message.channel,
        sessionId,
        senderMemberId: message.senderMemberId,
        senderConnectionId: message.senderConnectionId,
        sentAt: message.sentAt,
        version: message.version,
        seq: message.seq,
        reliability: message.reliability,
        ordering: message.ordering,
        kind,
        chunkIndex: i,
        chunkCount,
        bytes: chunk,
        totalBytes: bytes.byteLength,
      };
      const roll = rollFaults(this.rng, profile, message.reliability === "reliable");
      bytesSent += chunk.byteLength;
      if (roll.lost) {
        transport.emitLost({ ...message, chunkIndex: i, chunkCount });
        continue;
      }
      for (let copy = 0; copy <= roll.duplicateCount; copy += 1) {
        this.schedule(
          () => {
            for (const delivery of deliveries) {
              delivery.target.deliverChunk({
                ...baseChunk,
                deliverySeq: delivery.message.deliverySeq,
              });
            }
          },
          roll.delayMs + i,
          transport,
        );
      }
      options.onProgress?.({
        direction: "send",
        messageId: message.messageId,
        channel: message.channel,
        bytesTransferred: bytesSent,
        totalBytes: bytes.byteLength,
        fraction: bytesSent / bytes.byteLength,
      });
    }
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /** Reject an in-flight lifecycle operation (join/reconnect/resume). */
  private cancelLifecycle(transport: InMemoryTransport): void {
    const reject = this.lifecycleWaiters.get(transport);
    if (reject !== undefined) {
      this.lifecycleWaiters.delete(transport);
      reject(new Error("InMemoryTransport: lifecycle operation cancelled."));
    }
    this.rejoining.delete(transport);
  }

  private profileOf(transport: InMemoryTransport): RequiredFaultProfile {
    return transport.faultProfile;
  }

  private nextConnectionId(): ConnectionId {
    return `conn-${rngHex(this.rng)}`;
  }

  private nextMessageId(): MessageId {
    return `msg-${rngHex(this.rng)}`;
  }

  private buildMessage(
    transport: InMemoryTransport,
    sessionId: SessionId,
    options: TransportSendOptions,
    binary: boolean,
  ): TransportMessage {
    return {
      version: options.version,
      sessionId,
      channel: options.channel,
      senderMemberId: transport.selfMemberId,
      senderConnectionId: transport.selfConnectionId,
      messageId: this.nextMessageId(),
      sentAt: this.now(),
      seq: options.seq,
      reliability: options.reliability ?? "reliable",
      ordering: options.ordering ?? "ordered",
      binary,
      payload: options.payload,
    };
  }

  /**
   * Stamp one ordered message with the next delivery sequence for its
   * (sender → receiver, channel) link. Unordered messages carry no stamp.
   */
  private stampForTarget(
    message: TransportMessage,
    sender: InMemoryTransport,
    target: InMemoryTransport,
  ): TransportMessage {
    if (message.ordering !== "ordered") {
      return message;
    }
    const key = `${sender.selfConnectionId}:${target.selfConnectionId}:${message.channel}`;
    const deliverySeq = (this.deliveryCounters.get(key) ?? 0) + 1;
    this.deliveryCounters.set(key, deliverySeq);
    return { ...message, deliverySeq };
  }

  private resolveTargets(
    transport: InMemoryTransport,
    targetConnectionId: ConnectionId | undefined,
  ): readonly InMemoryTransport[] {
    const room = this.roomsMap.get(transport.roomName);
    const members = room?.members ?? [];
    if (targetConnectionId === undefined) {
      return members.filter((m) => m !== transport);
    }
    const target = members.find((m) => m.selfConnectionId === targetConnectionId);
    if (target === undefined) {
      throw new Error(
        `InMemoryTransport.send: no connected peer with connectionId "${targetConnectionId}".`,
      );
    }
    return [target];
  }

  private completeJoin(transport: InMemoryTransport, roomName: string, sessionId: SessionId): void {
    let room = this.roomsMap.get(roomName);
    if (room === undefined) {
      room = { name: roomName, members: [] };
      this.roomsMap.set(roomName, room);
    }
    transport.sessionId = sessionId;
    transport.roomName = roomName;
    room.members.push(transport);
    transport.notifyConnectionState("connected");
    const self = this.peerInfo(transport);
    for (const member of room.members) {
      if (member !== transport) {
        member.notifyPeerJoined(self);
        transport.notifyPeerJoined(this.peerInfo(member));
      }
    }
  }

  private removeFromRoom(transport: InMemoryTransport): void {
    const room = this.roomsMap.get(transport.roomName);
    if (room === undefined) {
      return;
    }
    const index = room.members.indexOf(transport);
    if (index >= 0) {
      room.members.splice(index, 1);
    }
    const info = this.peerInfo(transport);
    for (const member of room.members) {
      member.notifyPeerLeft(info);
    }
  }

  private completeRejoin(transport: InMemoryTransport, oldConnectionId: ConnectionId): void {
    const newConnectionId = this.nextConnectionId();
    transport.selfConnectionId = newConnectionId;
    const room = this.roomsMap.get(transport.roomName);
    if (room !== undefined) {
      room.members.push(transport);
    }
    transport.notifyConnectionState("connected");
    transport.notifyReconnected({
      memberId: transport.selfMemberId,
      oldConnectionId,
      newConnectionId,
    });
    const self = this.peerInfo(transport);
    if (room !== undefined) {
      for (const member of room.members) {
        if (member !== transport) {
          member.notifyPeerJoined(self);
        }
      }
    }
  }

  private peerInfo(transport: InMemoryTransport): TransportPeerInfo {
    return {
      memberId: transport.selfMemberId,
      connectionId: transport.selfConnectionId,
      displayName: transport.displayName,
      joinedAt: this.now(),
    };
  }

  // --- Delivery queue (min-heap by (at, order)) ---

  private schedule(run: () => void, delayMs: number, owner: InMemoryTransport): void {
    const at = this.now() + Math.max(0, delayMs);
    this.push({ at, order: this.nextOrder, run, owner });
    this.nextOrder += 1;
    this.armTimer();
  }

  private push(delivery: PendingDelivery): void {
    this.heap.push(delivery);
    let index = this.heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const parentDelivery = this.heap[parent];
      const current = this.heap[index];
      if (parentDelivery === undefined || current === undefined) {
        break;
      }
      if (this.less(current, parentDelivery)) {
        this.heap[parent] = current;
        this.heap[index] = parentDelivery;
        index = parent;
      } else {
        break;
      }
    }
  }

  private popMin(): PendingDelivery {
    const first = this.heap[0];
    const last = this.heap.pop();
    if (first === undefined || last === undefined) {
      throw new Error("InMemoryTransportHub.popMin: empty heap");
    }
    if (this.heap.length > 0) {
      this.heap[0] = last;
      let index = 0;
      for (;;) {
        const left = 2 * index + 1;
        const right = 2 * index + 2;
        let smallest = index;
        const current = this.heap[index];
        const leftDelivery = this.heap[left];
        const rightDelivery = this.heap[right];
        if (
          leftDelivery !== undefined &&
          current !== undefined &&
          this.less(leftDelivery, current)
        ) {
          smallest = left;
        }
        const smallestDelivery = this.heap[smallest];
        if (
          rightDelivery !== undefined &&
          smallestDelivery !== undefined &&
          this.less(rightDelivery, smallestDelivery)
        ) {
          smallest = right;
        }
        if (smallest === index) {
          break;
        }
        const smallestEntry = this.heap[smallest];
        const indexEntry = this.heap[index];
        if (smallestEntry === undefined || indexEntry === undefined) {
          break;
        }
        this.heap[smallest] = indexEntry;
        this.heap[index] = smallestEntry;
        index = smallest;
      }
    }
    return first;
  }

  private less(a: PendingDelivery, b: PendingDelivery): boolean {
    return a.at < b.at || (a.at === b.at && a.order < b.order);
  }

  private armTimer(): void {
    if (this.timer !== null) {
      return;
    }
    const head = this.heap[0];
    if (head === undefined) {
      return;
    }
    const delay = Math.max(0, head.at - this.now());
    this.timer = this.scheduleFn(() => {
      this.timer = null;
      this.runDue();
      this.armTimer();
    }, delay);
  }

  private rearmTimer(): void {
    this.cancelTimer();
    this.armTimer();
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.timer();
      this.timer = null;
    }
  }

  private runDue(): void {
    const deadline = this.now();
    while (this.heap.length > 0) {
      const head = this.heap[0];
      if (head === undefined || head.at > deadline) {
        break;
      }
      this.popMin().run();
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("InMemoryTransportHub: hub is disposed.");
    }
  }
}

function isBinaryPayload(payload: unknown): boolean {
  return payload instanceof Uint8Array || payload instanceof ArrayBuffer;
}

function payloadSize(payload: unknown): number {
  if (payload instanceof Uint8Array) {
    return payload.byteLength;
  }
  if (payload instanceof ArrayBuffer) {
    return payload.byteLength;
  }
  if (typeof payload === "string") {
    return new TextEncoder().encode(payload).byteLength;
  }
  const json = JSON.stringify(payload);
  return json === undefined ? 0 : new TextEncoder().encode(json).byteLength;
}

export function serializePayload(payload: unknown): {
  bytes: Uint8Array;
  kind: "binary" | "string" | "json";
} {
  if (payload instanceof Uint8Array) {
    return { bytes: payload.slice(), kind: "binary" };
  }
  if (payload instanceof ArrayBuffer) {
    return { bytes: new Uint8Array(payload).slice(), kind: "binary" };
  }
  if (typeof payload === "string") {
    return { bytes: new TextEncoder().encode(payload), kind: "string" };
  }
  const json = JSON.stringify(payload);
  return { bytes: new TextEncoder().encode(json ?? ""), kind: "json" };
}
