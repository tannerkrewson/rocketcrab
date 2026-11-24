import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BURST_BYTES,
  MAX_TUNNEL_FRAME_BYTES,
  MIN_TUNNEL_FRAME_CHARGE,
  PAIRED_FRAME,
  PARTNER_WAIT_MS,
  PAIR_LIFETIME_MS,
  LIFETIME_BYTES_PER_SOCKET,
  TunnelPair,
  sendableCloseCode,
} from "./tunnel";

interface Attachment {
  generation: string | null;
  closedByServer: boolean;
  tokens: number;
  lastRefillMs: number;
}

interface FakeSocket {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  serializeAttachment(value: Attachment): void;
  deserializeAttachment(): Attachment | null;
  stored: Attachment | null;
}

/** A server-side socket. Closing it moves it to CLOSING, as the runtime does. */
function fakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(() => {
      socket.readyState = 2;
    }),
    stored: null,
    serializeAttachment(value) {
      socket.stored = structuredClone(value);
    },
    deserializeAttachment() {
      return socket.stored === null ? null : structuredClone(socket.stored);
    },
  };
  return socket;
}

// Node's Response rejects status 101, which Workers allow alongside `webSocket`.
class UpgradeResponse extends Response {
  readonly webSocket: unknown;
  constructor(body: BodyInit | null, init: ResponseInit & { webSocket?: unknown }) {
    super(body, { ...init, status: init.status === 101 ? 200 : init.status });
    this.webSocket = init.webSocket;
    if (init.status === 101) Object.defineProperty(this, "status", { value: 101 });
  }
}

const frame = (bytes: number) => new ArrayBuffer(bytes);
const FRAME_256K = 262144;

function setup() {
  const sockets: FakeSocket[] = [];
  const created: Array<{ server: FakeSocket; client: FakeSocket }> = [];
  const storage = { setAlarm: vi.fn(), deleteAlarm: vi.fn() };
  const state = {
    acceptWebSocket: vi.fn((socket: FakeSocket) => sockets.push(socket)),
    getWebSockets: () => sockets,
    storage,
  };
  const asState = state as unknown as ConstructorParameters<typeof TunnelPair>[0];
  const pair = new TunnelPair(asState);
  const typed = (socket: FakeSocket) =>
    socket as unknown as Parameters<TunnelPair["webSocketError"]>[0];
  vi.stubGlobal("Response", UpgradeResponse);

  /** Connects through the real fetch path with a stubbed WebSocketPair. */
  async function connect(via = pair) {
    const server = fakeSocket();
    const client = fakeSocket();
    created.push({ server, client });
    vi.stubGlobal("WebSocketPair", function FakePair() {
      return { 0: client, 1: server };
    });
    const response = await via.fetch(
      new Request("https://edge.example/tunnel", { headers: { Upgrade: "websocket" } }),
    );
    return { response, server, client };
  }

  /** Two sockets that have been paired through fetch. */
  async function pairUp(via = pair) {
    const first = await connect(via);
    const second = await connect(via);
    return { a: first.server, b: second.server, first, second };
  }

  /** A fresh object over the same state, as after hibernation wakes the DO. */
  const wake = () => new TunnelPair(asState);

  return { pair, sockets, created, storage, typed, connect, pairUp, wake };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TunnelPair forwarding", () => {
  it("forwards binary frames both ways unchanged", async () => {
    const { pair, typed, pairUp } = setup();
    const { a, b } = await pairUp();
    const outbound = new Uint8Array([1, 2, 3]).buffer;
    pair.webSocketMessage(typed(a), outbound);
    expect(b.send).toHaveBeenCalledTimes(2);
    expect(b.send.mock.calls[1]?.[0]).toBe(outbound);
    const inbound = new Uint8Array([4, 5]).buffer;
    pair.webSocketMessage(typed(b), inbound);
    expect(a.send).toHaveBeenCalledTimes(2);
    expect(a.send.mock.calls[1]?.[0]).toBe(inbound);
  });

  it("closes both sides with 1003 when a client sends a text frame, and forwards nothing", async () => {
    const { pair, typed, pairUp } = setup();
    const { a, b } = await pairUp();
    pair.webSocketMessage(typed(a), "paired");
    expect(a.close).toHaveBeenCalledWith(1003, "binary only");
    expect(b.close).toHaveBeenCalledWith(1003, "binary only");
    expect(b.send).toHaveBeenCalledTimes(1);
    expect(a.send).toHaveBeenCalledTimes(1);
  });

  it("closes a lone client that sends text with 1003", async () => {
    const { pair, typed, connect } = setup();
    const lone = await connect();
    pair.webSocketMessage(typed(lone.server), "hi");
    expect(lone.server.close).toHaveBeenCalledWith(1003, "binary only");
  });

  it("drops frames before pairing instead of buffering them", async () => {
    const { pair, typed, connect } = setup();
    const lone = await connect();
    expect(() => pair.webSocketMessage(typed(lone.server), frame(4))).not.toThrow();
    expect(lone.server.send).not.toHaveBeenCalled();
    expect(lone.server.close).not.toHaveBeenCalled();
  });

  it("closes the sender with 1011 once paired if the partner is no longer open", async () => {
    const { pair, typed, pairUp } = setup();
    const { a, b } = await pairUp();
    b.readyState = 3;
    pair.webSocketMessage(typed(a), frame(4));
    expect(a.close).toHaveBeenCalledWith(1011, "partner gone");
    expect(b.send).toHaveBeenCalledTimes(1);
  });
});

