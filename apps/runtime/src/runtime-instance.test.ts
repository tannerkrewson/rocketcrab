import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeBootstrapMessage } from "@rocketcrab/protocol";
import { RuntimeInstance } from "./runtime-instance";
import {
  createFakeFrameFactory,
  createFakePort,
  receiveOnPort,
  type FakeFrameHost,
  type FakePort,
} from "./test/fakes";

function bootstrapMessage(overrides: Record<string, unknown> = {}): RuntimeBootstrapMessage {
  return {
    version: 1,
    runtimeInstanceId: "runtime-1",
    messageId: "message-1",
    sentAt: 1_700_000_000_000,
    type: "runtime.bootstrap",
    gameId: "game-1",
    gameMode: "state",
    gameSource: "<!doctype html><html><body><p>hi</p></body></html>",
    player: { memberId: "member-1", displayName: "Alex" },
    ...overrides,
  } as RuntimeBootstrapMessage;
}

function setup(
  overrides: {
    bootstrap?: RuntimeBootstrapMessage;
    registrationTimeoutMs?: number;
  } = {},
) {
  const port = createFakePort();
  const frameHost = createFakeFrameFactory();
  const instance = new RuntimeInstance({
    runtimeInstanceId: "runtime-1",
    bootstrap: overrides.bootstrap ?? bootstrapMessage(),
    port,
    frameFactory: frameHost.factory,
    registrationTimeoutMs: overrides.registrationTimeoutMs,
  });
  return { instance, port, frameHost };
}

function hook(): { report: (kind: unknown, payload: unknown) => void } {
  return (
    globalThis as unknown as {
      __novaRuntime: { report: (kind: unknown, payload: unknown) => void };
    }
  ).__novaRuntime;
}

function messageTypes(port: FakePort): string[] {
  return port.sent.map((m) => (m as { type: string }).type);
}

function findMessage<T extends { type: string }>(port: FakePort, type: string): T | undefined {
  return port.sent.find((m) => (m as { type: string }).type === type) as T | undefined;
}

function runtimeMessage(port: FakePort, type: string): Record<string, unknown> | undefined {
  const found = findMessage(port, type);
  return found as Record<string, unknown> | undefined;
}

function lastRuntimeMessage(port: FakePort, type: string): Record<string, unknown> | undefined {
  const found = [...port.sent].reverse().find((m) => (m as { type: string }).type === type);
  return found as Record<string, unknown> | undefined;
}

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { __novaRuntime?: unknown }).__novaRuntime;
});

describe("RuntimeInstance bootstrap", () => {
  it("sends ready, created, and loaded, and creates one injected frame", () => {
    const { instance, port, frameHost } = setup();
    expect(instance.hasFrame()).toBe(true);
    expect(messageTypes(port)).toEqual(["runtime.ready", "game.lifecycle", "game.lifecycle"]);
    expect(runtimeMessage(port, "runtime.ready")?.status).toBe("ready");
    expect(frameHost.frames).toHaveLength(1);
    const frame = frameHost.frames[0]!;
    expect(frame.source).toContain("<script>");
    expect(frame.source).toContain("defineGame");
    expect(frame.source).toContain("<!doctype html><html><body><p>hi</p></body></html>");
    expect(port.closed).toBe(false);
  });

  it("exposes the per-instance hook the injected bridge reports through", () => {
    setup();
    expect(hook().report).toBeTypeOf("function");
  });

  it("rejects an empty source with an empty_source error and no frame", () => {
    const { instance, port, frameHost } = setup({
      bootstrap: bootstrapMessage({ gameSource: "   " }),
    });
    expect(instance.hasFrame()).toBe(false);
    expect(frameHost.frames).toHaveLength(0);
    const error = runtimeMessage(port, "runtime.error");
    expect(error?.category).toBe("empty_source");
  });

  it("reports missing structure but still runs the fragment", () => {
    const { instance, port, frameHost } = setup({
      bootstrap: bootstrapMessage({ gameSource: "<canvas></canvas><script>1+1</script>" }),
    });
    expect(instance.hasFrame()).toBe(true);
    expect(frameHost.frames).toHaveLength(1);
    expect(runtimeMessage(port, "runtime.error")?.category).toBe("invalid_html");
  });

  it("delegates the bootstrap permissions into the frame's allow tokens", () => {
    const { frameHost } = setup({
      bootstrap: bootstrapMessage({
        permissions: { allow: ["camera", "extra-api"] },
      }),
    });
    expect(frameHost.frames[0]?.allowTokens).toContain("extra-api");
  });
});

