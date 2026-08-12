/**
 * S1 documentation check: the JavaScript examples in `docs/api/` are the
 * canonical usage examples, and they must actually work against the real
 * API. Each example is executed with a session-backed `nova` client (the
 * same client the runtime frame bridge builds), and the minimal game is
 * asserted to stay under the ~30-line acceptance threshold.
 */
import { describe, expect, it, vi } from "vitest";
import {
  MINIMAL_GAME_EXAMPLE,
  RAW_MODE_EXAMPLE,
  SIMULATION_MODE_EXAMPLE,
  STATE_MODE_EXAMPLE,
} from "./examples";
import { createInMemoryHarness } from "./harness";
import { createNovaSession, type NovaSession } from "./session";

const SESSION = "session-examples";

function runExample(
  harness: ReturnType<typeof createInMemoryHarness>,
  source: string,
  memberId: string,
  displayName: string,
  options: {
    mode?: "state" | "simulation" | "raw";
    simulation?: { tickMs?: number; snapshotIntervalMs?: number };
  } = {},
): NovaSession {
  const transport = harness.createTransport({ memberId, displayName });
  const session = createNovaSession({
    transport,
    room: "arena",
    sessionId: SESSION,
    player: { memberId, displayName },
    game: { gameId: "game-example", mode: options.mode ?? "state", title: "Example Game" },
    simulation: options.simulation,
  });
  // Syntax + behavior: execute the documented source against the real API.
  new Function("nova", source)(session.client);
  return session;
}

async function twoPlayers(harness: ReturnType<typeof createInMemoryHarness>): Promise<{
  a: NovaSession;
  b: NovaSession;
}> {
  const a = runExample(harness, MINIMAL_GAME_EXAMPLE, "member-a", "Ada");
  const b = runExample(harness, MINIMAL_GAME_EXAMPLE, "member-b", "Ben");
  await a.join();
  await b.join();
  harness.drain();
  return { a, b };
}

function logs(): Array<unknown[]> {
  const entries: Array<unknown[]> = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    entries.push(args);
  });
  return entries;
}

/** Drain + macrotask flush: the state engine's async apply and sha256 need
 * real event-loop turns (the hub only delivers on drain()). */
