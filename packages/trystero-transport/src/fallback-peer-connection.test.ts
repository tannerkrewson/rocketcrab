import type { SessionSecret } from "@rocketcrab/protocol";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_AFTER_MS,
  OPEN_ATTEMPTS,
  TUNNEL_PACE_BURST_BYTES,
  TUNNEL_PACE_BYTES_PER_SECOND,
  TUNNEL_PAIRED_FRAME,
  createFallbackPeerConnectionClass,
  isTunnelledConnection,
  type FallbackPeerConnectionOptions,
  type TerminalFailureInfo,
  type TunnelStartInfo,
} from "./fallback-peer-connection";
import { TUNNEL_FRAME_OVERHEAD_BYTES } from "./tunnel-crypto";

const SECRET = "A".repeat(43) as SessionSecret;
const ROOM = "party:" + "c".repeat(64);
const MAX_PAYLOAD = 262144 - TUNNEL_FRAME_OVERHEAD_BYTES;
/** The edge's per-socket budget (deploy/edge/tunnel.ts), simulated in FakeSocket. */
const SERVER_RATE_BYTES_PER_SECOND = 512 * 1024;
const SERVER_BURST_BYTES = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Fakes: injected clock, native RTCPeerConnection, data channel, WebSocket pair
// ---------------------------------------------------------------------------

class FakeClock {
  now = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  readonly setTimeout = (fn: () => void, ms: number): unknown => {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  };

  readonly clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  get pending(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      let nextId: number | undefined;
      let nextAt = Number.POSITIVE_INFINITY;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && timer.at < nextAt) {
          nextAt = timer.at;
          nextId = id;
        }
      }
      if (nextId === undefined) break;
      const timer = this.timers.get(nextId);
      if (!timer) break;
      this.timers.delete(nextId);
      this.now = timer.at;
      timer.fn();
    }
    this.now = target;
  }
}

type Listener = (event: unknown) => void;

class FakeEvents {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, fn: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  fire(type: string, event: object = {}): void {
    for (const fn of Array.from(this.listeners.get(type) ?? [])) fn({ type, ...event });
  }
}

class FakeChannel extends FakeEvents {
  readyState: RTCDataChannelState = "connecting";
  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  readonly sent: unknown[] = [];
  closeCalls = 0;

  constructor(readonly label: string) {
    super();
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
    if (this.readyState === "closed") return;
    this.readyState = "closed";
  }

  open(): void {
    this.readyState = "open";
    this.fire("open");
  }

  receive(data: unknown): void {
    this.fire("message", { data });
  }
}

class FakePeerConnection extends FakeEvents {
  static instances: FakePeerConnection[] = [];
  localSdp = "";
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  readonly channels: FakeChannel[] = [];
  closeCalls = 0;

  constructor(_config?: RTCConfiguration) {
    super();
    FakePeerConnection.instances.push(this);
  }

  async setLocalDescription(): Promise<void> {
    this.localDescription = {
      type: this.remoteDescription ? "answer" : "offer",
      sdp: this.localSdp,
    };
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = { type: description.type ?? "", sdp: description.sdp ?? "" };
  }

  createDataChannel(label: string): FakeChannel {
    const channel = new FakeChannel(label);
    this.channels.push(channel);
    return channel;
  }

  setStates(connection: RTCPeerConnectionState, ice: RTCIceConnectionState): void {
    this.connectionState = connection;
    this.iceConnectionState = ice;
    this.fire("connectionstatechange");
    this.fire("iceconnectionstatechange");
  }

  close(): void {
    this.closeCalls += 1;
    this.connectionState = "closed";
    this.iceConnectionState = "closed";
    for (const channel of this.channels) {
      if (channel.readyState === "closed") continue;
      channel.readyState = "closed";
      channel.fire("close");
    }
  }
}

/**
 * One fake WebSocket. Frames queue until delivered, so backpressure can be
 * shown. close() throws for codes a browser rejects, and every frame sent is
 * charged to a simulated server budget (never negative in a passing run).
 */
class FakeSocket {
  readyState = 0;
  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  onopen: ((event: object) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: object) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  peer: FakeSocket | null = null;
  readonly closeCalls: number[] = [];
  readonly sent: Uint8Array[] = [];
  mangle: ((bytes: Uint8Array) => void) | null = null;
  /** Simulated server bucket for this socket. */
  serverTokens = SERVER_BURST_BYTES;
  minServerTokens = SERVER_BURST_BYTES;
  private serverRefilledAt: number;
  private outbox: ArrayBuffer[] = [];

  constructor(
    readonly url: string,
    private readonly network: FakeNetwork,
  ) {
    this.serverRefilledAt = network.clock.now;
    network.accept(this);
  }

  send(data: ArrayBufferView): void {
    if (this.readyState !== 1) throw new Error("FakeSocket.send on a socket that is not open");
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    this.mangle?.(copy);
    this.chargeServerBucket(copy.byteLength);
    this.sent.push(copy);
    this.outbox.push(copy.buffer);
    this.bufferedAmount += copy.byteLength;
    if (!this.network.stalled) queueMicrotask(() => this.flush());
  }

