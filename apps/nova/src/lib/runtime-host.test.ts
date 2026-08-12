import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeHostClient, type ChannelPort, type RuntimeHostEvent } from "./runtime-host";

interface FakePort extends ChannelPort {
  sent: unknown[];
  closed: boolean;
}

function createFakePort(): FakePort {
  const port: FakePort = {
    sent: [],
    closed: false,
    onmessage: null,
    onmessageerror: null,
    postMessage(message: unknown): void {
      port.sent.push(message);
    },
    close(): void {
      port.closed = true;
    },
  };
  return port;
}

interface HostHarness {
  bridge: RuntimeHostClient;
  port1: FakePort;
  port2: FakePort;
  events: RuntimeHostEvent[];
  frames: HTMLIFrameElement[];
  windowMessages: Array<{ data: unknown; origin: string }>;
}

function createHarness(
  overrides: Partial<ConstructorParameters<typeof RuntimeHostClient>[0]> = {},
): HostHarness {
  const port1 = createFakePort();
  const port2 = createFakePort();
  const events: RuntimeHostEvent[] = [];
  const frames: HTMLIFrameElement[] = [];
  const windowMessages: HostHarness["windowMessages"] = [];
  const bridge = new RuntimeHostClient({
    runtimeOrigin: "http://localhost:5174",
    container: document.body,
    onEvent: (event) => events.push(event),
    waitForFrameLoad: async (iframe) => {
      frames.push(iframe);
      iframe.contentWindow?.addEventListener("message", (event: MessageEvent) => {
        windowMessages.push({ data: event.data, origin: event.origin });
      });
    },
    createChannel: () => ({ port1, port2 }),
    ...overrides,
  });
  return { bridge, port1, port2, events, frames, windowMessages };
}

const loadGame = {
  gameId: "game-1",
  gameMode: "state" as const,
  gameSource: "<!doctype html><html><body>hi</body></html>",
  player: { memberId: "member-1", displayName: "Alex" },
  gameTitle: "Hello Game",
  sessionId: "session-1",
};

function readyMessage(): Record<string, unknown> {
  return {
    version: 1,
    runtimeInstanceId: "runtime-1",
    messageId: "message-1",
    sentAt: 1_700_000_000_000,
    type: "runtime.ready",
    status: "ready",
  };
}

function deliver(port: FakePort, message: unknown): void {
  port.onmessage?.({ data: message } as MessageEvent);
}

/** Let an async load() reach its postMessage after the first await. */
async function flush(): Promise<void> {
  // jsdom dispatches cross-window postMessage on a macrotask.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("RuntimeHostClient bootstrap", () => {
  it("embeds the runtime iframe and transfers a dedicated channel", async () => {
    const { bridge, port1, port2, events, frames, windowMessages } = createHarness();
    const loadPromise = bridge.load(loadGame);
    await flush();
    expect(frames).toHaveLength(1);
    expect(frames[0]?.getAttribute("sandbox")).toContain("allow-scripts");
    await vi.waitFor(() => expect(windowMessages).toHaveLength(1));
    const bootstrap = windowMessages[0]?.data as Record<string, unknown>;
    expect(bootstrap.type).toBe("runtime.bootstrap");
    expect(bootstrap.gameId).toBe("game-1");
    expect(bootstrap.gameMode).toBe("state");
    expect(port2.sent).toHaveLength(0); // port2 went to the runtime

    deliver(port1, readyMessage());
    await loadPromise;
    expect(bridge.diagnose().ready).toBe(true);
    expect(events.map((e) => e.type)).toContain("ready");
  });

  it("rejects when the runtime never reports ready", async () => {
    const { bridge } = createHarness({ bootstrapTimeoutMs: 50 });
    const loadPromise = bridge.load(loadGame);
    await expect(loadPromise).rejects.toThrow(/bootstrap timed out/);
  });

  it("replaces the previous channel on a fresh bootstrap", async () => {
    const { bridge, port1, windowMessages } = createHarness();
    const first = bridge.load(loadGame);
    await flush();
    deliver(port1, readyMessage());
    await first;
    expect(port1.closed).toBe(false);

    const second = bridge.load({ ...loadGame, gameId: "game-2" });
    await flush();
    expect(port1.closed).toBe(true); // old channel closed
    await vi.waitFor(() => expect(windowMessages).toHaveLength(2));
    const bootstrap = windowMessages.at(-1)?.data as Record<string, unknown>;
    expect(bootstrap.gameId).toBe("game-2");
    deliver(port1, readyMessage());
    await second;
    expect(bridge.diagnose().ready).toBe(true);
  });
});

