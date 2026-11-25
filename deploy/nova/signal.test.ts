import { describe, expect, it, vi } from "vitest";
import { SignalHub } from "./signal";
import edge, { type EdgeEnv } from "./worker";

function setup() {
  const sockets: Array<{
    readyState: number;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    serializeAttachment(value: { topics: string[]; tokens: number; lastRefillMs: number }): void;
    deserializeAttachment(): { topics: string[]; tokens: number; lastRefillMs: number };
  }> = [];
  function socket() {
    let attachment = { topics: [] as string[], tokens: 400, lastRefillMs: Date.now() };
    const ws = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(() => {
        ws.readyState = 3;
      }),
      serializeAttachment: (value: typeof attachment) => {
        attachment = structuredClone(value);
      },
      deserializeAttachment: () => structuredClone(attachment),
    };
    sockets.push(ws);
    return ws;
  }
  const setAlarm = vi.fn();
  const state = { acceptWebSocket: vi.fn(), getWebSockets: () => sockets, storage: { setAlarm } };
  const hub = () => new SignalHub(state as unknown as ConstructorParameters<typeof SignalHub>[0]);
  const message = (h: SignalHub, s: ReturnType<typeof socket>, value: unknown) =>
    h.webSocketMessage(
      s as unknown as Parameters<SignalHub["webSocketMessage"]>[0],
      typeof value === "string" ? value : JSON.stringify(value),
    );
  return { socket, hub, message, setAlarm };
}

describe("SignalHub", () => {
  it("fans out to subscribers including publisher and survives hibernation", () => {
    const { socket, hub, message } = setup();
    const a = socket(),
      b = socket(),
      c = socket();
    const first = hub();
    message(first, a, { type: "subscribe", topic: "room" });
    message(first, b, { type: "subscribe", topic: "room" });
    const woke = hub();
    message(woke, a, { type: "publish", topic: "room", payload: { hello: 1 } });
    expect(a.send).toHaveBeenCalledWith('{"topic":"room","payload":{"hello":1}}');
    expect(b.send).toHaveBeenCalledTimes(1);
    expect(c.send).not.toHaveBeenCalled();
    message(woke, b, { type: "unsubscribe", topic: "room" });
    message(woke, a, { type: "publish", topic: "room", payload: "again" });
    expect(b.send).toHaveBeenCalledTimes(1);
  });

  it("closes idle sockets after wake and reschedules for active sockets", async () => {
    const { socket, hub, message, setAlarm } = setup();
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const idle = socket();
      const active = socket();
      const first = hub();
      clock.mockReturnValue(2_000);
      message(first, active, { type: "subscribe", topic: "room" });
      clock.mockReturnValue(601_000);
      await hub().alarm();
      expect(idle.close).toHaveBeenCalledWith(1008, "signaling idle");
      expect(active.close).not.toHaveBeenCalled();
      expect(setAlarm).toHaveBeenCalledWith(602_000);
    } finally {
      clock.mockRestore();
    }
  });

  it("does not send reserved abnormal close codes", () => {
    const { socket, hub } = setup();
    const ws = socket();
    const h = hub();
    const typed = ws as unknown as Parameters<SignalHub["webSocketClose"]>[0];
    for (const code of [1005, 1006, 1015]) h.webSocketClose(typed, code, "");
    expect(ws.close).not.toHaveBeenCalled();
    h.webSocketClose(typed, 1000, "done");
    expect(ws.close).toHaveBeenCalledWith(1000, "done");
  });

  it("enforces topic, message, frame, subscription and token limits", () => {
    const { socket, hub, message } = setup();
    const invalid = socket();
    message(hub(), invalid, { type: "subscribe", topic: "bad!" });
    expect(invalid.close).toHaveBeenCalledWith(1008, "invalid topic");
    const malformed = socket();
    message(hub(), malformed, "{");
    expect(malformed.close).toHaveBeenCalledWith(1008, "invalid message");
    const big = socket();
    message(hub(), big, "x".repeat(65_537));
    expect(big.close).toHaveBeenCalledWith(1009, "message too big");
    const limited = socket();
    const h = hub();
    const time = Date.now();
    const clock = vi.spyOn(Date, "now");
    for (let i = 0; i < 129; i++) {
      clock.mockReturnValue(time + i * 50);
      message(h, limited, { type: "subscribe", topic: `t${i}` });
    }
    expect(limited.close).toHaveBeenCalledWith(1008, "subscription limit exceeded");
    clock.mockReturnValue(1_000);
    try {
      const rate = socket();
      const rateHub = hub();
      for (let i = 0; i < 101; i++) message(rateHub, rate, { type: "unsubscribe", topic: "x" });
      expect(rate.close).toHaveBeenCalledWith(1008, "rate limit exceeded");
    } finally {
      clock.mockRestore();
    }
  });
});

describe("signal routing", () => {
  it("validates origin, method, upgrade, key, rate and forwards to per-room object", async () => {
    const key = "a".repeat(32);
    const idFromName = vi.fn((name: string) => name);
    const fetch = vi.fn(async () => new Response("forwarded"));
    const limit = vi.fn(async () => ({ success: true }));
    const env: EdgeEnv = {
      SIGNAL_HUB: { idFromName, get: () => ({ fetch }) },
      BULK_RATE_LIMITER: { limit },
    };
    const call = (path: string, init: RequestInit = {}) =>
      edge.fetch(new Request(`https://app.example${path}`, init), env);
    const headers = {
      Origin: "https://app.example",
      Upgrade: "websocket",
      "CF-Connecting-IP": "1.2.3.4",
    };
    expect((await call(`/api/signal/${key}`, { headers: { Upgrade: "websocket" } })).status).toBe(
      403,
    );
    expect((await call(`/api/signal/${key}`, { method: "POST", headers })).status).toBe(405);
    expect((await call(`/api/signal/${key}`, { headers: { Origin: headers.Origin } })).status).toBe(
      426,
    );
    expect((await call("/api/signal/not-valid", { headers })).status).toBe(404);
    expect(await (await call(`/api/signal/${key}`, { headers })).text()).toBe("forwarded");
    expect(idFromName).toHaveBeenCalledWith(key);
    expect(limit).toHaveBeenCalledWith({ key: "signal:1.2.3.4" });
    limit.mockResolvedValueOnce({ success: false });
    expect((await call(`/api/signal/${key}`, { headers })).status).toBe(429);
  });
});