  private chargeServerBucket(bytes: number): void {
    const now = this.network.clock.now;
    const refill = ((now - this.serverRefilledAt) * SERVER_RATE_BYTES_PER_SECOND) / 1000;
    this.serverTokens = Math.min(SERVER_BURST_BYTES, this.serverTokens + refill);
    this.serverRefilledAt = now;
    this.serverTokens -= bytes;
    this.minServerTokens = Math.min(this.minServerTokens, this.serverTokens);
  }

  flush(): void {
    const peer = this.peer;
    for (const buffer of this.outbox.splice(0)) {
      this.bufferedAmount -= buffer.byteLength;
      if (peer && peer.readyState === 1) peer.onmessage?.({ data: buffer });
    }
  }

  close(code = 1000): void {
    this.closeCalls.push(code);
    // Browsers accept only 1000 or 3000-4999 here (WHATWG WebSocket.close).
    if (code !== 1000 && (code < 3000 || code > 4999)) {
      throw new DOMException(`Invalid close code ${code}.`, "InvalidAccessError");
    }
    if (this.readyState >= 2) return;
    this.readyState = 2;
    const peer = this.peer;
    queueMicrotask(() => {
      this.readyState = 3;
      this.onclose?.({ code });
      peer?.serverClose(code);
    });
  }

  /** The edge closes this socket (or its partner) with the given code. */
  serverClose(code: number): void {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    queueMicrotask(() => {
      this.readyState = 3;
      this.onclose?.({ code });
    });
  }

  /** Socket dies without a close handshake from this side. */
  drop(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
    this.peer?.serverClose(code);
  }

  injectText(text: string): void {
    this.peer?.onmessage?.({ data: text });
  }
}

/** A WebSocket constructor whose instances are FakeSockets on `network`. */
function socketClassFor(network: FakeNetwork): typeof WebSocket {
  return class {
    constructor(url: string) {
      return new FakeSocket(url, network);
    }
  } as unknown as typeof WebSocket;
}

class FakeNetwork {
  readonly sockets: FakeSocket[] = [];
  /** How many of the next socket opens fail, like the edge's transient 409. */
  rejectNext = 0;
  stalled = false;
  readonly WebSocketImpl: typeof WebSocket;
  private readonly waiting = new Map<string, FakeSocket>();

  constructor(readonly clock: FakeClock) {
    this.WebSocketImpl = socketClassFor(this);
  }

