/**
 * S1 session attach tests (P4 party lobby).
 *
 * `NovaSession.attach()` wires a session to a transport the party layer has
 * ALREADY joined (the P2/P3 `createParty`/`joinPartyByCode` flows join the
 * private room internally). These tests verify the session observes the
 * party it missed during transport establishment: current peers are
 * replayed, the connection status is seeded, and a peer that introduces
 * itself after our readiness announcement still learns we are ready
 * (the late-attach ready race).
 */
import { describe, expect, it } from "vitest";
import type { NovaTransport } from "@rocketcrab/core";
import { InMemoryTransportHub } from "@rocketcrab/testing";
import { createNovaSession, type NovaSession } from "./session";

const ROOM = "party:attach-room";
const SESSION = "session-attach";

async function settle(hub: InMemoryTransportHub): Promise<void> {
  hub.drain();
  await Promise.resolve();
  hub.drain();
  await Promise.resolve();
}

/** A hub with two transports already joined (as the party layer would). */
async function makeJoinedPair(): Promise<{
  hub: InMemoryTransportHub;
  transportA: NovaTransport;
  transportB: NovaTransport;
}> {
  const hub = new InMemoryTransportHub({ seed: "nova-api-attach" });
  const transportA = hub.createTransport({ memberId: "member-a", displayName: "Ada" });
  const transportB = hub.createTransport({ memberId: "member-b", displayName: "Ben" });
  await transportA.join({ room: ROOM, sessionId: SESSION });
  await transportB.join({ room: ROOM, sessionId: SESSION });
  hub.drain();
  return { hub, transportA, transportB };
}

function makeSession(transport: NovaTransport, memberId: string, displayName: string): NovaSession {
  return createNovaSession({
    transport,
    room: ROOM,
    sessionId: SESSION,
    player: { memberId, displayName },
    game: { gameId: "game-1", mode: "state", title: "Attach Game" },
  });
}

describe("NovaSession.attach (already-joined transport)", () => {
  it("seeds the connection status and never calls transport.join", async () => {
    const { hub, transportA, transportB } = await makeJoinedPair();
    const a = makeSession(transportA, "member-a", "Ada");
    const b = makeSession(transportB, "member-b", "Ben");
    // Attaching to an already-joined transport must not throw the
    // "already joined" error transport.join() would raise.
    await a.attach();
    await b.attach();
    await settle(hub);
    expect(a.connectionStatus).toBe("connected");
    expect(b.connectionStatus).toBe("connected");
  });

  it("replays current peers so the session sees the party it missed", async () => {
    const { hub, transportA, transportB } = await makeJoinedPair();
    // A's session is created after B already joined the room: attach must
    // replay B into A's player list.
    const a = makeSession(transportA, "member-a", "Ada");
    await a.attach();
    expect(a.players).toContainEqual({ id: "member-b", name: "Ben" });

    // B attaches next: it missed A.
    const b = makeSession(transportB, "member-b", "Ben");
    await b.attach();
    expect(b.players).toContainEqual({ id: "member-a", name: "Ada" });
    await settle(hub);
    expect(a.players).toContainEqual({ id: "member-b", name: "Ben" });
    expect(b.players).toContainEqual({ id: "member-a", name: "Ada" });
  });

  it("a late-attaching peer still learns our readiness (identity re-announce)", async () => {
    const { hub, transportA, transportB } = await makeJoinedPair();
    // A is already ready before B's session exists (host registered early
    // and announced ready at party creation time).
    const a = makeSession(transportA, "member-a", "Ada");
    await a.attach();
    a.ready();
    await settle(hub);

    // B's session attaches afterwards; A's targeted readiness announcement
    // was already delivered, so B must learn A's readiness when its attach
    // introduces it to A (player.identity → targeted game.ready re-send).
    const b = makeSession(transportB, "member-b", "Ben");
    await b.attach();
    await settle(hub);

    expect(b.readyOf("member-a")).toBe(true);
    expect(a.readyOf("member-b")).toBe(false); // B has not announced yet
    b.ready();
    await settle(hub);
    expect(a.readyOf("member-b")).toBe(true);
  });
});
