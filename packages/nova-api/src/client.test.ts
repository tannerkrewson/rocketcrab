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
  /** The actionId the last dispatch passed to the backend. */
  lastActionId: () => string | null;
  /** Settle the last dispatch with an authority ack. */
  ackLastDispatch: (status: "accepted" | "rejected" | "superseded", extra?: object) => void;
} {
  const calls: string[] = [];
  let lastActionIdValue: string | null = null;
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
    dispatch(_action, actionId) {
      calls.push("dispatch");
      lastActionIdValue = actionId;
      return Promise.resolve();
    },
    createRawChannel() {
      calls.push("createRawChannel");
    },
    closeRawChannel() {
      calls.push("closeRawChannel");
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
  return {
    client: createNovaClient(backend),
    backend,
    calls,
    emit,
    lastActionId: () => lastActionIdValue,
    ackLastDispatch: (status, extra = {}) => {
      const actionId = lastActionIdValue;
      if (actionId === null) {
        throw new Error("no dispatch recorded");
      }
      emit({ type: "actionAck", ack: { actionId, status, ...extra } });
    },
  };
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
    const { client, calls, emit, ackLastDispatch } = makeClient();
    client.defineGame({ title: "T" });
    client.ready();
    emit({ type: "start" });
    // dispatch resolves only when the authority acks (S2).
    const dispatched = client.dispatch({ type: "playCard", payload: { card: "ace" } });
    await Promise.resolve(); // let the backend record the action id
    ackLastDispatch("accepted", { revision: 2 });
    await dispatched;
    client.raw.createChannel({ name: "chat" });
    client.raw.send("chat", { text: "hi" });
    client.raw.send("chat", new Uint8Array([1]));
    // raw sends record asynchronously (the backend send is promise-wrapped).
    await Promise.resolve();
    await Promise.resolve();
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

  it("rejects a dispatched action when the authority rejects it", async () => {
    const { client, emit, ackLastDispatch } = makeClient();
    client.defineGame({ title: "T" });
    client.ready();
    emit({ type: "start" });
    const dispatched = client.dispatch({ type: "bad" });
    await Promise.resolve(); // let the backend record the action id
    ackLastDispatch("rejected", { errorCode: "unknown_action", errorMessage: "no such handler" });
    await expect(dispatched).rejects.toMatchObject({
      code: "unknown_action",
      message: "no such handler",
    });
  });

  it("times out a dispatch that never receives an ack", async () => {
    vi.useFakeTimers();
    try {
      const { client, emit } = makeClient();
      client.defineGame({ title: "T" });
      client.ready();
      emit({ type: "start" });
      const dispatched = client.dispatch({ type: "slow" });
      const assertion = expect(dispatched).rejects.toMatchObject({ code: "timed_out" });
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("registers state-mode handlers and calls render with each view", async () => {
    const { client, emit, calls } = makeClient();
    const renders: unknown[] = [];
    const stateChanges: unknown[] = [];
    client.defineGame({
      title: "T",
      mode: "state",
      createInitialState: () => ({ count: 0 }),
      actions: {
        bump: (draft: { count: number }) => {
          draft.count += 1;
        },
      },
      selectView: (state: { count: number }) => ({ count: state.count }),
      render: (view) => renders.push(view),
    });
    expect(calls).toEqual(["register"]);
    client.ready();
    emit({ type: "start" });
    client.state.onChange((state) => stateChanges.push(state));
    emit({ type: "state", state: { count: 1 } });
    emit({ type: "state", state: { count: 2 } });
    expect(stateChanges).toEqual([{ count: 1 }, { count: 2 }]);
    expect(renders).toEqual([{ count: 1 }, { count: 2 }]);
  });

  it("rejects non-function state-mode handlers", () => {
    const { client } = makeClient();
    expectNovaError(
      () =>
        client.defineGame({ title: "T", createInitialState: "nope" as unknown as () => unknown }),
      "invalid_options",
    );
    expectNovaError(
      () =>
        client.defineGame({
          title: "T",
          actions: { bad: 42 as unknown as (draft: unknown) => void },
        }),
      "invalid_options",
    );
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
    expectNovaError(() => client.raw.close("x".repeat(65)), "invalid_options");
    expectNovaError(
      () => client.raw.send("chat", "hi", { onProgress: 42 as unknown as () => void }),
      "invalid_options",
    );
  });

  it("forwards raw.close to the backend with lifecycle gating (A2)", () => {
    const { client, calls, emit } = makeClient();
    expectNovaError(() => client.raw.close("chat"), "not_started");
    client.defineGame({ title: "T" });
    client.ready();
    expectNovaError(() => client.raw.close("chat"), "not_started");
    emit({ type: "start" });
    client.raw.close("chat");
    expect(calls).toContain("closeRawChannel");
    expectNovaError(() => client.raw.close(""), "invalid_options");
    emit({ type: "end", reason: "user_exit" });
    expectNovaError(() => client.raw.close("chat"), "ended");
  });

  it("delivers async raw send failures to onError (A2)", async () => {
    const { client, emit } = makeClient({
      sendRaw() {
        throw new Error("boom");
      },
    });
    const errors: Array<{ code: string }> = [];
    client.onError((error) => errors.push({ code: error.code }));
    client.defineGame({ title: "T" });
    client.ready();
    emit({ type: "start" });
    client.raw.send("chat", "hi");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toEqual([{ code: "invalid_options" }]);
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
    emit({ type: "start" });
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