describe("RuntimeHostClient event forwarding", () => {
  async function started(harness: HostHarness): Promise<void> {
    const { bridge, port1 } = harness;
    const loadPromise = bridge.load(loadGame);
    deliver(port1, readyMessage());
    await loadPromise;
  }

  it("forwards registration, error, console, and lifecycle events", async () => {
    const harness = createHarness();
    await started(harness);
    const { bridge, port1, events } = harness;
    deliver(port1, {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-2",
      sentAt: 1_700_000_000_001,
      type: "game.registration",
      gameId: "game-1",
      title: "Hello Game",
      gameMode: "state",
      gameVersion: "1.0.0",
    });
    deliver(port1, {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-3",
      sentAt: 1_700_000_000_002,
      type: "runtime.error",
      category: "syntax",
      message: "Unexpected token",
    });
    deliver(port1, {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-4",
      sentAt: 1_700_000_000_003,
      type: "runtime.console",
      level: "warn",
      message: "flaky",
    });
    deliver(port1, {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-5",
      sentAt: 1_700_000_000_004,
      type: "game.lifecycle",
      event: "loaded",
    });
    const types = events.map((e) => e.type);
    expect(types).toContain("registration");
    expect(types).toContain("error");
    expect(types).toContain("console");
    expect(types).toContain("lifecycle");
    expect(bridge.diagnose().recentEvents).toHaveLength(5); // ready + 4 events
  });

  it("forwards game.apiCall to the session router with the payload intact", async () => {
    const harness = createHarness();
    await started(harness);
    deliver(harness.port1, {
      version: 1,
      runtimeInstanceId: "runtime-1",
      sessionId: "session-1",
      messageId: "message-call",
      sentAt: 1_700_000_000_005,
      type: "game.apiCall",
      method: "dispatch",
      payload: { action: { type: "playCard", payload: { c: 1 } } },
    });
    const call = harness.events.find((e) => e.type === "apiCall");
    expect(call?.type).toBe("apiCall");
    if (call?.type === "apiCall") {
      expect(call.message.method).toBe("dispatch");
      expect(call.message.payload).toEqual({ action: { type: "playCard", payload: { c: 1 } } });
    }
  });

  it("pushApiEvent posts a validated game.apiEvent on the instance channel", async () => {
    const harness = createHarness();
    await started(harness);
    // Let the bootstrap postMessage reach the fake frame window.
    await flush();
    // The client generates its own runtime instance id for the bootstrap;
    // the pushed event must ride the same instance.
    const bootstrap = harness.windowMessages
      .map((m) => m.data as Record<string, unknown>)
      .find((m) => m.type === "runtime.bootstrap");
    const runtimeInstanceId = bootstrap?.runtimeInstanceId as string;
    harness.bridge.pushApiEvent({
      kind: "playerJoined",
      player: { id: "member-2", name: "Blair" },
    });
    const message = harness.port1.sent.at(-1) as Record<string, unknown>;
    expect(message.type).toBe("game.apiEvent");
    expect(message.runtimeInstanceId).toBe(runtimeInstanceId);
    expect(message.sessionId).toBe("session-1");
    expect(message.event).toEqual({
      kind: "playerJoined",
      player: { id: "member-2", name: "Blair" },
    });
    // Raw channel messages with binary payloads survive the envelope.
    harness.bridge.pushApiEvent({
      kind: "rawMessage",
      channel: "chat",
      message: {
        from: { id: "member-2", name: "Blair" },
        payload: new Uint8Array([1, 2]),
        binary: true,
      },
    });
    const raw = harness.port1.sent.at(-1) as {
      event: { message: { payload: Uint8Array } };
    };
    expect(raw.event.message.payload).toBeInstanceOf(Uint8Array);
    // No-op before a load: no port exists yet.
    const idle = createHarness();
    idle.bridge.pushApiEvent({ kind: "start" });
    expect(idle.port1.sent).toHaveLength(0);
  });

  it("rejects invalid apiEvent shapes before posting them", async () => {
    const harness = createHarness();
    await started(harness);
    expect(() =>
      harness.bridge.pushApiEvent({ kind: "connection", status: "flaky" } as never),
    ).toThrow();
    expect((harness.port1.sent.at(-1) as { type?: string } | undefined)?.type).not.toBe(
      "game.apiEvent",
    );
  });

  it("emits fatal for invalid inbound messages", async () => {
    const harness = createHarness();
    await started(harness);
    deliver(harness.port1, { garbage: true });
    expect(harness.events.at(-1)?.type).toBe("fatal");
  });
});

