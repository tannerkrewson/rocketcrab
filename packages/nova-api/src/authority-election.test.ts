/**
 * S3 authority election tests (ADR-0007).
 *
 * - Engine unit tests: heartbeats, grace, deterministic election, monotonic
 *   terms, announcement reconciliation, same-revision state conflict
 *   resolution (majority hash, then tie-break), restore-from-push, and
 *   buffered-action deduplication — all with fake timers and a recording
 *   host.
 * - Session integration tests: migration when the authority's tab closes,
 *   silent-partition convergence (simultaneous suspected authority loss),
 *   suspended-authority migration (Mobile Safari), and preservation of
 *   committed actions across migration (no double commit) — over the
 *   in-memory transport with fake timers.
 * - fast-check property tests over random join/leave/disconnect/reconnect/
 *   suspend sequences, asserting single-authority convergence, state
 *   convergence, and the exactly-once marker invariant (runs in CI).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  array as fcArray,
  assert as fcAssert,
  asyncProperty,
  constantFrom as fcConstantFrom,
  integer as fcInteger,
  record as fcRecord,
} from "fast-check";
import { InMemoryTransportHub } from "@rocketcrab/testing";
import { createNovaSession, type NovaSession } from "./session";
import {
  NovaStateEngine,
  stateHashOf,
  type AuthorityAnnounceEnvelope,
  type AuthorityElectionEnvelope,
  type AuthorityHeartbeatEnvelope,
  type StateEngineEvent,
  type StateEngineHost,
  type StateSnapshotEnvelope,
  type StateViewEnvelope,
} from "./state-engine";
import { LocalGameExecutor } from "./state-executor";
import type { NovaActionAck, NovaPlayer, NovaStateHandlers } from "./types";

const THREE_PLAYERS: NovaPlayer[] = [
  { id: "member-a", name: "Ada" },
  { id: "member-b", name: "Ben" },
  { id: "member-c", name: "Cara" },
];

/** A recording host: every send/event is captured for assertions. */
class RecordingHost implements StateEngineHost {
  readonly acks: Array<{ target: string; ack: NovaActionAck }> = [];
  readonly snapshots: Array<{ target?: string; snapshot: StateSnapshotEnvelope }> = [];
  readonly views: Array<{ target: string; view: StateViewEnvelope }> = [];
  readonly announces: AuthorityAnnounceEnvelope[] = [];
  readonly heartbeats: AuthorityHeartbeatEnvelope[] = [];
  readonly elections: AuthorityElectionEnvelope[] = [];
  readonly events: StateEngineEvent[] = [];
  playersList: readonly NovaPlayer[] = THREE_PLAYERS;
  connected = new Set<string>(THREE_PLAYERS.map((player) => player.id));
  isSelfConnected = true;

  players(): readonly NovaPlayer[] {
    return [...this.playersList];
  }
  isConnected(memberId: string): boolean {
    return this.connected.has(memberId);
  }
  selfConnected(): boolean {
    return this.isSelfConnected;
  }
  eligibleMemberIds(): readonly string[] {
    return [...this.connected];
  }
  sendAck(targetMemberId: string, ack: NovaActionAck): void {
    this.acks.push({ target: targetMemberId, ack });
  }
  sendSnapshot(snapshot: StateSnapshotEnvelope, targetMemberId?: string): void {
    this.snapshots.push({ target: targetMemberId, snapshot });
  }
  sendView(targetMemberId: string, view: StateViewEnvelope): void {
    this.views.push({ target: targetMemberId, view });
  }
  sendAnnounce(announcement: AuthorityAnnounceEnvelope): void {
    this.announces.push(announcement);
  }
  sendHeartbeat(heartbeat: AuthorityHeartbeatEnvelope): void {
    this.heartbeats.push(heartbeat);
  }
  sendElection(election: AuthorityElectionEnvelope): void {
    this.elections.push(election);
  }
  emit(event: StateEngineEvent): void {
    this.events.push(event);
  }
}

/** Every engine created in this file (disposed after each test). */
const createdEngines: NovaStateEngine[] = [];

function trackEngine(engine: NovaStateEngine): NovaStateEngine {
  createdEngines.push(engine);
  return engine;
}

/** Engine timings for the fake-timer tests (deterministic + fast). */
const ENGINE_TIMINGS = {
  heartbeatIntervalMs: 100,
  gracePeriodMs: 300,
  electionWindowMs: 150,
  restoreWindowMs: 150,
};