describe("RuntimeInstance heartbeat and lifecycle", () => {
  it("replies to a ping with a pong", () => {
    const { port } = setup();
    receiveOnPort(port, {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-2",
      sentAt: 1_700_000_000_001,
      type: "runtime.ping",
    });
    expect(messageTypes(port).filter((t) => t === "runtime.pong")).toHaveLength(1);
  });

  it("reloads into a clean frame and re-arms registration", () => {
    const { instance, port, frameHost } = setup();
    instance.outgoingMessages(); // sanity: log is readable
    receiveOnPort(port, {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-2",
      sentAt: 1_700_000_000_001,
      type: "runtime.reload",
    });
    expect(frameHost.frames).toHaveLength(2);
    expect(frameHost.frames[0]?.destroyed).toBe(true);
    expect(frameHost.frames[1]?.destroyed).toBe(false);
    // created, loaded, reloaded
    expect(messageTypes(port).filter((t) => t === "game.lifecycle").length).toBe(3);
    const reloaded = port.sent
      .filter((m) => (m as { type: string }).type === "game.lifecycle")
      .map((m) => (m as { event: string }).event);
    expect(reloaded).toContain("reloaded");
  });

  it("destroy removes the frame, deletes the hook, closes the port, and emits destroyed", () => {
    const { instance, port, frameHost } = setup();
    receiveOnPort(port, {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-2",
      sentAt: 1_700_000_000_001,
      type: "game.end",
      reason: "user_exit",
    });
    expect(frameHost.frames[0]?.destroyed).toBe(true);
    expect(port.closed).toBe(true);
    expect((globalThis as { __novaRuntime?: unknown }).__novaRuntime).toBeUndefined();
    const destroyed = lastRuntimeMessage(port, "game.lifecycle");
    expect(destroyed?.event).toBe("destroyed");
    expect(destroyed?.detail).toBe("user_exit");
  });

  it("ignores channel messages after destroy", () => {
    const { port } = setup();
    receiveOnPort(port, {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-2",
      sentAt: 1_700_000_000_001,
      type: "game.end",
      reason: "user_exit",
    });
    const pongs = messageTypes(port).filter((t) => t === "runtime.pong").length;
    receiveOnPort(port, {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-3",
      sentAt: 1_700_000_000_002,
      type: "runtime.ping",
    });
    expect(messageTypes(port).filter((t) => t === "runtime.pong")).toHaveLength(pongs);
  });

  it("reports page-visibility transitions as pause diagnostics", () => {
    const { instance, port } = setup();
    instance.pageVisibilityChanged(true);
    instance.pageVisibilityChanged(false);
    const events = port.sent
      .filter((m) => (m as { type: string }).type === "game.lifecycle")
      .map((m) => (m as { event: string }).event);
    expect(events).toContain("paused");
    expect(events).toContain("resumed");
  });
});