describe("RuntimeHostClient heartbeat", () => {
  it("pings and reports unresponsive after missed pongs, then responsive", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const { bridge, port1, events } = harness;
    const loadPromise = bridge.load(loadGame);
    deliver(port1, readyMessage());
    await loadPromise;

    vi.advanceTimersByTime(1000);
    expect((port1.sent.at(-1) as { type: string }).type).toBe("runtime.ping");

    deliver(port1, {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-pong",
      sentAt: 1_700_000_000_010,
      type: "runtime.pong",
    });
    vi.advanceTimersByTime(1000);
    expect((port1.sent.at(-1) as { type: string }).type).toBe("runtime.ping");
    // One missed pong so far; two more without replies -> unresponsive.
    vi.advanceTimersByTime(2000);
    expect(events.map((e) => e.type)).toContain("unresponsive");

    deliver(port1, {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-pong-2",
      sentAt: 1_700_000_000_020,
      type: "runtime.pong",
    });
    expect(events.map((e) => e.type)).toContain("responsive");
  });

  it("pauses while the page is hidden and re-syncs with an immediate ping on return (M1)", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const { bridge, port1 } = harness;
    const loadPromise = bridge.load(loadGame);
    deliver(port1, readyMessage());
    await loadPromise;

    // Hidden: the heartbeat stops (no new pings while backgrounded).
    bridge.setPageVisibility(true);
    const pingsBefore = port1.sent.filter(
      (m) => (m as { type: string }).type === "runtime.ping",
    ).length;
    vi.advanceTimersByTime(10_000);
    const pingsAfter = port1.sent.filter(
      (m) => (m as { type: string }).type === "runtime.ping",
    ).length;
    expect(pingsAfter).toBe(pingsBefore);

    // Return: an immediate ping re-syncs, then the interval resumes.
    bridge.setPageVisibility(false);
    const last = port1.sent.at(-1) as { type: string };
    expect(last.type).toBe("runtime.ping");
    deliver(port1, {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-pong-resume",
      sentAt: 1_700_000_000_030,
      type: "runtime.pong",
    });
    vi.advanceTimersByTime(1000);
    expect((port1.sent.at(-1) as { type: string }).type).toBe("runtime.ping");
  });
});

describe("RuntimeHostClient parent controls", () => {
  async function started(harness: HostHarness): Promise<void> {
    const { bridge, port1 } = harness;
    const loadPromise = bridge.load(loadGame);
    deliver(port1, readyMessage());
    await loadPromise;
  }

  it("reload sends runtime.reload", async () => {
    const harness = createHarness();
    await started(harness);
    harness.bridge.reload();
    expect((harness.port1.sent.at(-1) as { type: string }).type).toBe("runtime.reload");
  });

  it("destroy sends game.end, removes the frame, and closes the port", async () => {
    const harness = createHarness();
    await started(harness);
    harness.bridge.destroy("user_exit");
    expect((harness.port1.sent.at(-1) as { type: string }).type).toBe("game.end");
    expect(harness.port1.closed).toBe(true);
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
    expect(harness.bridge.diagnose().hasRuntimeFrame).toBe(false);
    expect(harness.bridge.diagnose().ready).toBe(false);
  });

  it("restart destroys and re-bootstraps the last game", async () => {
    const harness = createHarness();
    await started(harness);
    // Let the first bootstrap be delivered before destroy tears the frame
    // down (jsdom dispatches cross-window postMessage on a macrotask).
    await vi.waitFor(() => expect(harness.windowMessages).toHaveLength(1));
    const restartPromise = harness.bridge.restart();
    await flush();
    deliver(harness.port1, readyMessage());
    await restartPromise;
    await vi.waitFor(() =>
      expect(
        harness.windowMessages.filter(
          (m) => (m.data as { type: string }).type === "runtime.bootstrap",
        ),
      ).toHaveLength(2),
    );
    const bootstrap = harness.windowMessages
      .map((m) => m.data as Record<string, unknown>)
      .find((m) => m.type === "runtime.bootstrap");
    expect(bootstrap?.gameId).toBe("game-1");
    expect(harness.bridge.diagnose().ready).toBe(true);
  });
});
