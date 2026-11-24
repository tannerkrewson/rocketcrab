/**
 * Session lifecycle tests: what a session must stop or release
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

/** A ticking game: every tick changes the state, so every tick commits. */
function makeTickingSession(
  transport: NovaTransport,
  memberId: string,
  displayName: string,
): NovaSession {
  const session = createNovaSession({
    transport,
    room: ROOM,
    sessionId: SESSION,
    player: { memberId, displayName },
    game: { gameId: "game-1", title: "Lifecycle" },
  });
  session.client.defineGame({
    title: "Lifecycle",
    tickRate: 10,
    createInitialState: () => ({ ticks: 0 }),
    tick(draft: { ticks: number }) {
      draft.ticks += 1;
    },
  });
  return session;
}

/** The protocol messages a session holds while its transport is not connected. */
function queuedOutbox(session: NovaSession): number {
  return (session as unknown as { outbox: unknown[] }).outbox.length;
}

/** The dispatches a session holds while no authority is known. */
function bufferedDispatches(session: NovaSession): number {
  return (session as unknown as { dispatchBuffer: unknown[] }).dispatchBuffer.length;
}

/** Mirrors MAX_BUFFERED_DISPATCHES in session.ts. */
const BUFFER_CAP = 256;

/** A session with no authority known, holding BUFFER_CAP dispatches. */
function fillBufferToCap(): NovaSession {
  const hub = new InMemoryTransportHub({ seed: "nova-api-lifecycle-buffer" });
  const transport = hub.createTransport({ memberId: "member-a", displayName: "Ada" });
  const session = makeTickingSession(transport, "member-a", "Ada");
  for (let index = 0; index < BUFFER_CAP; index += 1) {
    void session.dispatch({ type: "mark", payload: { index }, baseRevision: 0 }, `held-${index}`);
  }
  return session;
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

  it("leave() stops the authority's tick", async () => {
    const hub = new InMemoryTransportHub({ seed: "nova-api-lifecycle-leave" });
    const transportA = hub.createTransport({ memberId: "member-a", displayName: "Ada" });
    const transportB = hub.createTransport({ memberId: "member-b", displayName: "Ben" });
    await transportA.join({ room: ROOM, sessionId: SESSION });
    await transportB.join({ room: ROOM, sessionId: SESSION });
    hub.drain();
    const a = makeTickingSession(transportA, "member-a", "Ada");
    const b = makeTickingSession(transportB, "member-b", "Ben");
    const ticks: number[] = [];
    a.onSessionEvent((event) => {
      if (event.type === "stateCommitted" && event.tick) ticks.push(event.revision);
    });
    await a.attach();
    await b.attach();
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

    // A left session must not keep ticking, and must not queue state
    // that can never be delivered.
    expect(ticks.length).toBe(ticksAtLeave);
    expect(queuedOutbox(a)).toBe(outboxAtLeave);
  });

  it("refuses a dispatch past the buffer cap while no authority is known", async () => {
    const session = fillBufferToCap();
    expect(bufferedDispatches(session)).toBe(BUFFER_CAP);

    const overflow = session.dispatch({ type: "mark", payload: {}, baseRevision: 0 }, "overflow");
    await expect(overflow).rejects.toMatchObject({ code: "rate_limited" });
    expect(bufferedDispatches(session)).toBe(BUFFER_CAP);
  });

  it("an expired buffered dispatch frees its slot when the cap is reached", async () => {
    const session = fillBufferToCap();

    // Every held dispatch is past its deadline; none can ever be applied.
    vi.advanceTimersByTime(60_000);
    await expect(
      session.dispatch({ type: "mark", payload: {}, baseRevision: 0 }, "late"),
    ).resolves.toBeUndefined();

    expect(bufferedDispatches(session)).toBe(1);
  });
});