async function flush(harness: ReturnType<typeof createInMemoryHarness>): Promise<void> {
  for (let i = 0; i < 2; i += 1) {
    for (let j = 0; j < 8; j += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    harness.drain();
  }
  await Promise.resolve();
}

describe("documented examples", () => {
  it("keeps the minimal game under the ~30-line acceptance threshold", () => {
    const lines = MINIMAL_GAME_EXAMPLE.split("\n").filter((line) => line.trim().length > 0);
    expect(lines.length).toBeLessThanOrEqual(30);
    expect(lines.some((line) => line.includes("defineGame"))).toBe(true);
  });

  it("parses as valid JavaScript", () => {
    for (const example of [
      MINIMAL_GAME_EXAMPLE,
      STATE_MODE_EXAMPLE,
      SIMULATION_MODE_EXAMPLE,
      RAW_MODE_EXAMPLE,
    ]) {
      expect(() => new Function("nova", example)).not.toThrow();
    }
  });

  it("minimal game registers, readies, and observes start", async () => {
    const harness = createInMemoryHarness();
    const { a, b } = await twoPlayers(harness);
    const aStarted: number[] = [];
    const bStarted: number[] = [];
    a.client.onStart(() => aStarted.push(1));
    b.client.onStart(() => bStarted.push(1));
    expect(a.declaration).toEqual({ title: "Hello Nova", mode: "state" });
    expect(b.readyOf("member-a")).toBe(true); // ready crossed the transport
    a.start();
    b.start();
    await flush(harness);
    expect(aStarted).toHaveLength(1);
    expect(bStarted).toHaveLength(1);
    // The default initial state {} committed even without declared handlers.
    expect(a.getStateModeDiagnostics().revision).toBe(1);
  });

  it("state-mode example dispatches actions that the authority applies", async () => {
    const harness = createInMemoryHarness();
    const a = runExample(harness, STATE_MODE_EXAMPLE, "member-a", "Ada");
    const b = runExample(harness, STATE_MODE_EXAMPLE, "member-b", "Ben");
    const entries = logs();
    try {
      await a.join();
      await b.join();
      await flush(harness);
      a.start();
      b.start();
      await flush(harness);
      // Both players' onStart dispatches ran; the authority applied them.
      const diagnostics = a.getStateModeDiagnostics();
      expect(diagnostics.revision).toBe(3); // initial + Ada's draw + Ben's draw
      expect(diagnostics.appliedCount).toBe(3);
      // Both frames received only their selected view (never the deck).
      const stateLogs = entries.filter(
        (args) => args[0] === "State changed:" && typeof args[1] === "object",
      );
      expect(stateLogs.length).toBeGreaterThanOrEqual(2);
      const views = stateLogs.map((args) => args[1] as { hand?: string; cardsLeft?: number });
      expect(views.every((view) => typeof view.cardsLeft === "number")).toBe(true);
      expect(views.some((view) => typeof view.hand === "string")).toBe(true);
      expect(a.getCanonicalState()?.state).toMatchObject({ deck: ["ace", "king"] });
      // A stale race was rejected with a clear code (caught by the example).
      const rejectionLogs = entries.filter((args) => args[0] === "Draw rejected:");
      expect(rejectionLogs.length).toBeGreaterThanOrEqual(1);
      expect(rejectionLogs[0]?.[1]).toBe("stale_revision");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("simulation-mode example routes inputs, advances ticks, and restores snapshots", async () => {
    const harness = createInMemoryHarness();
    // Fast deterministic cadence (real timers; the clock is fake-timer free).
    const timings = {
      mode: "simulation" as const,
      simulation: { tickMs: 20, snapshotIntervalMs: 60 },
    };
    const a = runExample(harness, SIMULATION_MODE_EXAMPLE, "member-a", "Ada", timings);
    const b = runExample(harness, SIMULATION_MODE_EXAMPLE, "member-b", "Ben", timings);
    await a.join();
    await b.join();
    await flush(harness);
    a.start();
    b.start();
    // Poll with real time + drain: the in-memory hub only delivers on
    // drain() and the simulation clock is driven by real timers.
    const waitFor = async (condition: () => boolean, label: string): Promise<void> => {
      const deadline = Date.now() + 5_000;
      while (!condition()) {
        if (Date.now() > deadline) throw new Error(`waitFor ${label} timed out`);
        await flush(harness);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    // Inputs crossed the transport in both directions (the example sends
    // once per player at start).
    await waitFor(
      () =>
        b.getSimulationDiagnostics().inputsReceived >= 1 &&
        a.getSimulationDiagnostics().inputsReceived >= 1,
      "inputs",
    );
    // The Nova-provided clock advances every frame's local simulation.
    await waitFor(
      () => a.getSimulationDiagnostics().tick >= 2 && b.getSimulationDiagnostics().tick >= 2,
      "ticks",
    );
    // The authority produces authoritative snapshots (the example's
    // serializeState callback) and every shell replicates them. The
    // authority itself never receives its own broadcasts (no loopback),
    // so its retained snapshot is asserted through `authorityTick`.
    await waitFor(
      () =>
        b.getSimulationDiagnostics().snapshotsReceived >= 1 &&
        a.getSimulationDiagnostics().authorityTick !== null,
      "snapshots",
    );
    expect(a.getSimulationDiagnostics().authorityMemberId).toBe("member-a");
    expect(b.getSimulationDiagnostics().authorityMemberId).toBe("member-a");
  });

  it("raw-mode example exchanges chat messages between players", async () => {
    const harness = createInMemoryHarness();
    const a = runExample(harness, RAW_MODE_EXAMPLE, "member-a", "Ada");
    const b = runExample(harness, RAW_MODE_EXAMPLE, "member-b", "Ben");
    const entries = logs();
    try {
      await a.join();
      await b.join();
      await flush(harness);
      a.start();
      b.start();
      await flush(harness);
      const messages = entries.map((args) => args.join(" ")).join("\n");
      expect(messages).toContain("Ada says: hello everyone");
      expect(messages).toContain("Ben says: hello everyone");
    } finally {
      vi.restoreAllMocks();
    }
  });
});
