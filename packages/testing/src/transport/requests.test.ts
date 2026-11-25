import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryTransportHub } from "./hub";
const hubs: InMemoryTransportHub[] = [];
afterEach(() => {
  for (const hub of hubs.splice(0)) hub.dispose();
  vi.useRealTimers();
});
async function pair() {
  const hub = new InMemoryTransportHub();
  hubs.push(hub);
  const a = hub.createTransport({ memberId: "a" });
  const b = hub.createTransport({ memberId: "b" });
  await a.join({ room: "room", sessionId: "session" });
  await b.join({ room: "room", sessionId: "session" });
  return {
    hub,
    a,
    b,
    options: { channel: "source", payload: {}, targetConnectionId: b.selfConnectionId },
  };
}
describe("in-memory request lifecycle (Trystero counterpart)", () => {
  it("times out without retrying when the handler stalls", async () => {
    const { a, b, options } = await pair();
    const handler = vi.fn(() => new Promise<never>(() => undefined));
    b.handleRequest("source", handler);
    await expect(a.request({ ...options, timeoutMs: 20 })).rejects.toThrow("timed out");
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it("aborts an in-flight request and allows the same peer/channel again", async () => {
    const { a, b, options } = await pair();
    const unregister = b.handleRequest("source", () => new Promise<never>(() => undefined));
    const controller = new AbortController();
    const pending = a.request({ ...options, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
    unregister();
    b.handleRequest("source", () => new Uint8Array([1]));
    await expect(a.request(options)).resolves.toEqual(new Uint8Array([1]));
  });
  it("rejects duplicate requests to the same peer/channel", async () => {
    const { a, b, options } = await pair();
    b.handleRequest("source", () => new Promise<never>(() => undefined));
    const controller = new AbortController();
    const pending = a.request({ ...options, signal: controller.signal });
    await expect(a.request(options)).rejects.toThrow("already active");
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
  it("rejects a disconnected request and aborts its remote handler signal", async () => {
    const { hub, a, b, options } = await pair();
    let signal: AbortSignal | undefined;
    b.handleRequest("source", (_data, context) => {
      signal = context.signal;
      return new Promise<never>(() => undefined);
    });
    const pending = a.request(options);
    hub.drain();
    await Promise.resolve();
    const rejection = expect(pending).rejects.toThrow("disconnected");
    await a.leave();
    await rejection;
    expect(signal?.aborted).toBe(true);
  });
  it("rejects oversized requests before invoking the handler", async () => {
    const { a, b, options } = await pair();
    const handler = vi.fn(() => "okay");
    b.handleRequest("source", handler);
    await expect(a.request({ ...options, payload: "x".repeat(16_385) })).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
  it("clears pending request timers when the hub is disposed", async () => {
    const { hub, a, b, options } = await pair();
    b.handleRequest("source", () => new Promise<never>(() => undefined));
    const pending = a.request(options);
    const rejection = expect(pending).rejects.toThrow();
    hub.dispose();
    await rejection;
  });
});