/** The test game for engine unit tests: an increment with a by-payload. */
function incrementHandlers(): NovaStateHandlers {
  return {
    createInitialState: () => ({ count: 0 }),
    actions: {
      increment(draft: { count: number }, _context, payload: { by?: number }) {
        draft.count += payload.by ?? 1;
      },
    },
  };
}

function makeEngine(
  selfMemberId: string,
  options: Partial<{
    connected: Set<string>;
    electionWindowMs: number;
    restoreWindowMs: number;
    gracePeriodMs: number;
    heartbeatIntervalMs: number;
  }> = {},
): { engine: NovaStateEngine; host: RecordingHost } {
  const host = new RecordingHost();
  if (options.connected !== undefined) {
    host.connected = options.connected;
  }
  const engine = trackEngine(
    new NovaStateEngine({
      host,
      executor: new LocalGameExecutor(incrementHandlers()),
      selfMemberId,
      ...ENGINE_TIMINGS,
      ...(options.electionWindowMs !== undefined
        ? { electionWindowMs: options.electionWindowMs }
        : {}),
      ...(options.restoreWindowMs !== undefined
        ? { restoreWindowMs: options.restoreWindowMs }
        : {}),
      ...(options.gracePeriodMs !== undefined ? { gracePeriodMs: options.gracePeriodMs } : {}),
      ...(options.heartbeatIntervalMs !== undefined
        ? { heartbeatIntervalMs: options.heartbeatIntervalMs }
        : {}),
    }),
  );
  engine.beginGame();
  return { engine, host };
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await yieldLoop();
}

/** Seed a follower with the replicated state of authority "member-a". */
async function seedFollower(
  engine: NovaStateEngine,
  revision: number,
  state: unknown,
): Promise<void> {
  const hash = await stateHashOf(state);
  engine.handleAnnounce({ term: 1, authorityMemberId: "member-a", stateRevision: revision });
  engine.handleSnapshot({
    revision,
    stateHash: hash,
    term: 1,
    authorityMemberId: "member-a",
    processedActionIds: [],
    state,
  });
}

beforeEach(() => {
  // setImmediate stays REAL so tests can yield to the event loop for
  // real-async steps (crypto digest) while engine timers are faked.
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
});

afterEach(() => {
  for (const engine of createdEngines.splice(0)) {
    engine.dispose();
  }
  vi.useRealTimers();
});

/** Node's real macrotask (NOT faked by the test timers). */
declare function setImmediate(callback: () => void): unknown;

/** Yield one round to the real event loop (crypto digest completions). */
async function yieldLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Wait until `condition` holds. Engine async work (sha256 digests) completes
 * on the real event loop, so a fixed number of yields is racy; polling is
 * deterministic.
 */
async function waitForEngine(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 2_000; i += 1) {
    if (condition()) return;
    await yieldLoop();
  }
  throw new Error(`Timed out waiting for: ${what}`);
}

