import { describe, expect, it, vi } from "vitest";
import {
  createNovaClient,
  type NovaClient,
  type NovaClientBackend,
  type NovaSessionEvent,
} from "./client";
import { NovaError } from "./errors";
import type { NovaGameDeclaration, NovaPlayer } from "./types";

/** A recording backend for client-only tests. */
function makeClient(overrides: Partial<NovaClientBackend> = {}): {
  client: NovaClient;
  backend: NovaClientBackend;
  calls: string[];
  emit: (event: NovaSessionEvent) => void;
} {
  const calls: string[] = [];
  const listeners = new Set<(event: NovaSessionEvent) => void>();
  const emit = (event: NovaSessionEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };
  const backend: NovaClientBackend = {
    apiVersion: 1,
    self: { id: "member-a", name: "Ada" },
    register() {
      calls.push("register");
    },
    ready() {
      calls.push("ready");
    },
    dispatch() {
      calls.push("dispatch");
      return Promise.resolve();
    },
    createRawChannel() {
      calls.push("createRawChannel");
    },
    sendRaw() {
      calls.push("sendRaw");
    },
    registerSimulation() {
      calls.push("registerSimulation");
    },
    sendSimulationInput() {
      calls.push("sendSimulationInput");
    },
    onEvent(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
    ...overrides,
  };
  return { client: createNovaClient(backend), backend, calls, emit };
}

function expectNovaError(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable("expected a NovaError");
  } catch (error) {
    expect(error).toBeInstanceOf(NovaError);
    expect((error as NovaError).code).toBe(code);
  }
}

