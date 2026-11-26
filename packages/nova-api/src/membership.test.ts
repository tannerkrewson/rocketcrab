/**
 * playerJoined / playerLeft: run once on the authority, in order with
 * actions; a leave waits out the grace period, and a new authority reports
 * the old one's leave from the replicated roster.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryTransportHub, type InMemoryTransport } from "@rocketcrab/testing";
import { createNovaSession, type NovaSession } from "./session";
import { useRealTime, useSimulatedTime } from "./simulated-time.test-helper";

const GRACE_MS = 1_000;

interface Seats {
  seats: string[];
  log: string[];
}

const hubs: InMemoryTransportHub[] = [];
const sessions: NovaSession[] = [];

beforeEach(() => useSimulatedTime());
afterEach(() => {
  useRealTime();
  for (const session of sessions.splice(0)) session.dispose();
  for (const hub of hubs.splice(0)) hub.dispose();
});

function player(
  hub: InMemoryTransportHub,
  memberId: string,
): { session: NovaSession; transport: InMemoryTransport } {
  const transport = hub.createTransport({ memberId, displayName: memberId });
  const session = createNovaSession({
    transport,
    room: "seats",
    sessionId: "seats",
    player: { memberId, displayName: memberId },
    game: { gameId: "seats" },
    authority: { playerLeaveGraceMs: GRACE_MS, gracePeriodMs: 500, heartbeatIntervalMs: 100 },
  });
  sessions.push(session);
  session.client.defineGame({
    title: "Seats",
    createInitialState: (context): Seats => ({
      seats: context.players.map((p) => p.id),
      log: [],
    }),
    actions: { noop() {} },
    playerJoined(state: Seats, _context, joined) {
      state.seats.push(joined.id);
      state.log.push(`joined ${joined.id}`);
    },
    playerLeft(state: Seats, _context, left) {
      state.seats = state.seats.filter((id) => id !== left.id);
      state.log.push(`left ${left.id}`);
    },
  });
  return { session, transport };
}

function seatsOf(session: NovaSession): Seats {
  return session.getCanonicalState()?.state as Seats;
}

async function settle(hub: InMemoryTransportHub, ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 10) {
    hub.drain();
    await vi.advanceTimersByTimeAsync(10);
  }
  hub.drain();
}

async function startedParty(ids: string[]) {
  const hub = new InMemoryTransportHub();
  hubs.push(hub);
  const players = ids.map((id) => player(hub, id));
  for (const { session } of players) await session.join();
  await settle(hub, 50);
  for (const { session } of players) session.start();
  await settle(hub, 200);
  return { hub, players };
}

describe("membership handlers", () => {
  it("tells the game about a late joiner once, on every device", async () => {
    const { hub, players } = await startedParty(["member-a", "member-b"]);
    expect(seatsOf(players[0]!.session).seats).toEqual(["member-a", "member-b"]);
    const late = player(hub, "member-c");
    await late.session.join();
    await settle(hub, 300);
    for (const { session } of [...players, late]) {
      expect(seatsOf(session).log).toEqual(["joined member-c"]);
      expect(seatsOf(session).seats).toEqual(["member-a", "member-b", "member-c"]);
    }
  });

  it("waits out the grace period before a leave, and a quick return cancels it", async () => {
    const { hub, players } = await startedParty(["member-a", "member-b"]);
    const [a, b] = players as [(typeof players)[0], (typeof players)[0]];
    await b.transport.suspend();
    await settle(hub, GRACE_MS / 2);
    await b.transport.resume();
    await settle(hub, GRACE_MS * 2);
    expect(seatsOf(a.session).log).toEqual([]);

    await b.session.leave();
    await settle(hub, GRACE_MS / 2);
    expect(seatsOf(a.session).log).toEqual([]);
    await settle(hub, GRACE_MS);
    expect(seatsOf(a.session).log).toEqual(["left member-b"]);
  });

  it("reports the departed authority's leave from the new authority", async () => {
    const { hub, players } = await startedParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = players as [(typeof players)[0], (typeof players)[0], (typeof players)[0]];
    expect(a.session.getStateModeDiagnostics().authorityMemberId).toBe("member-a");
    await a.session.leave();
    await settle(hub, GRACE_MS * 3);
    expect(b.session.getStateModeDiagnostics().authorityMemberId).toBe("member-b");
    for (const { session } of [b, c]) {
      expect(seatsOf(session).log).toEqual(["left member-a"]);
      expect(seatsOf(session).seats).toEqual(["member-b", "member-c"]);
    }
  });

  it("never runs a membership handler for a dispatched action", async () => {
    const { hub, players } = await startedParty(["member-a", "member-b"]);
    const b = players[1]!.session;
    const result = b.client
      .dispatch({ type: "nova:playerLeft", payload: { id: "member-a", name: "member-a" } })
      .catch((error: { code: string }) => error.code);
    await settle(hub, 200);
    expect(await result).toBe("unknown_action");
    expect(seatsOf(b).log).toEqual([]);
  });
});

describe("leaderId", () => {
  it("names the party host to handlers and clients, and follows a new host", async () => {
    const hub = new InMemoryTransportHub();
    hubs.push(hub);
    // The creator (b) leads while connected, then the lowest remaining id.
    let creatorHere = true;
    const isHost = (id: string) => (creatorHere ? id === "member-b" : id === "member-a");
    const leaders: Array<string | null> = [];
    const players = ["member-a", "member-b"].map((memberId) => {
      const session = createNovaSession({
        transport: hub.createTransport({ memberId, displayName: memberId }),
        room: "leader",
        sessionId: "leader",
        player: { memberId, displayName: memberId },
        game: { gameId: "leader" },
        isHost,
      });
      sessions.push(session);
      session.client.defineGame({
        createInitialState: () => ({ pack: "family" }),
        actions: {
          setPack(state: { pack: string }, context, pack: string) {
            if (context.actor?.id !== context.leaderId) throw new Error("Only the leader.");
            leaders.push(context.leaderId);
            state.pack = pack;
          },
        },
      });
      return session;
    });
    const [a, b] = players as [NovaSession, NovaSession];
    for (const session of players) await session.join();
    await settle(hub, 50);
    for (const session of players) session.start();
    await settle(hub, 200);
    expect(a.client.leaderId).toBe("member-b");
    expect(b.client.leaderId).toBe("member-b");

    const refused = a.client.dispatch({ type: "setPack", payload: "adult" }).catch(() => "refused");
    await settle(hub, 100);
    expect(await refused).toBe("refused");
    void b.client.dispatch({ type: "setPack", payload: "party" });
    await settle(hub, 100);
    expect(leaders).toEqual(["member-b"]);
    expect((a.getCanonicalState()?.state as { pack: string }).pack).toBe("party");

    creatorHere = false;
    await b.leave();
    await settle(hub, 100);
    expect(a.client.leaderId).toBe("member-a");
  });
});