describe("NovaStateEngine S3 election machinery", () => {
  it("heartbeats on the interval and suspicion only after the grace period", async () => {
    const { engine, host } = makeEngine("member-b");
    engine.handleAnnounce({ term: 1, authorityMemberId: "member-a", stateRevision: 1 });
    // Heartbeats keep the follower past the grace period.
    for (let i = 0; i < 5; i += 1) {
      await advance(100);
      engine.handleHeartbeat({
        term: 1,
        authorityMemberId: "member-a",
        stateRevision: 1,
        heartbeatSeq: i + 1,
      });
    }
    expect(engine.getDiagnostics().electionInProgress).toBe(false);
    expect(engine.getDiagnostics().lastHeartbeatAt).not.toBeNull();
    expect(host.elections).toHaveLength(0);
    // Heartbeats stop: the grace timer expires and an election begins at the
    // next monotonic term.
    await advance(400);
    expect(engine.getDiagnostics().electionInProgress).toBe(true);
    expect(engine.getTerm()).toBe(2);
    expect(host.elections.length).toBeGreaterThan(0);
    expect(host.elections[0]?.term).toBe(2);
  });

  it("a higher-term heartbeat adopts the new authority (stale authority steps down)", async () => {
    const { engine } = makeEngine("member-b");
    engine.handleAnnounce({ term: 1, authorityMemberId: "member-a", stateRevision: 1 });
    engine.handleHeartbeat({
      term: 2,
      authorityMemberId: "member-b",
      stateRevision: 1,
      heartbeatSeq: 1,
    });
    expect(engine.getAuthorityMemberId()).toBe("member-b");
    expect(engine.getTerm()).toBe(2);
  });

  it("elects the lowest eligible member deterministically and the winner announces + restores", async () => {
    const { engine, host } = makeEngine("member-b");
    await seedFollower(engine, 1, { count: 0 });
    // The authority's connection dropped: immediate suspicion.
    host.connected.delete("member-a");
    engine.notifyAuthorityLeft();
    expect(engine.getDiagnostics().electionInProgress).toBe(true);
    // A peer campaigns at the same term during the window.
    engine.handleElection({
      term: 2,
      candidateMemberId: "member-c",
      observed: [{ memberId: "member-c", revision: 1, stateHash: "h".repeat(64) }],
    });
    await advance(150); // window ends
    // member-b is the lowest connected eligible member: it won.
    expect(engine.getAuthorityMemberId()).toBe("member-b");
    expect(engine.getTerm()).toBe(2);
    const announce = host.announces.at(-1);
    expect(announce?.term).toBe(2);
    expect(announce?.authorityMemberId).toBe("member-b");
    expect(announce?.stateRevision).toBe(1);
    // The restore window completes: re-announce + replicate the state.
    const snapshotsBefore = host.snapshots.length;
    await advance(150); // restore window
    await waitForEngine(() => host.snapshots.length > snapshotsBefore, "restore broadcast");
    expect(host.snapshots.length).toBeGreaterThan(snapshotsBefore);
    expect(engine.getCanonicalState()).toEqual({ count: 0 });
    expect(engine.getDiagnostics().electionInProgress).toBe(false);
  });

  it("restores the highest valid replicated state from a peer push before applying", async () => {
    const { engine, host } = makeEngine("member-b");
    await seedFollower(engine, 1, { count: 0 });
    host.connected.delete("member-a");
    engine.notifyAuthorityLeft();
    await advance(150); // election window: member-b wins
    // A peer pushes its higher state (rev 3) to the new authority during the
    // restore window; the winner adopts it (hash-verified at restore end).
    const hash3 = await stateHashOf({ count: 3 });
    engine.handleSnapshot({
      revision: 3,
      stateHash: hash3,
      term: 2,
      authorityMemberId: "member-b",
      processedActionIds: ["act-p1", "act-p2"],
      state: { count: 3 },
      senderMemberId: "member-c",
    });
    // A dispatch based on the highest state buffers during restore.
    engine.handleInboundAction({
      actionId: "act-buffered",
      seq: 1,
      actionType: "increment",
      payload: { by: 1 },
      baseRevision: 3,
      sentAt: 1_700_000_000_000,
      senderMemberId: "member-c",
    });
    expect(engine.getDiagnostics().pendingActionCount).toBe(1);
    await advance(150); // restore window ends: restore, then process
    await engine.flushPending();
    await waitForEngine(() => engine.getDiagnostics().revision === 4, "buffered action apply");
    expect(engine.getCanonicalState()).toEqual({ count: 4 });
    expect(engine.getDiagnostics().revision).toBe(4);
    expect(engine.getDiagnostics().processedActionCount).toBe(3); // p1, p2, buffered
    const acks = host.acks.filter((ack) => ack.ack.actionId === "act-buffered");
    expect(acks).toHaveLength(1); // exactly-once ack
  });

  it("deduplicates buffered actions during restore (no double commit)", async () => {
    const { engine, host } = makeEngine("member-b");
    await seedFollower(engine, 1, { count: 0 });
    host.connected.delete("member-a");
    engine.notifyAuthorityLeft();
    await advance(150); // member-b wins the election
    engine.handleInboundAction({
      actionId: "act-dup",
      seq: 1,
      actionType: "increment",
      payload: {},
      baseRevision: 1,
      sentAt: 1_700_000_000_000,
      senderMemberId: "member-c",
    });
    engine.handleInboundAction({
      actionId: "act-dup",
      seq: 1,
      actionType: "increment",
      payload: {},
      baseRevision: 1,
      sentAt: 1_700_000_000_000,
      senderMemberId: "member-c",
    });
    await advance(150); // restore window
    await engine.flushPending();
    await waitForEngine(() => engine.getDiagnostics().revision === 2, "single buffered apply");
    expect(engine.getDiagnostics().revision).toBe(2);
    expect(engine.getCanonicalState()).toEqual({ count: 1 });
    expect(host.acks.filter((ack) => ack.ack.actionId === "act-dup")).toHaveLength(1);
  });

  it("reconciles conflicting announcements: higher term, then revision, then member id", async () => {
    const { engine } = makeEngine("member-c");
    // Same term, lower revision loses.
    engine.handleAnnounce({ term: 2, authorityMemberId: "member-b", stateRevision: 5 });
    expect(engine.getAuthorityMemberId()).toBe("member-b");
    engine.handleAnnounce({ term: 2, authorityMemberId: "member-a", stateRevision: 4 });
    expect(engine.getAuthorityMemberId()).toBe("member-b");
    // Same term, higher revision wins.
    engine.handleAnnounce({ term: 2, authorityMemberId: "member-a", stateRevision: 6 });
    expect(engine.getAuthorityMemberId()).toBe("member-a");
    // Equal revision falls to the lower member id (a < b).
    engine.handleAnnounce({ term: 2, authorityMemberId: "member-b", stateRevision: 6 });
    expect(engine.getAuthorityMemberId()).toBe("member-a");
    // A strictly higher term always wins.
    engine.handleAnnounce({ term: 3, authorityMemberId: "member-b", stateRevision: 5 });
    expect(engine.getAuthorityMemberId()).toBe("member-b");
    expect(engine.getTerm()).toBe(3);
    // A stale term is ignored.
    engine.handleAnnounce({ term: 2, authorityMemberId: "member-a", stateRevision: 9 });
    expect(engine.getAuthorityMemberId()).toBe("member-b");
  });

  it("resolves same-revision state conflicts by majority hash, then tie-break", async () => {
    const { engine, host } = makeEngine("member-a");
    const hashX = "x".repeat(64);
    const hashY = "y".repeat(64);
    // a is the authority at term 2 with state rev 5 (hash X, reported by a).
    engine.handleAnnounce({
      term: 2,
      authorityMemberId: "member-a",
      stateRevision: 5,
      stateHash: hashX,
    });
    engine.handleSnapshot({
      revision: 5,
      stateHash: hashX,
      term: 2,
      authorityMemberId: "member-a",
      processedActionIds: [],
      state: { from: "a" },
    });
    // A push from b at the same revision with a conflicting hash (Y): 1-1
    // vote, tie-break is the lowest reporting member id — a reported X, so
    // X is kept and the authority pulls the sender toward X.
    engine.handleSnapshot({
      revision: 5,
      stateHash: hashY,
      term: 2,
      authorityMemberId: "member-a",
      processedActionIds: [],
      state: { from: "b" },
      senderMemberId: "member-b",
    });
    expect(engine.getCanonicalState()).toEqual({ from: "a" });
    expect(host.snapshots.some((entry) => entry.target === "member-b")).toBe(true);
    // Now a third member reports Y (election observation): Y becomes the
    // majority hash and wins the next conflict.
    engine.handleElection({
      term: 2,
      candidateMemberId: "member-c",
      observed: [{ memberId: "member-c", revision: 5, stateHash: hashY }],
    });
    engine.handleSnapshot({
      revision: 5,
      stateHash: hashY,
      term: 2,
      authorityMemberId: "member-a",
      processedActionIds: [],
      state: { from: "b" },
      senderMemberId: "member-c",
    });
    expect(engine.getCanonicalState()).toEqual({ from: "b" });
  });

  it("pushes a higher replicated state to a newly announced authority", async () => {
    const { engine, host } = makeEngine("member-c");
    await seedFollower(engine, 5, { count: 5 });
    engine.handleAnnounce({ term: 2, authorityMemberId: "member-b", stateRevision: 3 });
    expect(engine.getAuthorityMemberId()).toBe("member-b");
    const push = host.snapshots.find((entry) => entry.target === "member-b");
    expect(push?.snapshot.revision).toBe(5);
    expect(push?.snapshot.term).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Session integration tests (in-memory transport + fake timers)
// ---------------------------------------------------------------------------

const ROOM = "party:s3";
const SESSION = "session-s3";
const FAST_TIMINGS = { ...ENGINE_TIMINGS };

/** The test game: applies each dispatched action exactly once into `markers`. */
function s3GameHandlers(): NovaStateHandlers {
  return {
    createInitialState: () => ({ count: 0, markers: [] as string[] }),
    actions: {
      mark(draft: { count: number; markers: string[] }, _context, payload: { marker?: string }) {
        draft.count += 1;
        draft.markers.push(payload.marker ?? `m${draft.count}`);
      },
    },
  };
}

function makeSession(hub: InMemoryTransportHub, memberId: string): NovaSession {
  return createNovaSession({
    transport: hub.createTransport({ memberId, displayName: memberId }),
    room: ROOM,
    sessionId: SESSION,
    player: { memberId, displayName: memberId },
    game: { gameId: "game-1", mode: "state", title: "S3 Game" },
    authority: FAST_TIMINGS,
  });
}

/** Deliver everything queued and let real-async steps (crypto) complete. */
async function pump(hub: InMemoryTransportHub): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    hub.drain();
    await yieldLoop();
  }
}

/** Pump until `condition` holds (deterministic under fake timers). */
async function pumpUntil(
  hub: InMemoryTransportHub,
  condition: () => boolean,
  what: string,
): Promise<void> {
  for (let i = 0; i < 2_000; i += 1) {
    hub.drain();
    if (condition()) {
      // Settle follow-up messages (acks, convergence re-broadcasts) before
      // returning, so promises that resolve on acks are settled too.
      for (let j = 0; j < 6; j += 1) {
        hub.drain();
        await yieldLoop();
      }
      return;
    }
    await yieldLoop();
  }
  throw new Error(`Timed out pumping for: ${what}`);
}

/** Advance fake time through an election window + restore window with pumps. */
async function settleElection(hub: InMemoryTransportHub): Promise<void> {
  await advance(250);
  await pump(hub);
  await advance(250);
  await pump(hub);
}

/** Destructure a three-session party (noUncheckedIndexedAccess helper). */
function trio(sessions: NovaSession[]): [NovaSession, NovaSession, NovaSession] {
  return [sessions[0]!, sessions[1]!, sessions[2]!];
}

async function startParty(hub: InMemoryTransportHub, sessions: NovaSession[]): Promise<void> {
  for (const session of sessions) {
    session.client.defineGame({ title: "S3 Game", mode: "state", ...s3GameHandlers() });
    await session.join();
  }
  await pump(hub);
  for (const session of sessions) {
    session.start();
  }
  await pumpUntil(
    hub,
    () =>
      sessions.every(
        (session) =>
          session.isStarted() &&
          session.getStateModeDiagnostics().authorityMemberId !== null &&
          session.getStateModeDiagnostics().revision === 1,
      ),
    "initial start + replication",
  );
}

/**
 * A test hub whose deliveries happen ONLY on explicit drain(): the default
 * scheduler arms a (faked) timer, so advancing fake time would deliver
 * heartbeats mid-partition. A no-op scheduler makes the fake-time partition
 * deterministic — nothing delivers until the test calls drain/pump.
 */
function newTestHub(seed: string): InMemoryTransportHub {
  return new InMemoryTransportHub({
    seed,
    schedule: () => () => undefined,
  });
}

async function makeParty(memberIds: string[]): Promise<{
  hub: InMemoryTransportHub;
  sessions: NovaSession[];
}> {
  const hub = newTestHub(`s3-${memberIds.join("-")}`);
  const sessions = memberIds.map((id) => makeSession(hub, id));
  await startParty(hub, sessions);
  return { hub, sessions };
}

describe("S3 authority migration over the transport", () => {
  it("continues a state-mode game after the authority closes its tab", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    expect(a.getStateModeDiagnostics().authorityMemberId).toBe("member-a");

    // The authority closes its tab: the remaining members suspect immediately
    // and elect deterministically (lowest eligible member).
    await a.leave();
    await pumpUntil(hub, () => b.getStateModeDiagnostics().electionInProgress, "suspicion");
    expect(b.getStateModeDiagnostics().authorityMemberId).toBeNull();
    await settleElection(hub);
    await pumpUntil(
      hub,
      () =>
        b.getStateModeDiagnostics().authorityMemberId === "member-b" &&
        c.getStateModeDiagnostics().authorityMemberId === "member-b",
      "migration to member-b",
    );
    expect(b.getStateModeDiagnostics().term).toBe(2);

    // The game continues with the new authority.
    const dispatched = c.client.dispatch({ type: "mark", payload: { marker: "m1" } });
    await pumpUntil(hub, () => b.getStateModeDiagnostics().revision === 2, "m1 applies");
    await expect(dispatched).resolves.toBeUndefined();
    expect(b.getCanonicalState()?.state).toMatchObject({ markers: ["m1"], count: 1 });
  });

  it("preserves committed actions across migration and never commits twice", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    const p1 = a.client.dispatch({ type: "mark", payload: { marker: "m1" } });
    await pumpUntil(hub, () => a.getStateModeDiagnostics().revision === 2, "m1 applies");
    await expect(p1).resolves.toBeUndefined();
    const p2 = b.client.dispatch({ type: "mark", payload: { marker: "m2" } });
    await pumpUntil(hub, () => a.getStateModeDiagnostics().revision === 3, "m2 applies");
    await expect(p2).resolves.toBeUndefined();

    await a.leave();
    await settleElection(hub);
    await pumpUntil(
      hub,
      () =>
        b.getStateModeDiagnostics().authorityMemberId === "member-b" &&
        b.getCanonicalState() !== null &&
        c.getCanonicalState() !== null,
      "migration with replicated state",
    );
    // Both committed actions survive the migration, exactly once each.
    expect(b.getCanonicalState()?.state).toEqual({ count: 2, markers: ["m1", "m2"] });
    expect(c.getCanonicalState()?.state).toEqual(b.getCanonicalState()?.state);

    const p3 = c.client.dispatch({ type: "mark", payload: { marker: "m3" } });
    await pumpUntil(hub, () => b.getStateModeDiagnostics().revision === 4, "m3 applies");
    await expect(p3).resolves.toBeUndefined();
    expect(b.getCanonicalState()?.state).toEqual({
      count: 3,
      markers: ["m1", "m2", "m3"],
    });
  });

  it("buffers dispatches during the election and applies them after restore", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, , c] = trio(sessions);
    await a.leave();
    await pump(hub);
    // A dispatch made while no authority is known buffers until the new
    // authority is announced, then applies exactly once.
    const dispatched = c.client.dispatch({ type: "mark", payload: { marker: "buffered" } });
    await settleElection(hub);
    await pumpUntil(
      hub,
      () =>
        c.getStateModeDiagnostics().authorityMemberId === "member-b" &&
        c.getCanonicalState()?.state !== null &&
        (c.getCanonicalState()?.state as { count?: number } | null)?.count === 1,
      "buffered dispatch applies",
    );
    await expect(dispatched).resolves.toBeUndefined();
    expect(c.getCanonicalState()?.state).toMatchObject({
      count: 1,
      markers: ["buffered"],
    });
  });

  it("converges after a silent partition: simultaneous suspicion, one authority on merge", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    expect(a.getStateModeDiagnostics().authorityMemberId).toBe("member-a");

    // Partition: withhold delivery while fake time passes. Both followers
    // miss heartbeats, suspect simultaneously, and campaign (their messages
    // sit undelivered); the authority keeps committing locally.
    await advance(400);
    console.error(
      "DBG after partition b.term",
      b.getStateModeDiagnostics().term,
      "b.election",
      b.getStateModeDiagnostics().electionInProgress,
      "b.authority",
      b.getStateModeDiagnostics().authorityMemberId,
      "c.term",
      c.getStateModeDiagnostics().term,
    );
    const aSide = a.client.dispatch({ type: "mark", payload: { marker: "a-side" } });
    // Attach the rejection handler immediately (no unhandled rejection).
    const cSide = c.client.dispatch({ type: "mark", payload: { marker: "c-side" } }).then(
      () => "accepted",
      (error: unknown) => error,
    );
    await advance(100);
    await pumpUntil(hub, () => a.getStateModeDiagnostics().revision === 2, "local commit");
    await expect(aSide).resolves.toBeUndefined(); // local commit on the authority

    // Merge: deliver everything; the campaigns reach the authority, which
    // steps down, campaigns at the higher term, and is re-elected (possibly
    // after a winner-wait re-election round, since the authority missed the
    // campaigns while it believed it was still authoritative).
    await pump(hub);
    for (let i = 0; i < 30; i += 1) {
      await advance(100);
      await pump(hub);
    }
    // c's partition-era dispatch was buffered with a base revision that the
    // authority's restored state (rev 2, with a-side) has already moved past:
    // it is rejected as stale rather than silently rebased or double-applied.
    await pumpUntil(
      hub,
      () =>
        b.getStateModeDiagnostics().authorityMemberId === "member-a" &&
        c.getStateModeDiagnostics().authorityMemberId === "member-a" &&
        b.getCanonicalState() !== null,
      "partition merge converges",
    );
    const cSideOutcome = await cSide;
    expect(cSideOutcome).toMatchObject({ code: "stale_revision" });

    // Exactly one authority, and every shell converged on the same state.
    // (The term is >= 2: the merge may re-elect once if the winner needed a
    // re-election round to learn about the campaign.)
    expect(a.getStateModeDiagnostics().term).toBeGreaterThanOrEqual(2);
    expect(a.getCanonicalState()?.state).toEqual(b.getCanonicalState()?.state);
    expect(c.getCanonicalState()?.state).toEqual(b.getCanonicalState()?.state);
    expect(b.getCanonicalState()?.state).toEqual({ count: 1, markers: ["a-side"] });
    // The game continues: a fresh dispatch based on the converged state works.
    const p = c.client.dispatch({ type: "mark", payload: { marker: "c-side" } });
    await pumpUntil(
      hub,
      () => (b.getCanonicalState()?.state as { count?: number } | null)?.count === 2,
      "post-merge dispatch applies",
    );
    await expect(p).resolves.toBeUndefined();
    expect(b.getCanonicalState()?.state).toEqual({
      count: 2,
      markers: ["a-side", "c-side"],
    });
  });

  it("migrates while the authority is suspended and the old authority rejoins as a follower", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    // Background suspension (Mobile Safari): the connection drops.
    await a.transport.suspend();
    await pumpUntil(hub, () => b.getStateModeDiagnostics().electionInProgress, "suspicion");
    await settleElection(hub);
    await pumpUntil(
      hub,
      () =>
        b.getStateModeDiagnostics().authorityMemberId === "member-b" &&
        c.getStateModeDiagnostics().authorityMemberId === "member-b",
      "migration while suspended",
    );

    // The suspended authority resumes with a fresh connection: its old-term
    // re-announcement is stale; it adopts the new term's authority.
    await a.transport.resume();
    await pump(hub);
    await settleElection(hub);
    await pumpUntil(
      hub,
      () =>
        a.getStateModeDiagnostics().authorityMemberId === "member-b" &&
        a.getCanonicalState() !== null,
      "old authority rejoins as follower",
    );
    expect(a.getStateModeDiagnostics().term).toBe(2);

    // The party continues under the migrated authority.
    const dispatched = c.client.dispatch({ type: "mark", payload: { marker: "after-resume" } });
    await pumpUntil(
      hub,
      () =>
        (b.getCanonicalState()?.state as { count?: number } | null)?.count === 1 &&
        a.getCanonicalState()?.state !== null,
      "dispatch after migration",
    );
    await expect(dispatched).resolves.toBeUndefined();
    expect(b.getCanonicalState()?.state).toEqual({ count: 1, markers: ["after-resume"] });
    expect(a.getCanonicalState()?.state).toEqual(b.getCanonicalState()?.state);
  });
});