describe("TunnelPair frame limit", () => {
  it("accepts a frame at the limit, which covers the client's 29-byte framing", async () => {
    const { pair, typed, pairUp } = setup();
    const { a, b } = await pairUp();
    expect(MAX_TUNNEL_FRAME_BYTES).toBe(262144 + 64);
    pair.webSocketMessage(typed(a), frame(262144 + 29));
    expect(b.send).toHaveBeenCalledTimes(2);
    expect(a.close).not.toHaveBeenCalled();
    pair.webSocketMessage(typed(a), frame(MAX_TUNNEL_FRAME_BYTES));
    expect(b.send).toHaveBeenCalledTimes(3);
    expect(a.close).not.toHaveBeenCalled();
  });

  it("closes both sides with 1009 for a frame one byte over the limit", async () => {
    const { pair, typed, pairUp } = setup();
    const { a, b } = await pairUp();
    pair.webSocketMessage(typed(a), frame(MAX_TUNNEL_FRAME_BYTES + 1));
    expect(a.close).toHaveBeenCalledWith(1009, "message too big");
    expect(b.close).toHaveBeenCalledWith(1009, "message too big");
    expect(b.send).toHaveBeenCalledTimes(1);
  });
});

describe("TunnelPair relay budget", () => {
  it("lets traffic within the budget through", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { pair, typed, pairUp } = setup();
    const { a, b } = await pairUp();
    for (let i = 0; i < 10; i++) pair.webSocketMessage(typed(a), frame(FRAME_256K));
    expect(b.send).toHaveBeenCalledTimes(11);
    expect(a.close).not.toHaveBeenCalled();
  });

  it("closes both sides with 1008 when a burst exceeds the bucket", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { pair, typed, pairUp } = setup();
    const { a, b } = await pairUp();
    for (let i = 0; i < BURST_BYTES / FRAME_256K; i++)
      pair.webSocketMessage(typed(a), frame(FRAME_256K));
    expect(a.close).not.toHaveBeenCalled();
    pair.webSocketMessage(typed(a), frame(FRAME_256K));
    expect(a.close).toHaveBeenCalledWith(1008, "rate limit");
    expect(b.close).toHaveBeenCalledWith(1008, "rate limit");
    expect(b.send).toHaveBeenCalledTimes(1 + BURST_BYTES / FRAME_256K);
  });

  it("charges empty frames against the same budget as data", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { typed, wake, pairUp } = setup();
    const { a, b } = await pairUp();
    a.stored = { ...a.stored!, tokens: MIN_TUNNEL_FRAME_CHARGE };
    const awake = wake();
    awake.webSocketMessage(typed(a), frame(0));
    expect(b.send).toHaveBeenCalledTimes(2);
    awake.webSocketMessage(typed(a), frame(0));
    expect(a.close).toHaveBeenCalledWith(1008, "rate limit");
    expect(b.send).toHaveBeenCalledTimes(2);
  });

  it("refills at the sustained rate", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { pair, typed, pairUp } = setup();
    const { a, b } = await pairUp();
    for (let i = 0; i < BURST_BYTES / FRAME_256K; i++)
      pair.webSocketMessage(typed(a), frame(FRAME_256K));
    clock.mockReturnValue(1_000 + 1_000);
    const before = b.send.mock.calls.length;
    pair.webSocketMessage(typed(a), frame(FRAME_256K));
    pair.webSocketMessage(typed(a), frame(FRAME_256K));
    expect(b.send.mock.calls.length).toBe(before + 2);
    expect(a.close).not.toHaveBeenCalled();
    pair.webSocketMessage(typed(a), frame(FRAME_256K));
    expect(a.close).toHaveBeenCalledWith(1008, "rate limit");
  });

  it("keeps a persisted bucket across a hibernation wake", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { pair, typed, pairUp, wake } = setup();
    const { a, b } = await pairUp();
    for (let i = 0; i < BURST_BYTES / FRAME_256K; i++)
      pair.webSocketMessage(typed(a), frame(FRAME_256K));
    // One second later, a small frame persists the bucket: 512 KiB refilled, less 1 byte.
    clock.mockReturnValue(2_000);
    pair.webSocketMessage(typed(a), frame(1));
    // A woken object reads that bucket: one 256 KiB frame fits, the next does not.
    const woke = wake();
    woke.webSocketMessage(typed(a), frame(FRAME_256K));
    expect(a.close).not.toHaveBeenCalled();
    woke.webSocketMessage(typed(a), frame(FRAME_256K));
    expect(a.close).toHaveBeenCalledWith(1008, "rate limit");
    expect(b.close).toHaveBeenCalledWith(1008, "rate limit");
  });

  it("charges lifetime reservations across wakeups", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { typed, pairUp, wake } = setup();
    const { a, b } = await pairUp();
    const bytes = frame(256);
    // Each wake can use a new reservation only after persisting its charge.
    for (let i = 1; i < LIFETIME_BYTES_PER_SOCKET / BURST_BYTES; i++) {
      clock.mockReturnValue(1_000 + i * 1_000);
      wake().webSocketMessage(typed(a), bytes);
      expect(b.send).toHaveBeenLastCalledWith(bytes);
    }
    expect(a.close).not.toHaveBeenCalled();
    wake().webSocketMessage(typed(a), bytes);
    expect(a.close).toHaveBeenCalledWith(1008, "lifetime byte limit");
    expect(b.close).toHaveBeenCalledWith(1008, "lifetime byte limit");
  });

  it("writes the attachment at most once per second per socket", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { pair, typed, pairUp } = setup();
    const { a } = await pairUp();
    const writes = vi.spyOn(a, "serializeAttachment");
    // 100 frames over 891 ms: at most two writes allowed; the bucket is in memory.
    for (let i = 0; i < 100; i++) {
      clock.mockReturnValue(1_000 + i * 9);
      pair.webSocketMessage(typed(a), frame(1024));
    }
    expect(writes.mock.calls.length).toBeLessThanOrEqual(2);
    expect(a.close).not.toHaveBeenCalled();
    clock.mockReturnValue(2_100);
    pair.webSocketMessage(typed(a), frame(1024));
    expect(writes.mock.calls.length).toBeLessThanOrEqual(3);
    expect(writes.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("writes once per 512 KiB spent: a 4 MiB burst within 1 s causes 8 writes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { pair, typed, pairUp } = setup();
    const { a } = await pairUp();
    const writes = vi.spyOn(a, "serializeAttachment");
    for (let i = 0; i < BURST_BYTES / FRAME_256K; i++)
      pair.webSocketMessage(typed(a), frame(FRAME_256K));
    expect(writes).toHaveBeenCalledTimes(8);
    expect(a.close).not.toHaveBeenCalled();
  });

  it("never over-credits a woken bucket by more than 512 KiB", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { pair, typed, pairUp, wake } = setup();
    const { a, b } = await pairUp();
    // Three 256 KiB frames within 1 s: 768 KiB spent, of which 512 KiB is written.
    for (let i = 0; i < 3; i++) pair.webSocketMessage(typed(a), frame(FRAME_256K));
    const trueRemaining = BURST_BYTES - 3 * FRAME_256K;
    // The woken object rebuilds from the last write, so it sees the bucket as of 512 KiB spent.
    const woke = wake();
    let accepted = 0;
    for (let i = 0; i < 32 && a.close.mock.calls.length === 0; i++) {
      const before = b.send.mock.calls.length;
      woke.webSocketMessage(typed(a), frame(FRAME_256K));
      if (b.send.mock.calls.length > before) accepted += FRAME_256K;
    }
    expect(accepted - trueRemaining).toBeLessThanOrEqual(512 * 1024);
    expect(a.close).toHaveBeenCalledWith(1008, "rate limit");
  });

  it("persists the bucket when a socket closes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { pair, typed, pairUp } = setup();
    const { a } = await pairUp();
    for (let i = 0; i < BURST_BYTES / FRAME_256K; i++)
      pair.webSocketMessage(typed(a), frame(FRAME_256K));
    pair.webSocketMessage(typed(a), frame(FRAME_256K));
    expect(a.stored).toMatchObject({ tokens: 0, lastRefillMs: 1_000, closedByServer: true });
  });

  it("fails closed on a malformed bucket after wake", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { typed, pairUp, wake } = setup();
    const malformed: Array<Record<string, unknown>> = [
      { tokens: Number.NaN, lastRefillMs: 1_000 },
      { tokens: undefined, lastRefillMs: 1_000 },
      { tokens: BURST_BYTES, lastRefillMs: Number.NaN },
      { tokens: BURST_BYTES, lastRefillMs: undefined },
    ];
    for (const corrupt of malformed) {
      const { a, b } = await pairUp();
      a.stored = { ...a.stored, ...corrupt } as unknown as Attachment;
      wake().webSocketMessage(typed(a), frame(1));
      expect(a.close).toHaveBeenCalledWith(1008, "rate limit");
      expect(b.close).toHaveBeenCalledWith(1008, "rate limit");
    }
  });
});

