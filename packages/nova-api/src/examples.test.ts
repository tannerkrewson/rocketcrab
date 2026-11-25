/**
 * Documentation check: the JavaScript examples in the API reference are the
 * canonical usage examples, and they must actually work against the real
 * API. Each example is executed with a session-backed `nova` client (the
 * same client the runtime frame bridge builds), and the minimal game is
 * asserted to stay under the ~30-line acceptance threshold.
 */
import { describe, expect, it, vi } from "vitest";
import { MINIMAL_GAME_EXAMPLE, TICK_EXAMPLE, STATE_EXAMPLE } from "./examples";
import { createInMemoryHarness } from "./harness";
import { createNovaSession, type NovaSession } from "./session";

const SESSION = "session-examples";

function runExample(
  harness: ReturnType<typeof createInMemoryHarness>,
  source: string,
  memberId: string,
  displayName: string,
): NovaSession {
  const transport = harness.createTransport({ memberId, displayName });
  const session = createNovaSession({
    transport,
    room: "arena",
    sessionId: SESSION,
    player: { memberId, displayName },
    game: { gameId: "game-example", title: "Example Game" },
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
    for (const example of [MINIMAL_GAME_EXAMPLE, STATE_EXAMPLE, TICK_EXAMPLE]) {
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
    expect(a.declaration).toEqual({ title: "Hello Nova" });
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
    const a = runExample(harness, STATE_EXAMPLE, "member-a", "Ada");
    const b = runExample(harness, STATE_EXAMPLE, "member-b", "Ben");
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

  it("tick example moves each player's paddle by their controls", async () => {
    const harness = createInMemoryHarness();
    const a = runExample(harness, TICK_EXAMPLE, "member-a", "Ada");
    const b = runExample(harness, TICK_EXAMPLE, "member-b", "Ben");
    await a.join();
    await b.join();
    await flush(harness);
    a.start();
    b.start();
    const deadline = Date.now() + 5_000;
    const paddleX = (session: NovaSession, id: string): number =>
      (session.getCanonicalState()?.state as { paddles?: Record<string, { x: number }> })
        ?.paddles?.[id]?.x ?? 0;
    // Both players hold right from onStart; the authority's tick moves both
    // paddles, and Ben's copy of the state follows.
    while (paddleX(b, "member-b") <= 52 || paddleX(b, "member-a") <= 52) {
      if (Date.now() > deadline) throw new Error("paddles never moved");
      await flush(harness);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });
});
