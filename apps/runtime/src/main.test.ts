/**
 * Bootstrap handshake tests: dispatch real MessageEvents on the jsdom window
 * (the same path a host page on the main origin would use) and drive the
 * runtime through the fake port the bootstrap transfers.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeBootstrapMessage } from "@rocketcrab/protocol";
import { MAIN_ORIGIN_PORT, RUNTIME_ORIGIN_PORT } from "./origins";
import { createFakePort, receiveOnPort, type FakePort } from "./test/fakes";

// The runtime page's required elements must exist before main.ts runs.
document.body.innerHTML = '<div id="game-container"></div>';
await import("./main");

const MAIN_ORIGIN = `http://localhost:${MAIN_ORIGIN_PORT}`;
const RUNTIME_ORIGIN = `http://localhost:${RUNTIME_ORIGIN_PORT}`;

interface RuntimeTestApi {
  getGameWindow: () => Window | null;
  hasFrame: () => boolean;
  activeInstanceCount: () => number;
  outgoingMessages: () => readonly Record<string, unknown>[];
  mainOrigin: string;
}

function api(): RuntimeTestApi {
  return (window as unknown as { __runtimeApi: RuntimeTestApi }).__runtimeApi;
}

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

function dispatchBootstrap(origin: string, data: unknown, ports: unknown[] = []): void {
  window.dispatchEvent(
    new MessageEvent("message", { origin, data, ports: ports as MessagePort[] }),
  );
}

function bootstrap(origin: string = MAIN_ORIGIN): FakePort {
  const port = createFakePort();
  dispatchBootstrap(origin, bootstrapMessage(), [port]);
  return port;
}

afterEach(() => {
  // Tear down whatever instance a test left running so tests stay isolated.
  const port = createFakePort();
  // A bootstrap with a fresh port replaces (and destroys) any active instance.
  dispatchBootstrap(MAIN_ORIGIN, bootstrapMessage({ runtimeInstanceId: "teardown" }), [port]);
  receiveOnPort(port, {
    version: 1,
    runtimeInstanceId: "teardown",
    messageId: "message-9",
    sentAt: 1_700_000_000_009,
    type: "game.end",
    reason: "host_closed",
  });
});

describe("exact-origin bootstrap handshake", () => {
  it("derives the main origin from the runtime location", () => {
    expect(api().mainOrigin).toBe(MAIN_ORIGIN);
  });

  it("rejects a bootstrap from the runtime origin itself", () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
    try {
      dispatchBootstrap(RUNTIME_ORIGIN, bootstrapMessage(), [createFakePort()]);
    } finally {
      console.warn = originalWarn;
    }
    expect(api().activeInstanceCount()).toBe(0);
    expect(warnings.some((w) => w.includes("rejected bootstrap from origin"))).toBe(true);
  });

  it("rejects a bootstrap from an unrelated origin", () => {
    dispatchBootstrap("https://evil.example", bootstrapMessage(), [createFakePort()]);
    expect(api().activeInstanceCount()).toBe(0);
  });

  it("rejects malformed bootstrap messages", () => {
    dispatchBootstrap(MAIN_ORIGIN, { hello: "world" }, [createFakePort()]);
    dispatchBootstrap(MAIN_ORIGIN, bootstrapMessage({ type: "runtime.ping" }), [createFakePort()]);
    expect(api().activeInstanceCount()).toBe(0);
  });

  it("rejects a bootstrap without a MessagePort", () => {
    dispatchBootstrap(MAIN_ORIGIN, bootstrapMessage());
    expect(api().activeInstanceCount()).toBe(0);
  });

  it("bootstraps a runtime instance and creates the game frame", () => {
    bootstrap();
    expect(api().activeInstanceCount()).toBe(1);
    expect(api().hasFrame()).toBe(true);
    const types = api()
      .outgoingMessages()
      .map((m) => m.type);
    expect(types).toContain("runtime.ready");
    expect(types).toContain("game.lifecycle");
  });

  it("answers heartbeats over the transferred channel", () => {
    const port = bootstrap();
    const pongsBefore = api()
      .outgoingMessages()
      .filter((m) => m.type === "runtime.pong").length;
    receiveOnPort(port, {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-2",
      sentAt: 1_700_000_000_001,
      type: "runtime.ping",
    });
    const pongsAfter = api()
      .outgoingMessages()
      .filter((m) => m.type === "runtime.pong").length;
    expect(pongsAfter).toBe(pongsBefore + 1);
  });

  it("replaces the previous instance (and its channel) on a fresh bootstrap", () => {
    const first = bootstrap();
    expect(api().activeInstanceCount()).toBe(1);
    const second = createFakePort();
    dispatchBootstrap(MAIN_ORIGIN, bootstrapMessage({ runtimeInstanceId: "runtime-2" }), [second]);
    expect(first.closed).toBe(true);
    expect(api().activeInstanceCount()).toBe(1);
  });

  it("destroys the instance on game.end and closes the channel", () => {
    const port = bootstrap();
    receiveOnPort(port, {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-2",
      sentAt: 1_700_000_000_001,
      type: "game.end",
      reason: "user_exit",
    });
    expect(port.closed).toBe(true);
    expect(api().activeInstanceCount()).toBe(0);
    expect(api().hasFrame()).toBe(false);
  });
});