describe("TunnelPair close and error propagation", () => {
  it("closes the partner with the same code and a reason", async () => {
    const { pair, typed, pairUp } = setup();
    const { a, b } = await pairUp();
    pair.webSocketClose(typed(a), 1001, "going away");
    expect(a.close).toHaveBeenCalledWith(1001, "closed");
    expect(b.close).toHaveBeenCalledWith(1001, "partner closed");
  });

  it("substitutes 1000 for codes that cannot be sent (1005, 1006, 1015)", async () => {
    for (const code of [1005, 1006, 1015]) {
      const { pair, typed, pairUp } = setup();
      const { a, b } = await pairUp();
      pair.webSocketClose(typed(a), code, "");
      expect(b.close).toHaveBeenCalledWith(1000, "partner closed");
    }
  });

  it("closes the partner when a socket errors", async () => {
    const { pair, typed, pairUp } = setup();
    const { a, b } = await pairUp();
    pair.webSocketError(typed(b));
    expect(b.close).toHaveBeenCalledWith(1011, "websocket error");
    expect(a.close).toHaveBeenCalledWith(1011, "partner error");
  });

  it("clears the alarm when a lone socket errors", async () => {
    const { pair, typed, connect, storage } = setup();
    const lone = await connect();
    pair.webSocketError(typed(lone.server));
    expect(storage.deleteAlarm).toHaveBeenCalledTimes(1);
  });

  it("only treats close codes that a server may send as sendable (1010 is client-only)", () => {
    for (const code of [1000, 1001, 1003, 1007, 1008, 1009, 1011, 3000, 4408, 4999])
      expect(sendableCloseCode(code)).toBe(true);
    for (const code of [999, 1004, 1005, 1006, 1010, 1012, 1015, 2999, 5000])
      expect(sendableCloseCode(code)).toBe(false);
  });
});