describe("RuntimeInstance registration", () => {
  it("forwards a schema-valid defineGame declaration as game.registration", () => {
    const { port } = setup();
    hook().report("defineGame", {
      options: { title: "Card Game", gameMode: "state", gameVersion: "1.2.0" },
    });
    const registration = runtimeMessage(port, "game.registration");
    expect(registration?.gameId).toBe("game-1");
    expect(registration?.title).toBe("Card Game");
    expect(registration?.gameMode).toBe("state");
    expect(registration?.gameVersion).toBe("1.2.0");
    const events = port.sent
      .filter((m) => (m as { type: string }).type === "game.lifecycle")
      .map((m) => (m as { event: string }).event);
    expect(events).toContain("started");
  });

  it("falls back to the host-declared title and mode", () => {
    const { port } = setup({
      bootstrap: bootstrapMessage({ gameTitle: "Host Title", gameMode: "simulation" }),
    });
    hook().report("defineGame", { options: {} });
    const registration = runtimeMessage(port, "game.registration");
    expect(registration?.title).toBe("Host Title");
    expect(registration?.gameMode).toBe("simulation");
  });

  it("uses a safe default title when neither side supplied one", () => {
    const { port } = setup();
    hook().report("defineGame", { options: {} });
    const registration = runtimeMessage(port, "game.registration");
    expect(registration?.title).toBe("Untitled game");
  });

  it("rejects untrusted metadata instead of forwarding it", () => {
    const { port } = setup();
    hook().report("defineGame", {
      options: { title: "x".repeat(200), gameMode: "state" },
    });
    expect(runtimeMessage(port, "game.registration")).toBeUndefined();
    const errors = port.sent.filter((m) => (m as { type: string }).type === "runtime.error");
    expect(errors.length).toBeGreaterThan(0);
    expect((errors[0] as { message: string }).message).toContain("failed validation");
  });

  it("ignores a second defineGame call", () => {
    const { port } = setup();
    hook().report("defineGame", { options: { title: "First" } });
    hook().report("defineGame", { options: { title: "Second" } });
    const registrations = port.sent.filter(
      (m) => (m as { type: string }).type === "game.registration",
    );
    expect(registrations).toHaveLength(1);
  });

  it("reports missing registration after the timeout", () => {
    vi.useFakeTimers();
    const { port } = setup({ registrationTimeoutMs: 10_000 });
    vi.advanceTimersByTime(10_001);
    expect(runtimeMessage(port, "runtime.error")?.category).toBe("missing_registration");
  });

  it("does not report missing registration once the game declared itself", () => {
    vi.useFakeTimers();
    const { port } = setup({ registrationTimeoutMs: 10_000 });
    hook().report("defineGame", { options: { title: "Timely" } });
    vi.advanceTimersByTime(10_001);
    expect(runtimeMessage(port, "runtime.error")?.category).not.toBe("missing_registration");
  });
});

describe("RuntimeInstance error forwarding", () => {
  it("forwards script errors with the runtime category", () => {
    const { port } = setup();
    hook().report("error", { message: "boom", filename: "game.html", lineno: 3 });
    const error = runtimeMessage(port, "runtime.error");
    expect(error?.category).toBe("runtime");
    expect(error?.message).toBe("boom");
    expect((error?.details as Record<string, unknown>).filename).toBe("game.html");
  });

  it("classifies SyntaxError as syntax", () => {
    const { port } = setup();
    hook().report("error", { message: "SyntaxError: Unexpected token ')'" });
    expect(runtimeMessage(port, "runtime.error")?.category).toBe("syntax");
  });

  it("classifies resource load failures as remote_load", () => {
    const { port } = setup();
    hook().report("error", { message: "Failed to load resource", tag: "IMG" });
    const error = runtimeMessage(port, "runtime.error");
    expect(error?.category).toBe("remote_load");
    expect((error?.details as Record<string, unknown>).resource).toBe("IMG");
  });

  it("forwards unhandled rejections", () => {
    const { port } = setup();
    hook().report("unhandledrejection", { message: "nope" });
    expect(runtimeMessage(port, "runtime.error")?.message).toBe("Unhandled rejection: nope");
  });
});

describe("RuntimeInstance console capture and rate limits", () => {
  it("forwards console entries as validated runtime.console messages", () => {
    const { port } = setup();
    hook().report("console", { level: "warn", args: ["flaky", { code: 42 }] });
    const entry = runtimeMessage(port, "runtime.console");
    expect(entry?.level).toBe("warn");
    expect(entry?.message).toBe("flaky");
    expect(entry?.details).toBe('{"code":42}');
  });

  it("ignores junk console payloads", () => {
    const { port } = setup();
    hook().report("console", { level: "trace", args: [] });
    hook().report("console", { level: "log" });
    hook().report("console", { level: "log", args: "not-an-array" });
    expect(runtimeMessage(port, "runtime.console")).toBeUndefined();
  });

  it("drops over-limit console entries and reports the drop count", () => {
    vi.useFakeTimers();
    const { port } = setup();
    for (let i = 0; i < 51; i += 1) {
      hook().report("console", { level: "log", args: [`entry-${i}`] });
    }
    const forwarded = port.sent.filter((m) => (m as { type: string }).type === "runtime.console");
    expect(forwarded).toHaveLength(50);
    vi.advanceTimersByTime(1000);
    hook().report("console", { level: "log", args: ["after refill"] });
    const last = port.sent
      .filter((m) => (m as { type: string }).type === "runtime.console")
      .at(-1) as Record<string, unknown>;
    expect(last.dropped).toBe(1);
  });

  it("rate-limits error reports as well", () => {
    vi.useFakeTimers();
    const { port } = setup();
    for (let i = 0; i < 6; i += 1) {
      hook().report("error", { message: `err-${i}` });
    }
    const errors = port.sent.filter((m) => (m as { type: string }).type === "runtime.error");
    expect(errors).toHaveLength(5);
    vi.advanceTimersByTime(1000);
    hook().report("error", { message: "after refill" });
    const last = port.sent
      .filter((m) => (m as { type: string }).type === "runtime.error")
      .at(-1) as { details: Record<string, unknown> };
    expect(last.details.dropped).toBe(1);
  });

  it("bounds the outgoing message log", () => {
    vi.useFakeTimers();
    const { instance, port } = setup();
    for (let second = 0; second < 10; second += 1) {
      for (let i = 0; i < 51; i += 1) {
        hook().report("console", { level: "log", args: [`e-${second}-${i}`] });
      }
      vi.advanceTimersByTime(1000);
    }
    expect(port.sent.length).toBeGreaterThan(500);
    expect(instance.outgoingMessages().length).toBeLessThanOrEqual(500);
  });
});

