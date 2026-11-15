/**
 * Session lifecycle tests (§10 review): what a session must stop or release
 * when the player leaves, and how the dispatch buffer stays bounded while no
 * authority is known.
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

/** The dispatches a session holds while no authority is known. */
function bufferedDispatches(session: NovaSession): number {
  return (session as unknown as { dispatchBuffer: unknown[] }).dispatchBuffer.length;
}

describe("NovaSession lifecycle (leave and dispatch buffer)", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
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

  it("drops expired buffered dispatches when a new one arrives with no authority known", () => {
    const hub = new InMemoryTransportHub({ seed: "nova-api-lifecycle-buffer" });
    const transport = hub.createTransport({ memberId: "member-a", displayName: "Ada" });
    const session = makeSimulationSession(transport, "member-a", "Ada");
    for (let index = 0; index < 50; index += 1) {
      void session.dispatch(
        { type: "mark", payload: { index }, baseRevision: 0 },
        `early-${index}`,
      );
    }
    expect(bufferedDispatches(session)).toBe(50);

    // Every early dispatch is past its deadline; none can ever be applied.
    vi.advanceTimersByTime(60_000);
    void session.dispatch({ type: "mark", payload: {}, baseRevision: 0 }, "late");

    expect(bufferedDispatches(session)).toBe(1);
  });
});