// ---------------------------------------------------------------------------
// fast-check property tests
// ---------------------------------------------------------------------------

const PROPERTY_OPS = fcRecord({
  op: fcConstantFrom("dispatch", "advance", "drain", "drop", "suspend", "resume", "leave"),
  player: fcInteger({ min: 0, max: 2 }),
  amount: fcInteger({ min: 20, max: 250 }),
});

/** Run one random scenario and assert the S3 invariants hold. */
async function runPropertyScenario(
  ops: Array<{
    op: string;
    player: number;
    amount: number;
  }>,
): Promise<void> {
  const hub = newTestHub("s3-property");
  const sessions = ["member-a", "member-b", "member-c"].map((id) => makeSession(hub, id));
  let marker = 0;
  const outcomes = new Map<string, string>();
  const received = new Map<string, string[]>();
  try {
    await startParty(hub, sessions);
    for (const session of sessions) {
      session.transport.on("message:received", (message) => {
        const list = received.get(session.player.id) ?? [];
        const payload = message.payload as {
          type?: string;
          actionId?: string;
          revision?: number;
          processedActionIds?: string[];
        };
        list.push(
          `${payload.type ?? "?"}${payload.actionId !== undefined ? ":" + payload.actionId : ""}${payload.revision !== undefined ? "@" + payload.revision : ""}${payload.processedActionIds !== undefined ? "#" + payload.processedActionIds.length : ""}`,
        );
        received.set(session.player.id, list);
      });
    }
    for (const op of ops) {
      const session = sessions[op.player % 3];
      if (session === undefined) throw new Error("no session");
      switch (op.op) {
        case "dispatch":
          if (session.connectionStatus !== "disconnected") {
            const id = `m${marker}`;
            marker += 1;
            // Fire-and-forget: rejections (e.g. timed_out, stale_revision)
            // are legitimate outcomes the invariants tolerate.
            void session.client
              .dispatch({ type: "mark", payload: { marker: id } })
              .then(() => {
                outcomes.set(id, "accepted");
              })
              .catch((error: unknown) => {
                outcomes.set(id, (error as { code?: string }).code ?? "rejected");
              });
          }
          break;
        case "advance":
          await advance(op.amount);
          break;
        case "drain":
          hub.drain();
          break;
        case "drop":
          if (session.transport.connectionState === "connected") {
            await session.transport.reconnect();
          }
          break;
        case "suspend":
          if (session.transport.connectionState === "connected") {
            await session.transport.suspend();
          }
          break;
        case "resume":
          if (session.transport.connectionState === "suspended") {
            await session.transport.resume();
          }
          break;
        case "leave":
          if (session.transport.connectionState !== "idle") {
            await session.leave();
          }
          break;
      }
      await pump(hub);
    }
    // Final settle: advance in small steps with a pump between, so heartbeats
    // are delivered and the grace period never spuriously expires while every
    // election/restore cascade completes (delivery is drain-only in tests).
    for (let i = 0; i < 50; i += 1) {
      await advance(100);
      await pump(hub);
    }
    await pumpUntil(
      hub,
      () =>
        sessions
          .filter((session) => session.transport.connectionState === "connected")
          .every((session) => !session.getStateModeDiagnostics().electionInProgress),
      "elections settle",
    );
    await pump(hub);
    // Dispatch promises settle when their acks arrive (or time out in fake
    // time); every promise already has a .catch handler, so nothing hangs.

    // Invariants over connected started shells.
    const connected = sessions.filter(
      (session) => session.transport.connectionState === "connected" && session.isStarted(),
    );
    if (connected.length === 0) return;

    // Exactly one agreed authority, and it is a connected member.
    const authorities = connected.map(
      (session) => session.getStateModeDiagnostics().authorityMemberId,
    );
    const known = authorities.filter((authority) => authority !== null);
    if (known.length > 0) {
      const unique = new Set(known);
      expect(unique.size).toBe(1);
      const authority = known[0];
      if (authority !== null) {
        expect(connected.some((session) => session.player.id === authority)).toBe(true);
      }
    }

    // Converged canonical state across every connected shell. The history
    // (`processedActionIds`) is deliberately excluded: the authority's own
    // history includes its rejections, which followers legitimately lack —
    // the replicated STATE (state + revision + hash) is what must converge.
    const withState = connected.filter((session) => session.getCanonicalState() !== null);
    const states = withState.map((session) => session.getCanonicalState());
    if (states.length > 0) {
      const serialized = states.map((state) =>
        JSON.stringify({
          state: state?.state,
          revision: state?.revision,
          stateHash: state?.stateHash,
        }),
      );
      for (let i = 0; i < serialized.length; i += 1) {
        const value = serialized[i];
        if (value !== serialized[0]) {
          const detail = withState
            .map((session) => {
              const d = session.getStateModeDiagnostics();
              const engine = (
                session as unknown as {
                  engine: { history: Map<string, unknown>; queue: unknown[]; restoreDone: boolean };
                }
              ).engine;
              return `${session.player.id}: rev=${d.revision} hash=${String(d.stateHash).slice(0, 8)} authority=${String(d.authorityMemberId)} term=${d.term} electing=${d.electionInProgress} hist=${JSON.stringify([...engine.history.keys()])} queue=${engine.queue.length} restoreDone=${engine.restoreDone}`;
            })
            .join(" | ");
          throw new Error(
            `state divergence: ${value} vs ${serialized[0]}; sessions: ${detail}; outcomes: ${JSON.stringify([...outcomes])}; ops: ${JSON.stringify(ops)}; received: ${JSON.stringify([...received])}`,
          );
        }
      }
      const canonical = states[0] as { state: { count: number; markers: string[] } } | null;
      if (canonical !== null) {
        // Exactly-once: every applied action contributed exactly one marker.
        expect(canonical.state.markers.length).toBe(canonical.state.count);
        expect(new Set(canonical.state.markers).size).toBe(canonical.state.markers.length);
      }
    }
  } finally {
    for (const session of sessions) {
      session.dispose();
    }
    hub.dispose();
  }
}

describe("S3 authority election property tests", () => {
  it("converges to one authority with consistent state and no double commits", async () => {
    await fcAssert(
      asyncProperty(fcArray(PROPERTY_OPS, { maxLength: 25 }), async (ops) => {
        await runPropertyScenario(ops as Array<{ op: string; player: number; amount: number }>);
      }),
      { numRuns: 25 },
    );
  });
});