describe("RuntimeInstance protocol boundary", () => {
  it("rejects malformed channel messages with a security error", () => {
    const { port } = setup();
    receiveOnPort(port, { garbage: true });
    expect(runtimeMessage(port, "runtime.error")?.category).toBe("security");
  });

  it("rejects unknown message types with a useful error", () => {
    const { port } = setup();
    receiveOnPort(port, {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-2",
      sentAt: 1_700_000_000_001,
      type: "runtime.teleport",
    });
    const error = runtimeMessage(port, "runtime.error");
    expect(error?.category).toBe("security");
    expect(String(error?.message)).toContain("runtime.teleport");
  });

  it("ignores unknown report kinds from the game", () => {
    const { port } = setup();
    hook().report("teleport", { payload: "junk" });
    expect(port.sent.filter((m) => (m as { type: string }).type === "runtime.error")).toHaveLength(
      0,
    );
  });

  it("validates and surfaces forwarded Nova API calls as unsupported (S1)", () => {
    // Error reports are rate-limited (F6: 5/s); refill the bucket between
    // batches with fake timers so all six methods are exercised.
    vi.useFakeTimers();
    const { port } = setup();
    hook().report("ready", {});
    hook().report("dispatch", { action: { type: "playCard", payload: { c: 1 } } });
    hook().report("raw.createChannel", { spec: { name: "chat" } });
    hook().report("raw.send", { name: "chat", payload: "hi" });
    hook().report("simulation.register", {});
    vi.advanceTimersByTime(1100);
    hook().report("simulation.sendInput", { input: { type: "move" } });
    const unsupported = port.sent.filter(
      (m) =>
        (m as { type: string }).type === "runtime.error" &&
        (m as { category?: string }).category === "unsupported",
    );
    expect(unsupported).toHaveLength(6);
    const messages = unsupported.map((m) => String((m as { message?: string }).message)).join("\n");
    expect(messages).toContain("nova.ready() is not available");
    expect(messages).toContain("nova.dispatch() is not available");
    expect(messages).toContain("nova.raw.createChannel() is not available");
    expect(messages).toContain("nova.simulation.sendInput() is not available");
  });

  it("rejects malformed forwarded Nova API calls without forwarding them", () => {
    const { port } = setup();
    hook().report("dispatch", { action: { type: "" } });
    hook().report("raw.send", { name: "chat" });
    const errors = port.sent.filter(
      (m) => (m as { type: string }).type === "runtime.error",
    ) as Array<{ category?: string; message?: string }>;
    expect(errors).toHaveLength(2);
    expect(errors[0]?.category).toBe("runtime");
    expect(String(errors[0]?.message)).toContain("nova.dispatch() call failed validation");
    expect(String(errors[1]?.message)).toContain("nova.raw.send() call failed validation");
  });

  it("rejects defineGame declarations targeting unknown API versions", () => {
    const { port } = setup();
    hook().report("defineGame", { options: { title: "Future", apiVersion: 99 } });
    const error = lastRuntimeMessage(port, "runtime.error");
    expect(error?.category).toBe("unsupported");
    expect(String(error?.message)).toContain("API version 99");
    expect(messageTypes(port)).not.toContain("game.registration");
  });
});
