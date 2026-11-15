/**
 * Session lifecycle tests (§10 review): what a session must stop or release
 * when the player leaves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NovaTransport } from "@rocketcrab/core";
import { InMemoryTransportHub } from "@rocketcrab/testing";
import { createNovaSession, type NovaSession } from "./session";

const ROOM = "party:lifecycle-room";
const SESSION = "session-lifecycle";

/** Let real-async steps (the state hash digest, start sequencing) run. */
async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function makeSimulationSession(
  transport: NovaTransport,
  memberId: string,
  displayName: string,
): NovaSession {
  return createNovaSession({
    transport,
    room: ROOM,
    sessionId: SESSION,
    player: { memberId, displayName },
    game: { gameId: "game-1", mode: "simulation", title: "Lifecycle" },
    simulation: { tickMs: 100, snapshotIntervalMs: 500 },
  });
}

/** The protocol messages a session holds while its transport is not connected. */
function queuedOutbox(session: NovaSession): number {
  return (session as unknown as { outbox: unknown[] }).outbox.length;
}

const FAKE_TIMERS = {
  toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] as const,
};

describe("NovaSession lifecycle (leave and dispatch buffer)", () => {
  beforeEach(() => {
    vi.useFakeTimers(FAKE_TIMERS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("leave() stops the simulation clock and the authority's snapshot cadence", async () => {
    const hub = new InMemoryTransportHub({ seed: "nova-api-lifecycle-leave" });
    const transportA = hub.createTransport({ memberId: "member-a", displayName: "Ada" });
    const transportB = hub.createTransport({ memberId: "member-b", displayName: "Ben" });
    await transportA.join({ room: ROOM, sessionId: SESSION });
    await transportB.join({ room: ROOM, sessionId: SESSION });
    hub.drain();
    const a = makeSimulationSession(transportA, "member-a", "Ada");
    const b = makeSimulationSession(transportB, "member-b", "Ben");
    const ticks: number[] = [];
    a.onSessionEvent((event) => {
      if (event.type === "simulationTick") ticks.push(event.tick);
    });
    await a.attach();
    await b.attach();
    const handlers = { serializeState: () => ({ count: 1 }) };
    a.registerSimulation(handlers);
    b.registerSimulation(handlers);
    a.start(); // member-a is the lowest eligible member: the authority
    b.start();
    await yieldToEventLoop();
    hub.drain();
    await vi.advanceTimersByTimeAsync(1000);
    await yieldToEventLoop();
    expect(ticks.length).toBeGreaterThan(0);

    await a.leave();
    const ticksAtLeave = ticks.length;
    const outboxAtLeave = queuedOutbox(a);
    await vi.advanceTimersByTimeAsync(5000);
    await yieldToEventLoop();

    // A left session must not keep ticking, and must not queue snapshots
    // that can never be delivered.
    expect(ticks.length).toBe(ticksAtLeave);
    expect(queuedOutbox(a)).toBe(outboxAtLeave);
  });
});