describe("createNovaClient lifecycle", () => {
  it("registers a valid game and forwards it to the backend", () => {
    const { client, calls } = makeClient();
    expect(client.version).toBe(1);
    client.defineGame({ title: "My Game", mode: "simulation", version: "1.0.0" });
    expect(calls).toEqual(["register"]);
    expectNovaError(() => client.defineGame({}), "already_registered");
  });

  it("rejects unknown API versions safely", () => {
    const { client } = makeClient();
    expectNovaError(() => client.defineGame({ apiVersion: 99 }), "unsupported_api_version");
    expectNovaError(() => client.defineGame({ apiVersion: 2 }), "unsupported_api_version");
  });

  it("rejects invalid registration options", () => {
    const { client } = makeClient();
    expectNovaError(() => client.defineGame({ title: "x".repeat(65) }), "invalid_options");
    expectNovaError(
      () => client.defineGame({ mode: "quantum" as unknown as NovaGameDeclaration["mode"] }),
      "invalid_options",
    );
    expectNovaError(() => client.defineGame({ version: "" }), "invalid_options");
  });

  it("calls fail clearly before readiness", () => {
    const { client, calls } = makeClient();
    // Before registration.
    expectNovaError(() => client.ready(), "not_registered");
    expectNovaError(() => client.dispatch({ type: "x" }), "not_started");
    expectNovaError(() => client.raw.createChannel({ name: "chat" }), "not_started");
    expectNovaError(() => client.raw.send("chat", "hi"), "not_started");
    expectNovaError(() => client.simulation.sendInput({ type: "move" }), "not_started");

    // After registration, before start.
    client.defineGame({ title: "T" });
    expect(calls).toEqual(["register"]);
    expectNovaError(() => client.dispatch({ type: "x" }), "not_started");
    expectNovaError(() => client.raw.createChannel({ name: "chat" }), "not_started");
    client.ready();
    expect(calls).toEqual(["register", "ready"]);
    expectNovaError(() => client.ready(), "already_ready");
    expectNovaError(() => client.raw.createChannel({ name: "chat" }), "not_started");
  });

  it("allows dispatch and raw sends after start", async () => {
    const { client, calls, emit } = makeClient();
    client.defineGame({ title: "T" });
    client.ready();
    emit({ type: "start" });
    await client.dispatch({ type: "playCard", payload: { card: "ace" } });
    client.raw.createChannel({ name: "chat" });
    client.raw.send("chat", { text: "hi" });
    client.raw.send("chat", new Uint8Array([1]));
    expect(calls).toEqual([
      "register",
      "ready",
      "dispatch",
      "createRawChannel",
      "sendRaw",
      "sendRaw",
    ]);
  });

  it("rejects invalid actions and payloads", async () => {
    const { client, emit } = makeClient();
    client.defineGame({ title: "T" });
    client.ready();
    emit({ type: "start" });
    expectNovaError(() => client.dispatch({ type: "" }), "invalid_options");
    expectNovaError(
      () => client.dispatch({ type: "x", payload: { fn: (): void => undefined } }),
      "invalid_payload",
    );
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expectNovaError(() => client.dispatch({ type: "x", payload: circular }), "invalid_payload");
  });

  it("rejects binary payloads on non-raw calls and reserved channel names", () => {
    const { client, emit } = makeClient();
    client.defineGame({ title: "T" });
    client.ready();
    emit({ type: "start" });
    expectNovaError(
      () => client.dispatch({ type: "x", payload: new Uint8Array([1]) }),
      "invalid_payload",
    );
    expectNovaError(
      () => client.simulation.sendInput({ type: "x", payload: new Uint8Array([1]) }),
      "invalid_payload",
    );
    expectNovaError(() => client.raw.createChannel({ name: "nova.protocol" }), "reserved_channel");
    expectNovaError(() => client.raw.createChannel({ name: "x".repeat(65) }), "invalid_options");
  });

  it("fails clearly after the game ended", () => {
    const { client, emit } = makeClient();
    client.defineGame({ title: "T" });
    client.ready();
    emit({ type: "start" });
    emit({ type: "end", reason: "user_exit" });
    expectNovaError(() => client.dispatch({ type: "x" }), "ended");
    expectNovaError(() => client.raw.send("chat", "hi"), "ended");
    expectNovaError(() => client.simulation.sendInput({ type: "x" }), "ended");
    expectNovaError(() => client.ready(), "ended");
  });

  it("updates state, players, and connection status from events", () => {
    const { client, emit } = makeClient();
    const stateChanges: unknown[] = [];
    client.state.onChange((state) => stateChanges.push(state));
    const joined: NovaPlayer[] = [];
    client.onPlayerJoin((player) => joined.push(player));
    const statuses: string[] = [];
    client.onConnectionChange((status) => statuses.push(status));

    emit({ type: "connection", status: "connecting" });
    emit({ type: "connection", status: "connected" });
    emit({ type: "playerJoined", player: { id: "member-b", name: "Ben" } });
    emit({ type: "state", state: { deck: ["ace"] } });
    emit({ type: "playerLeft", player: { id: "member-b", name: "Ben" } });

    expect(client.connectionStatus).toBe("connected");
    expect(statuses).toEqual(["connecting", "connected"]);
    expect(client.players).toEqual([{ id: "member-a", name: "Ada" }]);
    expect(joined).toEqual([{ id: "member-b", name: "Ben" }]);
    expect(client.state.get()).toEqual({ deck: ["ace"] });
    expect(stateChanges).toEqual([{ deck: ["ace"] }]);
  });

  it("fires onStart before dispatch becomes available and ignores host-only events", () => {
    const { client, emit } = makeClient();
    const started: number[] = [];
    client.onStart(() => started.push(1));
    client.defineGame({ title: "T" });
    client.ready();
    emit({ type: "actionReceived", action: { type: "x" } }); // host-only: ignored
    emit({ type: "start" });
    expect(started).toHaveLength(1);
    expect(() => client.dispatch({ type: "x" })).not.toThrow();
  });

  it("routes raw messages only to matching subscriptions", () => {
    const { client, emit } = makeClient();
    const chat: unknown[] = [];
    const other: unknown[] = [];
    client.raw.onMessage("chat", (message) => chat.push(message.payload));
    client.raw.onMessage("other", (message) => other.push(message.payload));
    emit({
      type: "rawMessage",
      channel: "chat",
      message: { from: { id: "member-b", name: "Ben" }, payload: "hi", binary: false },
    });
    emit({
      type: "rawMessage",
      channel: "unsubscribed",
      message: { from: { id: "member-b", name: "Ben" }, payload: "dropped", binary: false },
    });
    expect(chat).toEqual(["hi"]);
    expect(other).toHaveLength(0);
  });

  it("routes simulation events to registered handlers", () => {
    const { client, emit } = makeClient();
    const inputs: unknown[] = [];
    const snapshots: unknown[] = [];
    const unsubscribe = client.simulation.register({
      onInput: (input) => inputs.push(input),
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });
    emit({
      type: "simulationInput",
      input: {
        type: "move",
        payload: { dx: 1 },
        sender: { id: "member-b", name: "Ben" },
      },
    });
    emit({ type: "simulationSnapshot", snapshot: { tick: 5 } });
    expect(inputs).toHaveLength(1);
    expect(snapshots).toEqual([{ tick: 5 }]);
    unsubscribe();
    emit({
      type: "simulationInput",
      input: { type: "move", sender: { id: "member-b", name: "Ben" } },
    });
    expect(inputs).toHaveLength(1);
  });

  it("forwards errors to onError handlers and disposes cleanly", () => {
    const { client, emit } = makeClient();
    const errors: NovaError[] = [];
    client.onError((error) => errors.push(error));
    const problem = new NovaError("not_connected", "boom");
    emit({ type: "error", error: problem });
    expect(errors).toEqual([problem]);
    client.dispose();
    emit({ type: "start" });
    expectNovaError(() => client.dispatch({ type: "x" }), "not_started");
  });

  it("logs through the console", () => {
    const { client } = makeClient();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      client.log("hello", 42);
      expect(spy).toHaveBeenCalledWith("hello", 42);
    } finally {
      spy.mockRestore();
    }
  });
});
