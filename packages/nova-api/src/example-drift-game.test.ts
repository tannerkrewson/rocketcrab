/**
 * Nova Drift (packages/testing/fixtures/games/nova-drift.html) run end to end: its inline
 * script drives real sessions over the in-memory transport. The DOM half is
 * guarded, so the same source runs here, in the arena and in parties.
 */
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryTransportHub } from "@rocketcrab/testing";
import GAME_SOURCE from "../../testing/fixtures/games/nova-drift.html?raw";
import { createNovaSession, type NovaSession } from "./session";

const SCRIPT = /<script type="module">([\s\S]*?)<\/script>/u.exec(GAME_SOURCE)?.[1] ?? "";
const hubs: InMemoryTransportHub[] = [];
const sessions: NovaSession[] = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  for (const hub of hubs.splice(0)) hub.dispose();
});

function player(hub: InMemoryTransportHub, memberId: string): NovaSession {
  const session = createNovaSession({
    transport: hub.createTransport({ memberId, displayName: memberId }),
    room: "drift",
    sessionId: "drift",
    player: { memberId, displayName: memberId },
    game: { gameId: "nova-drift", title: "Nova Drift" },
  });
  sessions.push(session);
  new Function("nova", SCRIPT)(session.client);
  return session;
}

function puckOf(session: NovaSession): { x: number; y: number } {
  const state = session.getCanonicalState()?.state as
    | { puck: { x: number; y: number } }
    | undefined;
  if (state === undefined) throw new Error("no state yet");
  return state.puck;
}

async function until(hub: InMemoryTransportHub, condition: () => boolean, what: string) {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    hub.drain();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("nova-drift", () => {
  it("moves the shared puck by any player's controls on every screen", async () => {
    const hub = new InMemoryTransportHub();
    hubs.push(hub);
    const a = player(hub, "member-a");
    const b = player(hub, "member-b");
    await a.join();
    await b.join();
    await until(hub, () => a.players.length === 2 && b.players.length === 2, "both joined");
    a.start();
    b.start();
    await until(hub, () => b.getCanonicalState() !== null, "the initial state");
    expect(puckOf(b)).toEqual({ x: 400, y: 250 });

    // Ben (not the authority) holds right; Ada's tick moves the puck.
    b.client.controls.set({ dx: 1, dy: 0 });
    await until(hub, () => puckOf(b).x > 450, "the puck moving right on Ben's screen");
    expect(puckOf(b).y).toBe(250);

    // Ada leaves: Ben ticks from his copy, and his controls still steer.
    const x = puckOf(b).x;
    await a.leave();
    await until(hub, () => puckOf(b).x > x + 40, "Ben's tick moving the puck after the handoff");
  });
});