describe("TunnelPair pairing over fetch", () => {
  it("accepts two sockets, replaces the partner deadline with the pair lifetime on pairing", async () => {
    const { connect, storage } = setup();
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const first = await connect();
    expect(first.response.status).toBe(101);
    expect(storage.setAlarm).toHaveBeenCalledWith(1_000 + PARTNER_WAIT_MS);
    expect(storage.deleteAlarm).not.toHaveBeenCalled();
    await connect();
    expect(storage.setAlarm).toHaveBeenLastCalledWith(1_000 + PAIR_LIFETIME_MS);
    clock.mockRestore();
  });

  it("sends paired exactly once to each side when the second socket joins", async () => {
    const { connect } = setup();
    const first = await connect();
    expect(first.server.send).not.toHaveBeenCalled();
    const second = await connect();
    expect(first.server.send.mock.calls).toEqual([[PAIRED_FRAME]]);
    expect(second.server.send.mock.calls).toEqual([[PAIRED_FRAME]]);
    expect(first.client.send).not.toHaveBeenCalled();
    expect(second.client.send).not.toHaveBeenCalled();
  });

  it("does not repeat paired after hibernation, and keeps pairing state from getWebSockets", async () => {
    const { pairUp, typed, sockets, storage, wake, connect } = setup();
    const { a, b } = await pairUp();
    const woke = wake();

    const data = frame(3);
    woke.webSocketMessage(typed(a), data);
    expect(b.send.mock.calls).toEqual([[PAIRED_FRAME], [data]]);
    expect(a.send.mock.calls).toEqual([[PAIRED_FRAME]]);

    await woke.alarm();
    expect(a.close).not.toHaveBeenCalled();
    expect(b.close).not.toHaveBeenCalled();
    const third = await connect(woke);
    expect(third.response.status).toBe(409);
    expect(storage.setAlarm).toHaveBeenCalledTimes(3);
    expect(sockets).toHaveLength(2);
  });

  it("rejects a third socket with 409 and does not accept it", async () => {
    const { connect, sockets, storage } = setup();
    await connect();
    await connect();
    const third = await connect();
    expect(third.response.status).toBe(409);
    expect(await third.response.json()).toEqual({
      error: { code: "pair_full", message: "tunnel pair already has two sockets" },
    });
    expect(sockets).toHaveLength(2);
    expect(third.server.close).not.toHaveBeenCalled();
    expect(storage.setAlarm).toHaveBeenCalledTimes(2);
  });

  it("does not count a listed socket that has already closed toward the limit", async () => {
    const { connect, sockets } = setup();
    sockets.push(
      {
        ...fakeSocket(),
        readyState: 3,
        stored: { generation: null, closedByServer: false, tokens: 0, lastRefillMs: 0 },
      },
      {
        ...fakeSocket(),
        readyState: 3,
        stored: { generation: null, closedByServer: false, tokens: 0, lastRefillMs: 0 },
      },
    );
    const live = await connect();
    expect(live.response.status).toBe(101);
  });

  it("closes the accepted socket and rethrows when the alarm cannot be set", async () => {
    const { connect, created, storage } = setup();
    storage.setAlarm.mockRejectedValueOnce(new Error("alarm down"));
    await expect(connect()).rejects.toThrow("alarm down");
    expect(created[0]?.server.close).toHaveBeenCalledWith(1011, "partner timer unavailable");
  });

  it("closes both sockets when setting the lifetime alarm fails", async () => {
    const { connect, created, storage } = setup();
    const first = await connect();
    storage.setAlarm.mockRejectedValueOnce(new Error("alarm down"));
    await expect(connect()).rejects.toThrow("alarm down");
    expect(first.server.close).toHaveBeenCalledWith(1011, "lifetime timer unavailable");
    expect(created[1]?.server.close).toHaveBeenCalledWith(1011, "lifetime timer unavailable");
  });

  it("refuses a newcomer with a retryable 409 while a paired socket's partner is mid-close", async () => {
    const { pairUp, connect, sockets } = setup();
    const { a, b } = await pairUp();
    // B's partner-side close has begun, but its close has not been dispatched yet.
    b.readyState = 3;
    const newcomer = await connect();
    expect(newcomer.response.status).toBe(409);
    expect(await newcomer.response.json()).toEqual({
      error: { code: "pair_closing", message: "previous tunnel pair is still closing; retry" },
    });
    expect(sockets).toHaveLength(2);
    expect(a.close).not.toHaveBeenCalled();
  });

  it("requires a WebSocket upgrade", async () => {
    const { pair } = setup();
    const response = await pair.fetch(new Request("https://edge.example/tunnel"));
    expect(response.status).toBe(426);
  });
});

