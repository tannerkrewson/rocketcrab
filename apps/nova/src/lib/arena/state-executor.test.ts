/**
 * FrameStateExecutor tests (S2): the host-side half of the
 * authority-runtime seam. Verifies request/response correlation, the
 * execution timeout, dropping late responses (rule 22), and dispose.
 */
import { describe, expect, it, vi } from "vitest";
import type { GameApiEvent } from "@rocketcrab/protocol";
import type { NovaPlayer } from "@rocketcrab/nova-api";
import { FrameSimulationExecutor, FrameStateExecutor } from "./state-executor";

const PLAYER_A: NovaPlayer = { id: "member-a", name: "Ada" };
const PLAYER_B: NovaPlayer = { id: "member-b", name: "Ben" };

interface Harness {
  executor: FrameStateExecutor;
  pushed: GameApiEvent[];
}

function makeHarness(timeoutMs = 50): Harness {
  const pushed: GameApiEvent[] = [];
  const executor = new FrameStateExecutor((event) => pushed.push(event), timeoutMs);
  return { executor, pushed };
}

/** Answer the most recent stateRequest for a player with a canned result. */
function answer(harness: Harness, result: unknown, index = harness.pushed.length - 1): void {
  const event = harness.pushed[index];
  if (event?.kind !== "stateRequest") {
    throw new Error("no stateRequest pushed");
  }
  harness.executor.handleResponse({ requestId: event.requestId, result: result as never });
}

