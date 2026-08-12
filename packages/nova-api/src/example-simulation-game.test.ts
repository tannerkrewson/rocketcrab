/**
 * A1 — the simulation-mode vertical slice: the example game executed end to
 * end.
 *
 * `examples/games/nova-drift.html` is the single-file simulation-mode game
 * this issue defines (a simple continuous 2D movement game). Its inline
 * module script is extracted and run against real session-backed `nova`
 * clients over the in-memory transport, so this suite exercises the REAL
 * simulation engine: the Nova-provided tick clock advancing every frame's
 * local simulation, ordered input routing (with the sender loop-back),
 * authoritative snapshot production from the authority frame's
 * `serializeState`, correction/restore on every frame, and restore after
 * authority migration.
 *
 * The game's DOM layer is guarded (it no-ops without a document), so the
 * exact same source that runs in the arena and real parties runs here.
 * Timing is accelerated through the documented session options
 * (`simulation.tickMs` / `snapshotIntervalMs`), which nothing sets in a
 * real host.
 */
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryTransportHub, type InMemoryTransport } from "@rocketcrab/testing";
// The single-file example game, verbatim (Vite ?raw import; the tests
// execute the exact source that runs in the arena and real parties).
import GAME_SOURCE from "../../../examples/games/nova-drift.html?raw";
import { createNovaSession, type NovaSession, type NovaSessionOptions } from "./session";

/** Extract the game's inline module script (the only part we execute). */
function extractModuleScript(html: string): string {
  const match = /<script type="module">([\s\S]*?)<\/script>/u.exec(html);
  if (match === null || match[1] === undefined) {
    throw new Error("No inline module script found in the example game.");
  }
  return match[1];
}

const GAME_SCRIPT = extractModuleScript(GAME_SOURCE);

/** Short deterministic simulation timings for the tests (real timers). */
const SIM_TIMINGS = { tickMs: 20, snapshotIntervalMs: 60 };
const AUTHORITY_TIMINGS = {
  heartbeatIntervalMs: 80,
  gracePeriodMs: 250,
  electionWindowMs: 120,
  restoreWindowMs: 120,
};

const PLAYERS: Array<{ memberId: string; name: string }> = [
  { memberId: "member-a", name: "Ada" },
  { memberId: "member-b", name: "Ben" },
];

interface World {
  hub: InMemoryTransportHub;
  sessions: NovaSession[];
  transports: InMemoryTransport[];
}

function makeWorld(): World {
  return { hub: new InMemoryTransportHub(), sessions: [], transports: [] };
}

/** The local simulation a frame runs (as the game's test seam exposes it). */
interface DriftSim {
  puck: { x: number; y: number };
}

function driftSim(): DriftSim {
  const seam = (globalThis as Record<string, unknown>).__novaDriftSeam as {
    getSim: () => DriftSim;
  };
  if (typeof seam?.getSim !== "function") {
    throw new Error("The game did not expose its test seam.");
  }
  return seam.getSim();
}

/** Create a session running the game source (extracted module script). */
function createGameSession(world: World, memberId: string, displayName: string): NovaSession {
  const transport = world.hub.createTransport({ memberId, displayName });
  world.transports.push(transport);
  const options: NovaSessionOptions = {
    transport,
    room: "drift-room",
    sessionId: "drift-session",
    player: { memberId, displayName },
    game: { gameId: "nova-drift", mode: "simulation", title: "Nova Drift" },
    simulation: SIM_TIMINGS,
    authority: AUTHORITY_TIMINGS,
  };
  const session = createNovaSession(options);
  world.sessions.push(session);
  new Function("nova", GAME_SCRIPT)(session.client);
  return session;
}

