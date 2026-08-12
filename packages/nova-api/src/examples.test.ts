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
): NovaSession {
  const transport = harness.createTransport({ memberId, displayName });
  const session = createNovaSession({
    transport,
    room: "arena",
    sessionId: SESSION,
    player: { memberId, displayName },
    game: { gameId: "game-example", mode: "state", title: "Example Game" },
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
    harness.drain();
    expect(aStarted).toHaveLength(1);
    expect(bStarted).toHaveLength(1);
  });

  it("state-mode example dispatches an action that reaches the other player", async () => {
    const harness = createInMemoryHarness();
    const a = runExample(harness, STATE_MODE_EXAMPLE, "member-a", "Ada");
    const b = runExample(harness, STATE_MODE_EXAMPLE, "member-b", "Ben");
    const received: Array<{ type: string; payload: unknown }> = [];
    b.onSessionEvent((event) => {
      if (event.type === "actionReceived") {
        received.push({ type: event.action.type, payload: event.action.payload });
      }
    });
    await a.join();
    await b.join();
    harness.drain();
    a.start();
    b.start();
    harness.drain();
    expect(received).toContainEqual({ type: "drawCard", payload: { deck: "main" } });
  });

  it("simulation-mode example routes inputs between players", async () => {
    const harness = createInMemoryHarness();
    const a = runExample(harness, SIMULATION_MODE_EXAMPLE, "member-a", "Ada");
    const b = runExample(harness, SIMULATION_MODE_EXAMPLE, "member-b", "Ben");
    const entries = logs();
    try {
      await a.join();
      await b.join();
      harness.drain();
      a.start();
      b.start();
      harness.drain();
      const messages = entries.map((args) => args.join(" ")).join("\n");
      expect(messages).toContain("Ada moved: move"); // B received A's input
      expect(messages).toContain("Ben moved: move"); // A received B's input
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("raw-mode example exchanges chat messages between players", async () => {
    const harness = createInMemoryHarness();
    const a = runExample(harness, RAW_MODE_EXAMPLE, "member-a", "Ada");
    const b = runExample(harness, RAW_MODE_EXAMPLE, "member-b", "Ben");
    const entries = logs();
    try {
      await a.join();
      await b.join();
      harness.drain();
      a.start();
      b.start();
      harness.drain();
      const messages = entries.map((args) => args.join(" ")).join("\n");
      expect(messages).toContain("Ada says: hello everyone");
      expect(messages).toContain("Ben says: hello everyone");
    } finally {
      vi.restoreAllMocks();
    }
  });
});