describe("TunnelPair partner deadline", () => {
  it("closes a lone socket with 4408 when the alarm fires", async () => {
    const { connect, pair } = setup();
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const lone = await connect();
    clock.mockReturnValue(1_000 + PARTNER_WAIT_MS);
    await pair.alarm();
    expect(lone.server.close).toHaveBeenCalledWith(4408, "no partner");
  });

  it("reevaluates an early alarm and closes the pair at the persisted deadline", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { connect, wake, storage } = setup();
    const first = await connect();
    const second = await connect();
    await wake().alarm();
    expect(first.server.close).not.toHaveBeenCalled();
    expect(second.server.close).not.toHaveBeenCalled();
    expect(storage.setAlarm).toHaveBeenLastCalledWith(1_000 + PAIR_LIFETIME_MS);
    clock.mockReturnValue(1_000 + PAIR_LIFETIME_MS);
    await wake().alarm();
    expect(first.server.close).toHaveBeenCalledWith(4408, "lifetime limit");
    expect(second.server.close).toHaveBeenCalledWith(4408, "lifetime limit");
  });

  it("clears the alarm when the lone socket leaves first", async () => {
    const { connect, pair, typed, storage } = setup();
    const lone = await connect();
    pair.webSocketClose(typed(lone.server), 1000, "bye");
    expect(storage.deleteAlarm).toHaveBeenCalledTimes(1);
  });
});