/** Drain + macrotask flush (the hub only delivers on drain()). */
async function flush(world: World): Promise<void> {
  for (let i = 0; i < 2; i += 1) {
    for (let j = 0; j < 8; j += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    world.hub.drain();
  }
  await Promise.resolve();
}

/** Poll with real time + drain until `condition` holds. */
async function waitFor(
  world: World,
  condition: () => boolean,
  what: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await flush(world);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("nova-drift (simulation-mode example game)", () => {
  const worlds: World[] = [];

  afterEach(() => {
    for (const world of worlds.splice(0)) {
      for (const session of world.sessions) {
        session.dispose();
      }
      world.hub.dispose();
    }
  });

  it("runs a multi-player continuous game over the arena transport", async () => {
    const world = makeWorld();
    worlds.push(world);
    const a = createGameSession(world, PLAYERS[0]?.memberId ?? "member-a", "Ada");
    const b = createGameSession(world, PLAYERS[1]?.memberId ?? "member-b", "Ben");
    await a.join();
    await b.join();
    await flush(world);
    a.start();
    b.start();

    // The Nova-provided clock advances both frames' local simulations.
    await waitFor(
      world,
      () => a.getSimulationDiagnostics().tick >= 3 && b.getSimulationDiagnostics().tick >= 3,
      "ticks",
    );
    expect(driftSim().puck).toEqual({ x: 400, y: 250 }); // still: no inputs

    // Ada holds ArrowRight: her input is broadcast and looped back to her
    // own frame; Ben's frame applies the same input on its next tick
    // (ordered per sender), so both local copies move together.
    a.client.simulation.sendInput({ type: "keydown", payload: { key: "ArrowRight" } });
    await waitFor(world, () => driftSim().puck.x > 400, "puck moving right");
    await waitFor(world, () => a.getSimulationDiagnostics().tick > 5, "more ticks");
    // The authoritative snapshot (from Ada's frame's serializeState) carries
    // the moved puck; every shell retains it.
    await waitFor(
      world,
      () =>
        b.getSimulationDiagnostics().snapshotsReceived >= 1 &&
        a.getSimulationDiagnostics().authorityTick !== null,
      "snapshots",
    );
    const retained = b.getSimulationSnapshot();
    expect(retained).not.toBeNull();
    expect(retained?.state).toEqual({ puck: { x: expect.any(Number), y: expect.any(Number) } });
    if (retained === null) return;
    expect((retained.state as { puck: { x: number } }).puck.x).toBeGreaterThan(400);
    expect(b.getSimulationDiagnostics().authorityMemberId).toBe("member-a");

    // Ada releases the key: the input stops the puck on every frame. The
    // local copies converge on the authoritative state (corrections may
    // pull a predicted-ahead frame back by up to one step).
    a.client.simulation.sendInput({ type: "keyup", payload: { key: "ArrowRight" } });
    await waitFor(world, () => a.getSimulationDiagnostics().tick >= 10, "post-keyup ticks");
    await waitFor(
      world,
      () => {
        const retained = b.getSimulationSnapshot();
        if (retained === null) return false;
        const authoritative = (retained.state as { puck: { x: number; y: number } }).puck;
        return driftSim().puck.x === authoritative.x && driftSim().puck.y === authoritative.y;
      },
      "convergence",
    );
  });

  it("restores a recent snapshot after authority migration", async () => {
    const world = makeWorld();
    worlds.push(world);
    const a = createGameSession(world, PLAYERS[0]?.memberId ?? "member-a", "Ada");
    const b = createGameSession(world, PLAYERS[1]?.memberId ?? "member-b", "Ben");
    await a.join();
    await b.join();
    await flush(world);
    a.start();
    b.start();
    // Let snapshots replicate before the migration.
    await waitFor(
      world,
      () => b.getSimulationDiagnostics().snapshotsReceived >= 1,
      "pre-migration snapshots",
    );
    const migratedTick = b.getSimulationDiagnostics().authorityTick;
    expect(migratedTick).toBeGreaterThanOrEqual(1);

    // Ada's tab closes: Ben is elected, restores the recent replicated
    // snapshot, and resumes producing authoritative snapshots from HIS
    // frame's state (the game keeps running; no networking code anywhere).
    await a.leave();
    await waitFor(
      world,
      () =>
        b.getSimulationDiagnostics().authorityMemberId === "member-b" &&
        b.getSimulationDiagnostics().term >= 2,
      "migration",
    );
    expect(b.getSimulationSnapshot()?.tick).toBeGreaterThanOrEqual(migratedTick ?? 0);
    const tickBefore = b.getSimulationDiagnostics().authorityTick;
    await waitFor(
      world,
      () => {
        const tick = b.getSimulationDiagnostics().authorityTick;
        return tick !== null && tick > (tickBefore ?? 0);
      },
      "post-migration snapshots",
    );
    // The new authority's frame keeps the game playable.
    b.client.simulation.sendInput({ type: "keydown", payload: { key: "ArrowDown" } });
    await waitFor(world, () => driftSim().puck.y > 250, "puck moving down after migration");
  });
});