describe("FrameStateExecutor", () => {
  it("sends createInitialState and correlates the response", async () => {
    const { executor, pushed } = makeHarness();
    const promise = executor.createInitialState({
      context: { self: PLAYER_A, players: [PLAYER_A, PLAYER_B], revision: 0, now: 1 },
      viewers: [PLAYER_A, PLAYER_B],
    });
    expect(pushed).toHaveLength(1);
    const event = pushed[0];
    expect(event?.kind).toBe("stateRequest");
    if (event?.kind !== "stateRequest") return;
    expect(event.request.kind).toBe("createInitialState");
    if (event.request.kind !== "createInitialState") return;
    expect(event.request.viewers).toEqual([PLAYER_A, PLAYER_B]);
    executor.handleResponse({
      requestId: event.requestId,
      result: {
        kind: "state",
        ok: true,
        state: { count: 0 },
        views: { "member-a": { count: 0 }, "member-b": { count: 0 } },
      },
    });
    await expect(promise).resolves.toEqual({
      ok: true,
      state: { count: 0 },
      views: { "member-a": { count: 0 }, "member-b": { count: 0 } },
    });
  });

  it("sends applyAction with the canonical state and viewers", async () => {
    const { executor, pushed } = makeHarness();
    const promise = executor.applyAction({
      actionId: "action-1",
      type: "drawCard",
      payload: { deck: "main" },
      state: { deck: ["ace"] },
      context: {
        self: PLAYER_A,
        players: [PLAYER_A, PLAYER_B],
        revision: 1,
        now: 1,
        actor: PLAYER_B,
      },
      viewers: [PLAYER_A, PLAYER_B],
    });
    const event = pushed[0];
    expect(event?.kind).toBe("stateRequest");
    if (event?.kind !== "stateRequest") return;
    expect(event.request.kind).toBe("applyAction");
    if (event.request.kind !== "applyAction") return;
    expect(event.request).toMatchObject({
      actionId: "action-1",
      actionType: "drawCard",
      payload: { deck: "main" },
      state: { deck: ["ace"] },
    });
    answer(
      { executor, pushed },
      { kind: "state", ok: true, state: { deck: [] }, views: { "member-a": {}, "member-b": {} } },
    );
    await expect(promise).resolves.toMatchObject({ ok: true, state: { deck: [] } });
  });

  it("sends computeView for late joiners", async () => {
    const { executor, pushed } = makeHarness();
    const promise = executor.computeView({ state: { count: 3 }, viewer: PLAYER_B });
    const event = pushed[0];
    expect(event?.kind).toBe("stateRequest");
    if (event?.kind !== "stateRequest") return;
    expect(event.request.kind).toBe("computeView");
    answer({ executor, pushed }, { kind: "view", ok: true, view: { count: 3 } });
    await expect(promise).resolves.toEqual({ ok: true, view: { count: 3 } });
  });

  it("forwards stable rejection codes from the frame", async () => {
    const { executor, pushed } = makeHarness();
    const promise = executor.computeView({ state: {}, viewer: PLAYER_A });
    answer(
      { executor, pushed },
      { kind: "error", ok: false, code: "view_error", message: "no view for you" },
    );
    await expect(promise).resolves.toEqual({
      ok: false,
      code: "view_error",
      message: "no view for you",
    });
  });

  it("times out requests the frame never answers", async () => {
    vi.useFakeTimers();
    try {
      const { executor } = makeHarness(50);
      const promise = executor.computeView({ state: {}, viewer: PLAYER_A });
      await vi.advanceTimersByTimeAsync(60);
      await expect(promise).resolves.toMatchObject({ ok: false, code: "execution_timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops late responses to settled or timed-out requests (rule 22)", async () => {
    const { executor, pushed } = makeHarness(50);
    const promise = executor.computeView({ state: {}, viewer: PLAYER_A });
    const event = pushed[0];
    if (event?.kind !== "stateRequest") return;
    executor.handleResponse({
      requestId: event.requestId,
      result: { kind: "view", ok: true, view: { hand: "ace" } },
    });
    await expect(promise).resolves.toEqual({ ok: true, view: { hand: "ace" } });
    // A second response for the same request id is dropped, not settled.
    expect(() =>
      executor.handleResponse({
        requestId: event.requestId,
        result: { kind: "view", ok: true, view: { hand: "king" } },
      }),
    ).not.toThrow();
  });

  it("settles pending requests as failed when disposed", async () => {
    const { executor } = makeHarness();
    const promise = executor.computeView({ state: {}, viewer: PLAYER_A });
    executor.dispose();
    await expect(promise).resolves.toMatchObject({ ok: false, code: "execution_failed" });
  });
});

describe("FrameSimulationExecutor (A1)", () => {
  function makeSimHarness(timeoutMs = 50): {
    executor: FrameSimulationExecutor;
    pushed: GameApiEvent[];
  } {
    const pushed: GameApiEvent[] = [];
    const executor = new FrameSimulationExecutor((event) => pushed.push(event), timeoutMs);
    return { executor, pushed };
  }

  function answer(
    harness: { executor: FrameSimulationExecutor; pushed: GameApiEvent[] },
    result: unknown,
    index = harness.pushed.length - 1,
  ): void {
    const event = harness.pushed[index];
    if (event?.kind !== "simulationRequest") {
      throw new Error("no simulationRequest pushed");
    }
    harness.executor.handleResponse({ requestId: event.requestId, result: result as never });
  }

  it("asks the authority frame to serialize its state and correlates the answer", async () => {
    const harness = makeSimHarness();
    const promise = harness.executor.serializeState();
    expect(harness.pushed).toHaveLength(1);
    const event = harness.pushed[0];
    expect(event?.kind).toBe("simulationRequest");
    if (event?.kind !== "simulationRequest") return;
    expect(event.requestId).toMatch(/^simulation-/u);
    answer(harness, { kind: "state", ok: true, state: { puck: { x: 40 } } });
    await expect(promise).resolves.toEqual({ ok: true, state: { puck: { x: 40 } } });
  });

  it("forwards stable rejection codes from the frame", async () => {
    const harness = makeSimHarness();
    const promise = harness.executor.serializeState();
    answer(harness, {
      kind: "error",
      ok: false,
      code: "snapshot_error",
      message: "game exploded",
    });
    await expect(promise).resolves.toEqual({
      ok: false,
      code: "snapshot_error",
      message: "game exploded",
    });
  });

  it("times out requests the frame never answers", async () => {
    vi.useFakeTimers();
    try {
      const harness = makeSimHarness(50);
      const promise = harness.executor.serializeState();
      vi.advanceTimersByTime(51);
      await expect(promise).resolves.toMatchObject({ ok: false, code: "execution_timeout" });
      // A late answer after the timeout is dropped (rule 22), not settled.
      expect(() => answer(harness, { kind: "state", ok: true, state: {} })).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles pending requests as failed when disposed", async () => {
    const harness = makeSimHarness();
    const promise = harness.executor.serializeState();
    harness.executor.dispose();
    await expect(promise).resolves.toMatchObject({ ok: false, code: "execution_failed" });
  });
});