describe("TunnelPair stale close echoes", () => {
  it("ignores the echo of an alarm close, so a later joiner keeps its alarm", async () => {
    const { pair, typed, connect, storage } = setup();
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const a = await connect();
    clock.mockReturnValue(1_000 + PARTNER_WAIT_MS);
    await pair.alarm();
    const b = await connect(); // A is closing, so B is alone and gets its own alarm
    expect(storage.setAlarm).toHaveBeenCalledTimes(2);
    pair.webSocketClose(typed(a.server), 1000, "echo");
    expect(b.server.close).not.toHaveBeenCalled();
    expect(b.server.readyState).toBe(1);
    expect(storage.deleteAlarm).not.toHaveBeenCalled();
  });

  it("keeps two joiners paired when they join while two closed sockets are still echoing", async () => {
    const { pair, typed, pairUp, connect } = setup();
    const { a, b } = await pairUp();
    pair.webSocketMessage(typed(a), frame(MAX_TUNNEL_FRAME_BYTES + 1));
    const c = await connect();
    const d = await connect();
    expect(c.server.send.mock.calls).toEqual([[PAIRED_FRAME]]);
    expect(d.server.send.mock.calls).toEqual([[PAIRED_FRAME]]);
    expect((await connect()).response.status).toBe(409);
    // The old pair's echoes arrive late; they must not touch C or D.
    pair.webSocketClose(typed(a), 1009, "echo");
    pair.webSocketClose(typed(b), 1009, "echo");
    expect(c.server.close).not.toHaveBeenCalled();
    expect(d.server.close).not.toHaveBeenCalled();
    const data = frame(8);
    pair.webSocketMessage(typed(c.server), data);
    expect(d.server.send).toHaveBeenLastCalledWith(data);
  });

  it("matches partners only within the same pairing generation", async () => {
    const { pair, typed, pairUp } = setup();
    const { a, b } = await pairUp();
    // Simulate B carrying another generation (e.g. a stale pairing record).
    b.stored = { ...b.stored!, generation: "other-generation" };
    pair.webSocketMessage(typed(a), frame(4));
    expect(a.close).toHaveBeenCalledWith(1011, "partner gone");
    expect(b.send).toHaveBeenCalledTimes(1);
  });
});