  accept(socket: FakeSocket): void {
    this.sockets.push(socket);
    queueMicrotask(() => {
      if (this.rejectNext > 0) {
        this.rejectNext -= 1;
        socket.readyState = 3;
        socket.onerror?.({});
        socket.onclose?.({ code: 1006 });
        return;
      }
      socket.readyState = 1;
      socket.onopen?.({});
      const pairId = socket.url.split("/").at(-1) ?? "";
      const other = this.waiting.get(pairId);
      if (!other || other.readyState !== 1) {
        this.waiting.set(pairId, socket);
        return;
      }
      this.waiting.delete(pairId);
      other.peer = socket;
      socket.peer = other;
      queueMicrotask(() => {
        other.onmessage?.({ data: TUNNEL_PAIRED_FRAME });
        socket.onmessage?.({ data: TUNNEL_PAIRED_FRAME });
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Failure {
  readonly side: string;
  readonly info: TerminalFailureInfo;
}

interface Tunnelled {
  readonly side: string;
  readonly info: TunnelStartInfo;
}

interface Harness {
  readonly network: FakeNetwork;
  readonly clock: FakeClock;
  readonly failures: Failure[];
  readonly tunnels: Tunnelled[];
  classFor(
    side: string,
    overrides?: Partial<FallbackPeerConnectionOptions>,
  ): typeof RTCPeerConnection;
}

function harness(defaults: Partial<FallbackPeerConnectionOptions> = {}): Harness {
  const clock = new FakeClock();
  const network = new FakeNetwork(clock);
  const failures: Failure[] = [];
  const tunnels: Tunnelled[] = [];
  return {
    network,
    clock,
    failures,
    tunnels,
    classFor(side, overrides = {}) {
      return createFallbackPeerConnectionClass({
        NativePeerConnection: FakePeerConnection as unknown as typeof RTCPeerConnection,
        WebSocketImpl: network.WebSocketImpl,
        tunnelUrl: (pairId) => `wss://edge.test/tunnel/${pairId}`,
        roomId: ROOM,
        partySecret: SECRET,
        now: () => clock.now,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        onTunnel: (info) => tunnels.push({ side, info }),
        onTerminalFailure: (info) => failures.push({ side, info }),
        ...defaults,
        ...overrides,
      });
    },
  };
}

/** Deterministic synthetic DTLS fingerprint SDP. Different seeds differ. */
function sdp(seed: number): string {
  const octets = Array.from({ length: 32 }, (_, i) =>
    ((seed * 97 + i * 13) % 256).toString(16).padStart(2, "0").toUpperCase(),
  );
  return `v=0\r\na=fingerprint:sha-256 ${octets.join(":")}\r\n`;
}

interface Side {
  readonly pc: RTCPeerConnection;
  readonly native: FakePeerConnection;
  /** Channels Trystero receives through ondatachannel, with the state seen then. */
  readonly incoming: { channel: RTCDataChannel; stateAtCall: string }[];
}

function newSide(h: Harness, side: string, localSdp: string): Side {
  const Cls = h.classFor(side);
  const pc = new Cls();
  const native = FakePeerConnection.instances.at(-1);
  if (!native) throw new Error("no native connection was created");
  native.localSdp = localSdp;
  const incoming: { channel: RTCDataChannel; stateAtCall: string }[] = [];
  pc.ondatachannel = ({ channel }) => {
    incoming.push({ channel, stateAtCall: channel.readyState });
  };
  return { pc, native, incoming };
}

/** Offerer A and answerer B, descriptions set in Trystero's order. */
async function connectPair(h: Harness): Promise<{ a: Side; b: Side; chA: RTCDataChannel }> {
  const a = newSide(h, "a", sdp(1));
  const b = newSide(h, "b", sdp(2));
  const chA = a.pc.createDataChannel("data");
  await a.pc.setLocalDescription();
  await b.pc.setRemoteDescription({ type: "offer", sdp: sdp(1) });
  await b.pc.setLocalDescription();
  await a.pc.setRemoteDescription({ type: "answer", sdp: sdp(2) });
  return { a, b, chA };
}

/** A native data channel arriving at `side` (as an answerer gets one), opened. */
function deliverNativeChannel(side: Side): FakeChannel {
  const channel = new FakeChannel("data");
  side.native.fire("datachannel", { channel });
  channel.open();
  return channel;
}

/** Waits for a condition, letting real crypto (and optionally the clock) progress. */
async function until(cond: () => boolean, label: string, step?: () => void): Promise<void> {
  for (let i = 0; i < 20000; i += 1) {
    if (cond()) return;
    step?.();
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function bChannel(b: Side): RTCDataChannel | undefined {
  return b.incoming[0]?.channel;
}

/** Both sides switch at the deadline and pair. Returns A's and B's channels. */
async function pairUp(
  h: Harness,
): Promise<{ a: Side; b: Side; chA: RTCDataChannel; chB: RTCDataChannel }> {
  const { a, b, chA } = await connectPair(h);
  h.clock.advance(FALLBACK_AFTER_MS);
  await until(
    () => chA.readyState === "open" && bChannel(b)?.readyState === "open",
    "tunnel pairing",
  );
  const chB = bChannel(b);
  if (!chB) throw new Error("answering side got no channel");
  return { a, b, chA, chB };
}

function countBySide(failures: Failure[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const failure of failures) counts[failure.side] = (counts[failure.side] ?? 0) + 1;
  return counts;
}

function describeMessage(data: unknown): string {
  if (typeof data === "string") return `text:${data}`;
  if (data instanceof ArrayBuffer)
    return `bin:${data.byteLength}:${new DataView(data).getUint32(0)}`;
  return `unknown:${String(data)}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FallbackPeerConnection", () => {
  it("passes through to native WebRTC when the channel opens before the deadline", async () => {
    const h = harness();
    const { a, b, chA } = await connectPair(h);
    const nativeA = a.native.channels[0];
    if (!nativeA) throw new Error("no native channel");

    const seen: unknown[] = [];
    const targets: unknown[] = [];
    chA.onmessage = (event) => {
      seen.push(event.data);
      targets.push(event.target);
    };
    const listened: unknown[] = [];
    chA.addEventListener("message", (event) => listened.push(event.data));
    let opened = 0;
    chA.onopen = () => {
      opened += 1;
    };

    h.clock.advance(3000);
    a.native.setStates("connected", "connected");
    b.native.setStates("connected", "connected");
    nativeA.open();
    deliverNativeChannel(b);
    h.clock.advance(20000);

    expect(h.network.sockets).toHaveLength(0);
    expect(h.tunnels).toEqual([]);
    expect(h.clock.pending).toBe(0);
    expect(isTunnelledConnection(a.pc)).toBe(false);
    expect(a.pc.connectionState).toBe("connected");
    expect(opened).toBe(1);
    expect(chA.readyState).toBe("open");

    chA.send("hello");
    expect(nativeA.sent).toEqual(["hello"]);
    nativeA.receive("reply");
    expect(seen).toEqual(["reply"]);
    expect(listened).toEqual(["reply"]);
    expect(targets).toEqual([chA]);
  });

  it("does not start the timer while the initiator offer is still pooled", async () => {
    const h = harness();
    const Cls = h.classFor("a");
    const pc = new Cls();
    const native = FakePeerConnection.instances.at(-1);
    if (!native) throw new Error("no native connection");
    native.localSdp = sdp(1);
    pc.createDataChannel("data");
    await pc.setLocalDescription();

    h.clock.advance(60000);
    expect(h.clock.pending).toBe(0);
    expect(h.network.sockets).toHaveLength(0);
    expect(isTunnelledConnection(pc)).toBe(false);

    await pc.setRemoteDescription({ type: "answer", sdp: sdp(2) });
    expect(h.clock.pending).toBe(1);
    h.clock.advance(FALLBACK_AFTER_MS - 1);
    expect(isTunnelledConnection(pc)).toBe(false);
    h.clock.advance(1);
    expect(isTunnelledConnection(pc)).toBe(true);
    await until(() => h.network.sockets.length === 1, "tunnel socket");
    expect(h.tunnels).toEqual([
      { side: "a", info: { reason: "timeout", elapsedMs: FALLBACK_AFTER_MS } },
    ]);
  });

  it("switches on timeout, pairs, and carries data both ways", async () => {
    const h = harness();
    const { a, b, chA } = await connectPair(h);
    a.native.setStates("connecting", "checking");
    b.native.setStates("connecting", "checking");

    const aSeen: string[] = [];
    a.pc.addEventListener("connectionstatechange", () => aSeen.push(a.pc.connectionState));
    a.pc.addEventListener("iceconnectionstatechange", () => aSeen.push(a.pc.iceConnectionState));

    const aGot: unknown[] = [];
    chA.onmessage = (event) => aGot.push(event.data);
    h.clock.advance(FALLBACK_AFTER_MS);
    await until(
      () => chA.readyState === "open" && bChannel(b)?.readyState === "open",
      "tunnel pairing",
    );
    const chB = bChannel(b);
    if (!chB) throw new Error("answering side got no channel");
    const bGot: unknown[] = [];
    chB.onmessage = (event) => bGot.push(event.data);

    chA.send("ping");
    chB.send(new Uint8Array([1, 2, 3]).buffer);
    await until(() => bGot.length === 1 && aGot.length === 1, "data both ways");
    expect(bGot).toEqual(["ping"]);
    expect(aGot[0]).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(aGot[0] as ArrayBuffer))).toEqual([1, 2, 3]);

    expect(a.native.channels[0]?.sent).toEqual([]);
    expect(isTunnelledConnection(a.pc)).toBe(true);
    expect(a.pc.connectionState).toBe("connected");
    expect(aSeen).not.toContain("failed");
    expect(aSeen).not.toContain("disconnected");
    expect(aSeen.at(-1)).toBe("connected");
    expect(h.tunnels.map((t) => t.info.reason)).toEqual(["timeout", "timeout"]);
    expect(h.failures).toEqual([]);
  });

  it("switches on native connectionState failure and never shows failed to listeners or handlers", async () => {
    const h = harness();
    const { a, b, chA } = await connectPair(h);
    const seen: string[] = [];
    a.pc.addEventListener("connectionstatechange", () =>
      seen.push(`listener:${a.pc.connectionState}`),
    );
    a.pc.addEventListener("iceconnectionstatechange", () =>
      seen.push(`ice-listener:${a.pc.iceConnectionState}`),
    );
    a.pc.onconnectionstatechange = () => seen.push(`handler:${a.pc.connectionState}`);
    a.pc.oniceconnectionstatechange = () => seen.push(`ice-handler:${a.pc.iceConnectionState}`);

    h.clock.advance(1000);
    a.native.setStates("failed", "failed");
    expect(h.tunnels).toEqual([{ side: "a", info: { reason: "native-failed", elapsedMs: 1000 } }]);
    expect(a.pc.connectionState).toBe("connecting");
    expect(a.pc.iceConnectionState).toBe("checking");

    h.clock.advance(FALLBACK_AFTER_MS);
    await until(
      () => chA.readyState === "open" && bChannel(b)?.readyState === "open",
      "tunnel pairing",
    );
    expect(seen.length).toBeGreaterThan(0);
    for (const entry of seen) {
      expect(entry).not.toMatch(/failed|disconnected/);
    }
    expect(seen.at(-1)).toMatch(/connecting|checking|connected/);
    expect(a.pc.connectionState).toBe("connected");
  });

  it("switches on native iceConnectionState failure alone, with event targets set", async () => {
    const h = harness();
    const { a } = await connectPair(h);
    const seen: string[] = [];
    const targets: unknown[] = [];
    a.pc.addEventListener("connectionstatechange", (event) => {
      seen.push(a.pc.connectionState);
      targets.push(event.target);
    });
    a.native.setStates("connecting", "failed");
    expect(h.tunnels.map((t) => t.info.reason)).toEqual(["native-failed"]);
    expect(a.pc.iceConnectionState).toBe("checking");
    expect(seen).toEqual(["connecting"]);
    expect(targets).toEqual([a.pc]);
    expect(isTunnelledConnection(a.pc)).toBe(true);
  });

  it("switches when both peer connections are connected but the channel never opens", async () => {
    const h = harness();
    const { a, b, chA } = await connectPair(h);
    a.native.setStates("connected", "connected");
    b.native.setStates("connected", "connected");
    h.clock.advance(FALLBACK_AFTER_MS);
    await until(
      () => chA.readyState === "open" && bChannel(b)?.readyState === "open",
      "pairing after a stalled channel",
    );
    expect(h.tunnels.map((t) => [t.side, t.info.reason]).sort()).toEqual([
      ["a", "timeout"],
      ["b", "timeout"],
    ]);
    expect(h.failures).toEqual([]);
  });

  it("holds back a channel close before open until the deadline, then switches", async () => {
    const h = harness();
    const { a, b, chA } = await connectPair(h);
    a.native.setStates("connected", "connected");
    const nativeA = a.native.channels[0];
    if (!nativeA) throw new Error("no native channel");
    // Closed before it ever opened, while the peer connection stays connected.
    nativeA.readyState = "closed";
    nativeA.fire("close");
    expect(h.tunnels).toEqual([]);

    h.clock.advance(FALLBACK_AFTER_MS);
    expect(h.tunnels.filter((t) => t.side === "a")).toEqual([
      { side: "a", info: { reason: "timeout", elapsedMs: FALLBACK_AFTER_MS } },
    ]);
    await until(
      () => chA.readyState === "open" && bChannel(b)?.readyState === "open",
      "pairing after a pre-open close",
    );
    expect(h.failures).toEqual([]);
  });

  it("gives the answering side a synthetic datachannel with an open facade", async () => {
    const h = harness();
    const { b, chA } = await connectPair(h);
    expect(b.incoming).toEqual([]);
    expect(b.native.channels).toHaveLength(0);

    h.clock.advance(FALLBACK_AFTER_MS);
    await until(() => chA.readyState === "open" && b.incoming.length === 1, "synthetic channel");

    const entry = b.incoming[0];
    if (!entry) throw new Error("no synthetic channel");
    expect(entry.stateAtCall).toBe("connecting");
    expect(entry.channel.readyState).toBe("open");
    expect(entry.channel.label).toBe("data");
    expect(b.incoming).toHaveLength(1);

    const got: unknown[] = [];
    entry.channel.onmessage = (event) => got.push(event.data);
    chA.send("first");
    await until(() => got.length === 1, "first message");
    expect(got).toEqual(["first"]);
  });

  it("backpressure: bufferedAmount rises and bufferedamountlow fires once after the drop", async () => {
    const h = harness();
    h.network.stalled = true;
    const { chA, b } = await pairUp(h);
    const chB = bChannel(b);
    if (!chB) throw new Error("no answering channel");
    const received: unknown[] = [];
    chB.onmessage = (event) => received.push(event.data);

    chA.bufferedAmountLowThreshold = 16384;
    let lowFired = 0;
    chA.onbufferedamountlow = () => {
      lowFired += 1;
    };

    const frameBytes = 10000 + TUNNEL_FRAME_OVERHEAD_BYTES;
    for (let i = 0; i < 5; i += 1) chA.send(new ArrayBuffer(10000));
    expect(chA.bufferedAmount).toBeGreaterThan(16384);

    // Frames are sealed asynchronously, so wait until the sender's socket holds them all.
    const senderOf = () => h.network.sockets.find((s) => s.sent.length === 5);
    await until(() => senderOf()?.bufferedAmount === 5 * frameBytes, "frames queued on socket");
    const sender = senderOf();
    if (!sender) throw new Error("no sending socket");
    expect(chA.bufferedAmount).toBe(5 * frameBytes);

    h.clock.advance(50);
    expect(lowFired).toBe(0);

    sender.flush();
    expect(sender.bufferedAmount).toBe(0);
    h.clock.advance(10);
    expect(lowFired).toBe(1);

    await until(() => received.length === 5, "all frames delivered");
    h.clock.advance(100);
    expect(lowFired).toBe(1);
  });

  it("delivers 200 rapid mixed-size sends in order", { timeout: 60000 }, async () => {
    const h = harness();
    const { chA, b } = await pairUp(h);
    const chB = bChannel(b);
    if (!chB) throw new Error("no answering channel");
    const received: string[] = [];
    chB.onmessage = (event) => received.push(describeMessage(event.data));

    const expected: string[] = [];
    for (let i = 0; i < 200; i += 1) {
      if (i % 4 === 0) {
        // Large binary first, so its seal takes longer than the small ones after it.
        const bytes = new Uint8Array(60000);
        new DataView(bytes.buffer).setUint32(0, i);
        chA.send(bytes.buffer);
        expected.push(`bin:60000:${i}`);
      } else if (i % 4 === 1) {
        chA.send(`s${i}`);
        expected.push(`text:s${i}`);
      } else if (i % 4 === 2) {
        const bytes = new Uint8Array(4);
        new DataView(bytes.buffer).setUint32(0, i);
        chA.send(bytes.buffer);
        expected.push(`bin:4:${i}`);
      } else {
        chA.send("x".repeat(20000) + i);
        expected.push(`text:${"x".repeat(20000)}${i}`);
      }
    }
    // These sends exceed the pace burst, so the clock must advance for them to finish.
    await until(
      () => received.length === 200,
      "200 messages",
      () => h.clock.advance(20),
    );
    expect(received).toEqual(expected);
  });

  it(
    "paces three back-to-back 2 MiB transfers inside the server budget",
    { timeout: 60000 },
    async () => {
      const h = harness();
      const { chA, b } = await pairUp(h);
      const chB = bChannel(b);
      if (!chB) throw new Error("no answering channel");
      let count = 0;
      let lastAt = -1;
      chB.onmessage = () => {
        count += 1;
        lastAt = h.clock.now;
      };

      const transfers = 3;
      const chunks = (transfers * 2 * 1024 * 1024) / 65536;
      const chunk = new ArrayBuffer(65536);
      const start = h.clock.now;
      for (let i = 0; i < chunks; i += 1) chA.send(chunk);
      // Everything is still queued: the pace wait counts toward bufferedAmount.
      const wireBytes = chunks * (65536 + TUNNEL_FRAME_OVERHEAD_BYTES);
      expect(chA.bufferedAmount).toBe(wireBytes);

      await until(
        () => count === chunks,
        "all transfers",
        () => h.clock.advance(10),
      );
      expect(h.failures).toEqual([]);
      // The edge would close the pair with 1008 if any bucket went negative.
      for (const socket of h.network.sockets) {
        expect(socket.minServerTokens).toBeGreaterThanOrEqual(0);
      }

      // Throughput converges to the pace rate once the burst is spent.
      const elapsedMs = lastAt - start;
      const expectedMs =
        ((wireBytes - TUNNEL_PACE_BURST_BYTES) * 1000) / TUNNEL_PACE_BYTES_PER_SECOND;
      expect(elapsedMs).toBeGreaterThan(expectedMs * 0.98);
      expect(elapsedMs).toBeLessThan(expectedMs * 1.02);
      expect(TUNNEL_PACE_BYTES_PER_SECOND).toBeLessThan(512 * 1024);
      expect(TUNNEL_PACE_BURST_BYTES).toBeLessThan(4 * 1024 * 1024);
    },
  );

  it("tells the peer's channel to close when one side closes, once, and reports the close", async () => {
    const h = harness();
    const { a, chA, b } = await pairUp(h);
    const chB = bChannel(b);
    if (!chB) throw new Error("no answering channel");
    let bClosed = 0;
    chB.onclose = () => {
      bClosed += 1;
    };

    a.pc.close();
    await until(() => bClosed === 1, "peer channel close");
    expect(chB.readyState).toBe("closed");
    expect(chA.readyState).toBe("closed");
    expect(a.native.closeCalls).toBe(1);
    expect(countBySide(h.failures)).toEqual({ b: 1 });
    expect(h.failures[0]?.info).toEqual({ reason: "socket-closed", closeCode: 1000 });
  });

  it("terminates both sides once when a socket drops, and closes both channels", async () => {
    const h = harness();
    const { a, b, chA, chB } = await pairUp(h);
    let aClosed = 0;
    let bClosed = 0;
    chA.onclose = () => {
      aClosed += 1;
    };
    chB.onclose = () => {
      bClosed += 1;
    };

    const socket = h.network.sockets[0];
    if (!socket) throw new Error("no socket");
    socket.drop(1011);
    await until(() => h.failures.length === 2, "both sides to terminate");
    expect(countBySide(h.failures)).toEqual({ a: 1, b: 1 });
    expect(h.failures.map((f) => f.info.reason)).toEqual(["socket-closed", "socket-closed"]);
    expect(aClosed).toBe(1);
    expect(bClosed).toBe(1);
    expect(a.native.closeCalls).toBe(1);
    expect(b.native.closeCalls).toBe(1);
    expect(() => chA.send("after")).toThrow();
  });

  it("terminates once per side on a tampered frame, and closes both native connections", async () => {
    const h = harness();
    const { a, b, chA, chB } = await pairUp(h);
    let bClosed = 0;
    chB.onclose = () => {
      bClosed += 1;
    };
    for (const socket of h.network.sockets) {
      socket.mangle = (bytes) => {
        bytes[20] = (bytes[20] ?? 0) ^ 0xff;
      };
    }
    chA.send("tampered");
    await until(() => bClosed === 1, "receiver close");

    expect(countBySide(h.failures)).toEqual({ a: 1, b: 1 });
    const bFailure = h.failures.find((f) => f.side === "b")?.info;
    expect(bFailure).toMatchObject({ reason: "frame-error", code: "auth-failed" });
    // The failure must still tear down the native connection on both sides.
    expect(a.native.closeCalls).toBe(1);
    expect(b.native.closeCalls).toBe(1);
    // A's channel was closed by the edge's close, so a later send is refused.
    expect(() => chA.send("after")).toThrow();
    h.clock.advance(1000);
    expect(countBySide(h.failures)).toEqual({ a: 1, b: 1 });
  });

  it("terminates once per side on a text frame other than paired, and closes both native connections", async () => {
    const h = harness();
    const { a, b, chA, chB } = await pairUp(h);
    let bClosed = 0;
    chB.onclose = () => {
      bClosed += 1;
    };
    const socket = h.network.sockets[0];
    if (!socket) throw new Error("no socket");
    socket.injectText("not-paired");
    await until(() => bClosed === 1, "close after text frame");
    expect(countBySide(h.failures)).toEqual({ a: 1, b: 1 });
    expect(h.failures.filter((f) => f.info.reason === "protocol-violation")).toHaveLength(1);
    expect(chA.readyState).toBe("closed");
    expect(a.native.closeCalls).toBe(1);
    expect(b.native.closeCalls).toBe(1);
  });

  it("closes idempotently", async () => {
    const h = harness();
    const { a, chA } = await pairUp(h);
    a.pc.close();
    a.pc.close();
    expect(a.native.closeCalls).toBe(1);
    expect(chA.readyState).toBe("closed");
    expect(() => chA.send("x")).toThrow();
    h.clock.advance(60000);
    // B learns of the close from the edge; that is one terminal failure for B only.
    await until(() => countBySide(h.failures).b === 1, "partner terminal");
    expect(countBySide(h.failures)).toEqual({ b: 1 });
    // Only A's own socket is closed locally; B's is closed by the edge.
    expect(h.network.sockets.map((s) => s.closeCalls.length).sort()).toEqual([0, 1]);
  });

  it("closes during pairing: the socket closes with 1000, and nothing is reported as a failure", async () => {
    const h = harness();
    const { a, b, chA } = await connectPair(h);
    // B's channel is open, so B never switches and only A's socket exists.
    deliverNativeChannel(b);
    h.clock.advance(FALLBACK_AFTER_MS);
    await until(() => h.network.sockets.length === 1, "A's unpaired socket");
    const socket = h.network.sockets[0];
    if (!socket) throw new Error("no socket");

    a.pc.close();
    await until(() => socket.readyState === 3, "socket closed");
    expect(socket.closeCalls).toEqual([1000]);
    expect(h.failures).toEqual([]);
    expect(a.native.closeCalls).toBe(1);
    expect(chA.readyState).toBe("closed");
  });

  it("closes during key derivation: no socket is opened", async () => {
    const h = harness();
    const { a, b } = await connectPair(h);
    deliverNativeChannel(b);
    h.clock.advance(FALLBACK_AFTER_MS);
    // A has switched; the key derivation is still in flight.
    a.pc.close();
    for (let i = 0; i < 50; i += 1) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    }
    expect(h.network.sockets).toHaveLength(0);
    expect(h.failures).toEqual([]);
    expect(a.native.closeCalls).toBe(1);
  });

  it("asymmetric lone socket: the healthy side closes once the lone side tears down", async () => {
    const h = harness();
    const { a, b, chA } = await connectPair(h);
    a.native.setStates("connected", "connected");
    const nativeA = a.native.channels[0];
    if (!nativeA) throw new Error("no native channel");
    nativeA.open();
    let aClosed = 0;
    chA.onclose = () => {
      aClosed += 1;
    };

    // B never gets a channel and switches; A's channel is open, so A stays native.
    h.clock.advance(FALLBACK_AFTER_MS);
    await until(() => h.network.sockets.length === 1, "B's lone socket");
    expect(h.tunnels.map((t) => t.side)).toEqual(["b"]);
    expect(b.native.channels).toHaveLength(0);

    // The edge's 30 s lone-socket timeout, then A's channel closing with B's DTLS teardown.
    const lone = h.network.sockets[0];
    if (!lone) throw new Error("no lone socket");
    lone.serverClose(4408);
    await until(() => h.failures.length === 1, "B's terminal failure");
    expect(b.native.closeCalls).toBe(1);
    nativeA.readyState = "closed";
    nativeA.fire("close");

    expect(h.failures.map((f) => ({ side: f.side, info: f.info }))).toEqual([
      { side: "b", info: { reason: "socket-closed", closeCode: 4408 } },
    ]);
    expect(aClosed).toBe(1);
    expect(a.native.closeCalls).toBe(1);
  });

  it("an answerer that fails before pairing reports closed to Trystero", async () => {
    const h = harness();
    const { a, b } = await connectPair(h);
    a.native.setStates("connected", "connected");
    a.native.channels[0]?.open();
    const seen: string[] = [];
    b.pc.addEventListener("connectionstatechange", () => seen.push(b.pc.connectionState));

    h.clock.advance(FALLBACK_AFTER_MS);
    await until(() => h.network.sockets.length === 1, "B's unpaired socket");
    h.network.sockets[0]?.serverClose(4408);
    await until(() => h.failures.length === 1, "B's terminal failure");

    // B has no channel to close, so the state event is what Trystero hears.
    expect(b.incoming).toEqual([]);
    expect(seen.at(-1)).toBe("closed");
    expect(b.native.closeCalls).toBe(1);
  });

  it("refuses a send before pairing, like a native channel while connecting", async () => {
    const h = harness();
    const { chA } = await connectPair(h);
    h.clock.advance(FALLBACK_AFTER_MS);
    expect(chA.readyState).toBe("connecting");
    let error: unknown;
    try {
      chA.send("too early");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("InvalidStateError");
  });

  it("resets bufferedAmount after close", async () => {
    const h = harness();
    h.network.stalled = true;
    const { a, chA } = await pairUp(h);
    for (let i = 0; i < 3; i += 1) chA.send(new ArrayBuffer(10000));
    expect(chA.bufferedAmount).toBeGreaterThan(0);
    a.pc.close();
    expect(chA.bufferedAmount).toBe(0);
  });

  it("delivers binary as a Blob when binaryType is blob", async () => {
    const h = harness();
    const { chA, b } = await pairUp(h);
    const chB = bChannel(b);
    if (!chB) throw new Error("no answering channel");
    chB.binaryType = "blob";
    const got: unknown[] = [];
    chB.onmessage = (event) => got.push(event.data);
    chA.send(new Uint8Array([9, 8]).buffer);
    await until(() => got.length === 1, "blob delivery");
    expect(got[0]).toBeInstanceOf(Blob);
    expect((got[0] as Blob).size).toBe(2);
  });

  it("never switches back to native once tunnelled", async () => {
    const h = harness();
    const { a, chA, chB } = await pairUp(h);
    expect(h.tunnels.filter((t) => t.side === "a")).toHaveLength(1);

    const got: unknown[] = [];
    chA.onmessage = (event) => got.push(event.data);
    const bGot: unknown[] = [];
    chB.onmessage = (event) => bGot.push(event.data);
    const native = a.native.channels[0];
    if (!native) throw new Error("no native channel");

    a.native.setStates("connected", "connected");
    a.native.setStates("failed", "failed");
    native.open();
    native.receive("from-native");
    expect(got).toEqual([]);

    chA.send("via-tunnel");
    await until(() => bGot.length === 1, "tunnel delivery");
    expect(bGot).toEqual(["via-tunnel"]);
    expect(native.sent).toEqual([]);
    expect(a.pc.connectionState).toBe("connected");
    expect(isTunnelledConnection(a.pc)).toBe(true);

    h.clock.advance(60000);
    expect(h.tunnels.filter((t) => t.side === "a")).toHaveLength(1);
    expect(h.network.sockets).toHaveLength(2);
  });

  it("rejects a send over the tunnel frame limit and accepts one at it", async () => {
    const h = harness();
    const { chA, b } = await pairUp(h);
    const chB = bChannel(b);
    if (!chB) throw new Error("no answering channel");
    const sizes: number[] = [];
    chB.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) sizes.push(event.data.byteLength);
    };
    expect(() => chA.send(new Uint8Array(MAX_PAYLOAD + 1))).toThrow(RangeError);
    chA.send(new Uint8Array(MAX_PAYLOAD));
    await until(() => sizes.length === 1, "max-size delivery");
    expect(sizes).toEqual([MAX_PAYLOAD]);
  });

  it("retries a failed open (transient 409) and then pairs", { timeout: 20000 }, async () => {
    const h = harness();
    h.network.rejectNext = 2;
    const { a, b, chA } = await connectPair(h);
    h.clock.advance(FALLBACK_AFTER_MS);
    await until(
      () => chA.readyState === "open" && bChannel(b)?.readyState === "open",
      "pairing after retries",
      () => h.clock.advance(250),
    );
    expect(h.failures).toEqual([]);
    // Two rejected opens plus one successful open per side.
    expect(h.network.sockets).toHaveLength(4);
    expect(isTunnelledConnection(a.pc)).toBe(true);
  });

  it("stops retrying an open when the next retry would pass the fallback deadline", async () => {
    // Switch at t=1000, deadline t=2000. Retries wait 250, then 500, then 1000,
    // and the 1000 ms wait would end at 2750, past the deadline, so it is not taken.
    const h = harness({ fallbackAfterMs: 1000 });
    h.network.rejectNext = 1000;
    await connectPair(h);
    h.clock.advance(1000);
    await until(() => h.network.sockets.length === 2, "first attempts");
    h.clock.advance(250);
    await until(() => h.network.sockets.length === 4, "second attempts");
    h.clock.advance(500);
    await until(() => h.network.sockets.length === 6, "third attempts");
    await until(() => h.failures.length === 2, "both sides give up");

    expect(h.failures.map((f) => f.side).sort()).toEqual(["a", "b"]);
    expect(h.failures.map((f) => f.info)).toEqual([
      { reason: "open-failed", attempts: 3 },
      { reason: "open-failed", attempts: 3 },
    ]);
    expect(h.network.sockets).toHaveLength(6);
  });

  it("gives up after OPEN_ATTEMPTS failed opens with backoff 250, 500, 1000, 2000", async () => {
    expect(OPEN_ATTEMPTS).toBe(5);
    const h = harness();
    h.network.rejectNext = 1000;
    const { a } = await connectPair(h);
    h.clock.advance(FALLBACK_AFTER_MS);
    const delays = [250, 500, 1000, 2000];
    for (const [index, delay] of delays.entries()) {
      await until(() => h.network.sockets.length === 2 * (index + 1), `attempt ${index + 1}`);
      h.clock.advance(delay);
    }
    await until(() => h.failures.length === 2, "both sides exhaust retries");

    expect(h.network.sockets).toHaveLength(2 * OPEN_ATTEMPTS);
    expect(h.failures.map((f) => f.info)).toEqual([
      { reason: "open-failed", attempts: OPEN_ATTEMPTS },
      { reason: "open-failed", attempts: OPEN_ATTEMPTS },
    ]);
    expect(a.native.closeCalls).toBe(1);
  });
});
