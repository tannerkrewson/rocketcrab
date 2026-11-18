/**
 * Authority election tests (ADR-0007).
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
import { actionTimeoutMs, stateResyncMinIntervalMs } from "@rocketcrab/protocol";
import { InMemoryTransportHub } from "@rocketcrab/testing";
import { createNovaSession, type NovaSession } from "./session";
import { STATE_HISTORY_LIMIT as STATE_WINDOW_LIMIT } from "./state-engine";
import {
  NovaStateEngine,
  stateHashOf,
  type AuthorityAnnounceEnvelope,
  type AuthorityElectionEnvelope,
  type AuthorityHeartbeatEnvelope,
  type StateEngineEvent,
  type StateEngineHost,
  type StateResyncEnvelope,
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
  controls(): Record<string, unknown> {
    return {};
  }
  readonly acks: Array<{ target: string; ack: NovaActionAck }> = [];
  readonly snapshots: Array<{ target?: string; snapshot: StateSnapshotEnvelope }> = [];
  readonly views: Array<{ target: string; view: StateViewEnvelope }> = [];
  readonly resyncs: Array<{ target: string; request: StateResyncEnvelope }> = [];
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
  sendResync(targetMemberId: string, request: StateResyncEnvelope): void {
    this.resyncs.push({ target: targetMemberId, request });
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
    stateHash: (value: unknown) => Promise<string>;
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
      ...(options.stateHash !== undefined ? { stateHash: options.stateHash } : {}),
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
    historyMode: "full",
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
 * Wall-clock budget for engine/pump waits. The engine's real-async work
 * (sha256 digests) slows down arbitrarily under CPU contention in parallel
 * CI runs, so a fixed poll-count budget is unreliable.
 * `performance.now` is NOT faked by the test timers, so a generous
 * wall-clock deadline is deterministic; the loops exit as soon as the
 * condition holds, so the budget is only consumed when something is
 * genuinely wedged.
 */
const WAIT_BUDGET_MS = 30_000;
/** Actions run past the dedup window in the migration test. */
const STATE_WINDOW_PROBE = STATE_WINDOW_LIMIT + 4;

/**
 * Wait until `condition` holds. Engine async work (sha256 digests) completes
 * on the real event loop, so a fixed number of yields is racy; polling is
 * deterministic — bounded by wall-clock time rather than poll count.
 */
async function waitForEngine(condition: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + WAIT_BUDGET_MS;
  while (performance.now() < deadline) {
    if (condition()) return;
    await yieldLoop();
  }
  throw new Error(`Timed out waiting for: ${what}`);
}

describe(
  "NovaStateEngine S3 election machinery",
  // Wall-clock waits (WAIT_BUDGET_MS) can legitimately exceed vitest's 5s
  // default under CPU contention in parallel runs.
  { timeout: 60_000 },
  () => {
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

    it("ignores heartbeat and election claims from disconnected members or stale terms", async () => {
      const { engine, host } = makeEngine("member-b");
      await seedFollower(engine, 1, { count: 0 });
      engine.handleAnnounce({ term: 1, authorityMemberId: "member-a", stateRevision: 1 });
      expect(engine.getAuthorityMemberId()).toBe("member-a");

      // Disconnected claimants are not evidence, whatever the term says.
      host.connected.delete("member-c");
      engine.handleHeartbeat({
        term: 5,
        authorityMemberId: "member-c",
        stateRevision: 1,
        heartbeatSeq: 1,
      });
      engine.handleElection({
        term: 6,
        candidateMemberId: "member-c",
        observed: [{ memberId: "member-c", revision: 9 }],
      });
      expect(engine.getTerm()).toBe(1);
      expect(engine.getAuthorityMemberId()).toBe("member-a");

      // A connected higher-term claim still adopts.
      engine.handleHeartbeat({
        term: 2,
        authorityMemberId: "member-b",
        stateRevision: 1,
        heartbeatSeq: 1,
      });
      expect(engine.getAuthorityMemberId()).toBe("member-b");
      expect(engine.getTerm()).toBe(2);

      // Stale terms never win.
      engine.handleAnnounce({ term: 1, authorityMemberId: "member-a", stateRevision: 99 });
      expect(engine.getAuthorityMemberId()).toBe("member-b");
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
        historyMode: "full",
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

    it("drops a commit raced by an authority change silently instead of acking invalid_state (7.30)", async () => {
      // Deferred digest: the commit waits on our gate, so the authority
      // change lands deterministically inside the state-hash window.
      let releaseDigest!: () => void;
      const digestGate = new Promise<void>((resolve) => {
        releaseDigest = resolve;
      });
      let digestStarted = false;
      const { engine, host } = makeEngine("member-a", {
        stateHash: async () => {
          digestStarted = true;
          await digestGate;
          return "f".repeat(64);
        },
      });
      // member-a is the sitting authority at term 1 with replicated state.
      engine.handleAnnounce({ term: 1, authorityMemberId: "member-a", stateRevision: 1 });
      engine.handleSnapshot({
        revision: 1,
        stateHash: "0".repeat(64),
        term: 1,
        authorityMemberId: "member-a",
        processedActionIds: [],
        historyMode: "full",
        state: { count: 0 },
      });
      // A local action starts applying; commit stalls on the digest gate.
      engine.handleLocalAction({
        actionId: "act-race",
        type: "increment",
        payload: { by: 1 },
        baseRevision: 1,
      });
      await waitForEngine(() => digestStarted, "commit digest started");
      // The authority steps down mid-digest: a higher-term campaign lands.
      engine.handleElection({
        term: 2,
        candidateMemberId: "member-b",
        observed: [{ memberId: "member-b", revision: 1, stateHash: "0".repeat(64) }],
      });
      expect(engine.getAuthorityMemberId()).toBeNull();
      // Release the digest: commit re-checks authority, fails, and the
      // action is dropped silently (the dispatcher re-sends it to the new
      // authority; deduplication keeps it exactly-once).
      releaseDigest();
      await engine.flushPending();
      const racedAcks = host.acks.filter((ack) => ack.ack.actionId === "act-race");
      expect(racedAcks).toHaveLength(0); // never acked as invalid (or anything)
      expect(host.events.some((event) => event.type === "actionRejected")).toBe(false);
      expect(engine.getDiagnostics().revision).toBe(1); // nothing committed
      expect(engine.getDiagnostics().pendingActionCount).toBe(0);
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
        historyMode: "full",
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
        historyMode: "full",
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
        historyMode: "full",
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
  },
);

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
  const deadline = performance.now() + WAIT_BUDGET_MS;
  for (;;) {
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
    if (performance.now() >= deadline) break;
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

describe(
  "S3 authority migration over the transport",
  // Wall-clock waits (WAIT_BUDGET_MS) can legitimately exceed vitest's 5s
  // default under CPU contention in parallel runs.
  { timeout: 60_000 },
  () => {
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

    it("targets dispatches at the authority: non-authority peers receive none", async () => {
      const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
      const [a, b, c] = trio(sessions);
      const dispatchesReceived = new Map<string, number>();
      for (const session of sessions) {
        dispatchesReceived.set(session.player.id, 0);
        session.transport.on("message:received", (message) => {
          const payload = message.payload as { type?: string };
          if (payload.type === "action.dispatch") {
            dispatchesReceived.set(
              session.player.id,
              (dispatchesReceived.get(session.player.id) ?? 0) + 1,
            );
          }
        });
      }
      let settled: "pending" | "accepted" | "rejected" = "pending";
      const dispatched = c.client.dispatch({ type: "mark", payload: { marker: "targeted" } }).then(
        () => {
          settled = "accepted";
        },
        () => {
          settled = "rejected";
        },
      );
      await pumpUntil(
        hub,
        () => settled !== "pending" && dispatchesReceived.get("member-a") === 1,
        "targeted dispatch reaches the authority and is acked",
      );
      await dispatched;
      expect(settled).toBe("accepted");
      // Only the authority received the dispatch; the bystander (b) and the
      // sender (c, which never receives its own dispatch) got nothing.
      expect(dispatchesReceived.get("member-a")).toBe(1);
      expect(dispatchesReceived.get("member-b")).toBe(0);
      expect(dispatchesReceived.get("member-c")).toBe(0);
      expect(a.getCanonicalState()?.state).toMatchObject({ count: 1, markers: ["targeted"] });
      expect(b.getCanonicalState()?.state).toMatchObject({ count: 1, markers: ["targeted"] });
    });

    it("retries a dispatch in flight during authority loss to the successor, applied once", async () => {
      const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
      const [a, b, c] = trio(sessions);
      let settled: "pending" | "accepted" | "rejected" = "pending";
      const dispatched = c.client.dispatch({ type: "mark", payload: { marker: "inflight" } }).then(
        () => {
          settled = "accepted";
        },
        () => {
          settled = "rejected";
        },
      );
      // Let the client hand the dispatch to the transport while `a` is still
      // the authority, so it is genuinely in flight (not buffered).
      for (let i = 0; i < 3; i += 1) await yieldLoop();
      expect(c.getStateModeDiagnostics().authorityMemberId).toBe("member-a");
      // The authority's connection drops with the dispatch undelivered: it
      // never applies or acks it.
      await a.transport.suspend();
      expect(a.getCanonicalState()?.state).not.toMatchObject({ markers: ["inflight"] });
      await pumpUntil(
        hub,
        () => b.getStateModeDiagnostics().electionInProgress,
        "suspicion after the authority drops",
      );
      await settleElection(hub);

      await pumpUntil(
        hub,
        () =>
          b.getStateModeDiagnostics().authorityMemberId === "member-b" &&
          c.getStateModeDiagnostics().authorityMemberId === "member-b" &&
          (b.getCanonicalState()?.state as { count?: number } | null)?.count === 1 &&
          settled !== "pending",
        "in-flight dispatch retried to member-b and acked",
      );
      await dispatched;
      expect(settled).toBe("accepted");
      // Exactly one commit, on the successor; the retry did not double-apply.
      expect(b.getCanonicalState()?.state).toEqual({ count: 1, markers: ["inflight"] });
      expect(c.getCanonicalState()?.state).toEqual({ count: 1, markers: ["inflight"] });
      expect(b.getStateModeDiagnostics().revision).toBe(2);
    });

    it("converges after a silent partition: simultaneous suspicion, one authority on merge", async () => {
      const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
      const [a, b, c] = trio(sessions);
      expect(a.getStateModeDiagnostics().authorityMemberId).toBe("member-a");

      // Partition: withhold delivery while fake time passes. Both followers
      // miss heartbeats, suspect simultaneously, and campaign (their messages
      // sit undelivered); the authority keeps committing locally.
      await advance(400);
      const aSide = a.client.dispatch({ type: "mark", payload: { marker: "a-side" } }).then(
        () => "accepted",
        (error: unknown) => (error as { code?: string }).code ?? "rejected",
      );
      // Attach the rejection handler immediately (no unhandled rejection).
      const cSide = c.client.dispatch({ type: "mark", payload: { marker: "c-side" } }).then(
        () => "accepted",
        (error: unknown) => error,
      );
      await advance(100);
      // Keep the partition strict until the local commit finishes. The merge
      // below is the only delivery point, so campaigns cannot race this commit.
      const localDeadline = performance.now() + WAIT_BUDGET_MS;
      while (a.getStateModeDiagnostics().revision !== 2 && performance.now() < localDeadline) {
        await advance(100);
      }
      // Local commit on the authority: the ack must come back accepted. (A
      // mid-commit authority change must never surface as an unhandled
      // rejection or an invalid_state ack.)
      expect(a.getStateModeDiagnostics().revision).toBe(2);
      expect(await aSide).toBe("accepted");

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

    it("reconnects the authority mid-campaign with a committed action and converges (7.31)", async () => {
      // Reconnect the authority during a local dispatch. It misses the peer
      // campaign, so winner-wait re-election must converge the party and
      // re-send the action rather than reject it as invalid_state.
      const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
      const [a, b, c] = trio(sessions);
      const outcome = a.client.dispatch({ type: "mark", payload: { marker: "m0" } }).then(
        () => "accepted",
        (error: unknown) => (error as { code?: string }).code ?? "rejected",
      );
      await a.transport.reconnect();
      await pump(hub);
      for (let i = 0; i < 50; i += 1) {
        await advance(100);
        await pump(hub);
      }
      // The local action is applied exactly once (never invalid_state).
      expect(await outcome).toBe("accepted");
      // Every connected shell agrees on ONE authority (non-null).
      const authorities = sessions.map(
        (session) => session.getStateModeDiagnostics().authorityMemberId,
      );
      expect(authorities[0]).not.toBeNull();
      expect(new Set(authorities).size).toBe(1);
      // Identical state everywhere; m0 contributed exactly one marker.
      const states = sessions.map((session) => session.getCanonicalState());
      expect(states[1]?.state).toEqual(states[0]?.state);
      expect(states[2]?.state).toEqual(states[0]?.state);
      expect(states[0]?.state as { count: number; markers: string[] } | null).toEqual({
        count: 1,
        markers: ["m0"],
      });
      // The party keeps working under the settled authority.
      const later = c.client.dispatch({ type: "mark", payload: { marker: "m1" } });
      await pumpUntil(
        hub,
        () => (b.getCanonicalState()?.state as { count?: number } | null)?.count === 2,
        "post-reconnect dispatch applies",
      );
      await expect(later).resolves.toBeUndefined();
    });
  },
);

// ---------------------------------------------------------------------------
// fast-check property tests
// ---------------------------------------------------------------------------

const PROPERTY_OPS = fcRecord({
  op: fcConstantFrom("dispatch", "advance", "drain", "drop", "suspend", "resume", "leave"),
  player: fcInteger({ min: 0, max: 2 }),
  amount: fcInteger({ min: 20, max: 250 }),
});

/** Run one random scenario and assert the invariants hold. */
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
    // Final settle: keep advancing fake time in small steps with a pump
    // between, so heartbeats are delivered and the grace period never
    // spuriously expires while every election/restore cascade completes
    // (delivery is drain-only in tests). The settle exits only once every
    // connected started shell has stopped electing AND agrees on one
    // authority (agreement needs announce propagation, which the
    // advance+pump loop provides), and is bounded by a generous fake-time
    // cap so slow real-async digest work under CPU contention can't starve
    // it.
    const connectedStarted = () =>
      sessions.filter(
        (session) => session.transport.connectionState === "connected" && session.isStarted(),
      );
    const electionsSettled = () => {
      const shells = connectedStarted();
      if (shells.length === 0) return true; // nobody connected: vacuous
      if (shells.some((session) => session.getStateModeDiagnostics().electionInProgress)) {
        return false;
      }
      const authorities = shells.map(
        (session) => session.getStateModeDiagnostics().authorityMemberId,
      );
      // Every connected started shell must KNOW the authority and agree.
      // A null authority may be waiting for a reconnected member that missed
      // the campaign; keep settling until re-election converges.
      if (authorities.some((authority) => authority === null)) return false;
      if (new Set(authorities).size !== 1) return false;
      // State must have converged too: agreeing on the authority is not
      // enough while the newly elected authority is still inside its
      // restore window (restoreDone=false, pre-replication).
      const revisions = shells.map((session) => session.getStateModeDiagnostics().revision);
      return new Set(revisions).size === 1;
    };
    let settled = false;
    for (let fake = 0; fake < 30_000; fake += 100) {
      await advance(100);
      await pump(hub);
      if (electionsSettled()) {
        settled = true;
        break;
      }
    }
    if (!settled) {
      throw new Error(
        `Timed out settling elections (ops: ${JSON.stringify(ops)}; received: ${JSON.stringify([...received])}): ${connectedStarted()
          .map(
            (session) =>
              `${session.player.id}:auth=${String(session.getStateModeDiagnostics().authorityMemberId)}:term=${session.getStateModeDiagnostics().term}:electing=${session.getStateModeDiagnostics().electionInProgress}`,
          )
          .join(" | ")}`,
      );
    }
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
      if (unique.size !== 1) {
        const detail = connected
          .map((session) => {
            const d = session.getStateModeDiagnostics();
            return `${session.player.id}: authority=${String(d.authorityMemberId)} term=${d.term} electing=${d.electionInProgress} rev=${d.revision}`;
          })
          .join(" | ");
        throw new Error(
          `authority divergence (${unique.size} authorities): ${detail}; ops: ${JSON.stringify(ops)}; received: ${JSON.stringify([...received])}`,
        );
      }
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
  it(
    "converges to one authority with consistent state and no double commits",
    { timeout: 60_000 }, // wall-clock waits under CPU contention
    async () => {
      await fcAssert(
        asyncProperty(fcArray(PROPERTY_OPS, { maxLength: 25 }), async (ops) => {
          await runPropertyScenario(ops as Array<{ op: string; player: number; amount: number }>);
        }),
        { numRuns: 25 },
      );
    },
  );
});

describe("state resync (engine)", () => {
  it("serves a full snapshot to each requester and ignores repeats inside the window", async () => {
    const { engine, host } = makeEngine("member-a");
    expect(await engine.initializeAsAuthority()).toBe(true);
    host.snapshots.length = 0;
    host.views.length = 0;

    for (let i = 0; i < 30; i += 1) {
      engine.handleResync({ requesterMemberId: "member-b", knownRevision: 0 });
    }
    engine.handleResync({ requesterMemberId: "member-c", knownRevision: 0 });
    // One full snapshot per requester: b's 29 repeats are dropped, c is served.
    expect(host.snapshots.map((entry) => entry.target)).toEqual(["member-b", "member-c"]);
    expect(host.snapshots.every((entry) => entry.snapshot.historyMode === "full")).toBe(true);
    await yieldLoop();
    await yieldLoop();
    expect(host.views.map((entry) => entry.target)).toEqual(["member-b", "member-c"]);

    await advance(stateResyncMinIntervalMs);
    engine.handleResync({ requesterMemberId: "member-b", knownRevision: 0 });
    expect(host.snapshots.filter((entry) => entry.target === "member-b")).toHaveLength(2);
  });

  it("a follower and a non-authority never serve a resync", async () => {
    const { engine, host } = makeEngine("member-b");
    await seedFollower(engine, 1, { count: 0 });
    engine.handleResync({ requesterMemberId: "member-c", knownRevision: 0 });
    expect(host.snapshots).toHaveLength(0);
  });

  it("a receiver that sees a gap asks the authority once per window, and a full snapshot clears it", async () => {
    const { engine, host } = makeEngine("member-b");
    await seedFollower(engine, 1, { count: 0 });
    const gapState = { count: 2 };
    const gapHash = await stateHashOf(gapState);
    const gapped = {
      revision: 3,
      stateHash: gapHash,
      term: 1,
      authorityMemberId: "member-a",
      historyMode: "increment" as const,
      processedActionIds: ["action-3"],
      state: gapState,
      senderMemberId: "member-a",
    };
    engine.handleSnapshot(gapped);
    expect(host.resyncs).toEqual([{ target: "member-a", request: { knownRevision: 3 } }]);
    // The gapped increment still carries the state; the history is incomplete.
    expect(engine.getRevision()).toBe(3);

    // Further gaps inside the window send nothing: one request outstanding.
    const laterState = { count: 5 };
    engine.handleSnapshot({
      ...gapped,
      revision: 6,
      stateHash: await stateHashOf(laterState),
      processedActionIds: ["action-6"],
      state: laterState,
    });
    expect(host.resyncs).toHaveLength(1);

    // A full snapshot (the authority's answer) clears the outstanding request.
    engine.handleSnapshot({
      revision: 6,
      stateHash: await stateHashOf(laterState),
      term: 1,
      authorityMemberId: "member-a",
      historyMode: "full",
      processedActionIds: ["action-3", "action-6"],
      state: laterState,
      senderMemberId: "member-a",
    });
    engine.handleSnapshot({
      ...gapped,
      revision: 9,
      stateHash: await stateHashOf({ count: 9 }),
      processedActionIds: ["action-9"],
      state: { count: 9 },
    });
    expect(host.resyncs).toHaveLength(2);
  });
});

/** Count and record one session's inbound state messages (by type). */
function recordInbound(session: NovaSession): Array<{ type: string; payload: unknown }> {
  const log: Array<{ type: string; payload: unknown }> = [];
  session.transport.on("message:received", (message) => {
    const payload = message.payload as { type?: string };
    if (payload.type !== undefined) log.push({ type: payload.type, payload: message.payload });
  });
  return log;
}

/**
 * Drop the next state broadcast this transport would send (a missed commit
 * for every follower). Returns a counter of dropped broadcasts.
 */
function dropNextBroadcastSnapshot(transport: NovaSession["transport"]): { dropped: number } {
  const send = transport.send.bind(transport);
  const counter = { dropped: 0 };
  transport.send = (options: Parameters<NovaSession["transport"]["send"]>[0]) => {
    const payload = options.payload as { type?: string };
    if (
      counter.dropped === 0 &&
      payload.type === "state.snapshot" &&
      options.targetConnectionId === undefined
    ) {
      counter.dropped += 1;
      return Promise.resolve();
    }
    return send(options);
  };
  return counter;
}

describe("incremental action history over the transport", { timeout: 60_000 }, () => {
  it("sends per-commit snapshots that carry only the newly added action IDs", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [, b, c] = trio(sessions);
    const inbound = recordInbound(b);
    for (const [index, marker] of ["m1", "m2", "m3"].entries()) {
      const applied = c.client.dispatch({ type: "mark", payload: { marker } });
      await pumpUntil(hub, () => b.getStateModeDiagnostics().revision === 2 + index, marker);
      await applied;
    }
    const snapshots = inbound
      .filter((entry) => entry.type === "state.snapshot")
      .map(
        (entry) =>
          entry.payload as { revision: number; historyMode: string; processedActionIds: string[] },
      );
    const commits = snapshots.filter((snapshot) => snapshot.revision >= 2);
    expect(commits.map((snapshot) => snapshot.historyMode)).toEqual([
      "increment",
      "increment",
      "increment",
    ]);
    expect(commits.map((snapshot) => snapshot.processedActionIds.length)).toEqual([1, 1, 1]);
    expect(b.getStateModeDiagnostics().processedActionCount).toBe(3);
  });

  it("a missed commit triggers one resync per follower and recovers the same history", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    const served = recordInbound(a);
    // The authority's next state broadcast never leaves: b and c miss commit 2.
    const drop = dropNextBroadcastSnapshot(a.transport);
    const first = c.client.dispatch({ type: "mark", payload: { marker: "missed" } });
    await pumpUntil(hub, () => drop.dropped === 1, "commit 2 broadcast dropped");
    await first;
    // c still holds revision 1 (it missed commit 2), so a default-based
    // dispatch would be stale. Base it on the authority's revision instead;
    // the commit's increment exposes the gap and triggers the resync.
    const second = c.dispatch(
      { type: "mark", payload: { marker: "after-gap" }, baseRevision: 2 },
      "after-gap",
    );
    await pumpUntil(
      hub,
      () =>
        b.getStateModeDiagnostics().revision === 3 &&
        c.getStateModeDiagnostics().revision === 3 &&
        b.getStateModeDiagnostics().processedActionCount === 2 &&
        c.getStateModeDiagnostics().processedActionCount === 2,
      "gapped followers recover",
    );
    await second;
    // Each follower asked exactly once, and the authority answered each in full.
    const resyncs = served.filter((entry) => entry.type === "state.resync");
    expect(resyncs).toHaveLength(2);
    expect(b.getCanonicalState()?.state).toEqual({ count: 2, markers: ["missed", "after-gap"] });
    expect(c.getCanonicalState()?.state).toEqual({ count: 2, markers: ["missed", "after-gap"] });
    expect(b.getStateModeDiagnostics().processedActionCount).toBe(
      a.getStateModeDiagnostics().processedActionCount,
    );
  });

  it("after migration the new authority rejects duplicates soon after, and more than 256 actions later", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    const dispatchedIds: string[] = [];
    const sendWithId = (marker: string, id: string): Promise<void> => {
      dispatchedIds.push(id);
      return c.dispatch({ type: "mark", payload: { marker } }, id);
    };
    await sendWithId("dup", "dup-1");
    await pumpUntil(hub, () => b.getStateModeDiagnostics().revision === 2, "dup-1 commits");

    await a.leave();
    await settleElection(hub);
    await pumpUntil(
      hub,
      () =>
        b.getStateModeDiagnostics().authorityMemberId === "member-b" &&
        c.getStateModeDiagnostics().authorityMemberId === "member-b",
      "migration to member-b",
    );

    // Soon after migration: a re-sent copy of dup-1 must not commit again.
    const inbound = recordInbound(b);
    await sendWithId("dup", "dup-1");
    await pumpUntil(
      hub,
      () => inbound.some((entry) => entry.type === "action.dispatch"),
      "duplicate reaches b",
    );
    await pump(hub);
    expect(b.getStateModeDiagnostics().revision).toBe(2);
    expect(b.getCanonicalState()?.state).toEqual({ count: 1, markers: ["dup"] });

    // Well after migration: more actions than the window, each a delta. The
    // duplicate checked is the most recent one, which is always still in the
    // window; the eviction boundary itself is covered separately.
    let lastId = "";
    for (let i = 0; i < STATE_WINDOW_PROBE; i += 1) {
      lastId = `p${i}`;
      const marker = `p${i}`;
      // The sender must hold the current revision, or its base is stale.
      await pumpUntil(
        hub,
        () => c.getStateModeDiagnostics().revision === b.getStateModeDiagnostics().revision,
        `c at the authority revision before ${marker}`,
      );
      await sendWithId(marker, lastId);
      await pumpUntil(
        hub,
        () => b.getStateModeDiagnostics().revision === 3 + i,
        `commit ${marker}`,
      );
    }
    expect(b.getStateModeDiagnostics().processedActionCount).toBe(256);
    expect(c.getStateModeDiagnostics().processedActionCount).toBe(256);
    const before = b.getStateModeDiagnostics().revision;
    await sendWithId("dup-late", lastId);
    await pump(hub);
    expect(b.getStateModeDiagnostics().revision).toBe(before);
    expect(b.getCanonicalState()?.state).toMatchObject({ markers: expect.arrayContaining(["p0"]) });
    expect(dispatchedIds.length).toBe(STATE_WINDOW_PROBE + 3);
  });

  it("a late joiner receives the full processed-action history", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, , c] = trio(sessions);
    for (const [index, marker] of ["x1", "x2", "x3"].entries()) {
      const applied = c.client.dispatch({ type: "mark", payload: { marker } });
      await pumpUntil(hub, () => a.getStateModeDiagnostics().revision === 2 + index, marker);
      await applied;
    }
    const late = makeSession(hub, "member-d");
    late.client.defineGame({ title: "S3 Game", mode: "state", ...s3GameHandlers() });
    const lateInbound = recordInbound(late);
    await late.join();
    await pumpUntil(
      hub,
      () => late.getStateModeDiagnostics().revision === a.getStateModeDiagnostics().revision,
      "late joiner catches up",
    );
    const catchUp = lateInbound.find((entry) => entry.type === "state.snapshot") as
      | { payload: { historyMode: string; processedActionIds: string[] } }
      | undefined;
    expect(catchUp?.payload.historyMode).toBe("full");
    expect(late.getStateModeDiagnostics().processedActionCount).toBe(
      a.getStateModeDiagnostics().processedActionCount,
    );
  });
});

describe("buffered dispatch delivery", { timeout: 60_000 }, () => {
  it("sends a buffered dispatch once after the authority changes", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    const inbound = recordInbound(b);
    await a.leave();
    await pump(hub);
    // No authority is known: the dispatch waits in the election buffer.
    const dispatched = c.client.dispatch({ type: "mark", payload: { marker: "once" } });
    await settleElection(hub);
    await pumpUntil(
      hub,
      () => b.getStateModeDiagnostics().revision === 2,
      "buffered dispatch applies",
    );
    await dispatched;
    const sends = inbound.filter(
      (entry) =>
        entry.type === "action.dispatch" &&
        (entry.payload as { actionType?: string }).actionType === "mark",
    );
    expect(sends).toHaveLength(1);
    expect(b.getCanonicalState()?.state).toEqual({ count: 1, markers: ["once"] });
  });
});

/** Advance fake time in small steps, delivering queued messages between steps. */
async function advanceWithPumps(hub: InMemoryTransportHub, ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    await advance(100);
    await pump(hub);
  }
}

describe("unacknowledged dispatch retry", { timeout: 60_000 }, () => {
  it("re-sends a dispatch that got no ack within the timeout; the authority applies it once", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, , c] = trio(sessions);
    // The first dispatch from c is lost on the wire; the authority never sees it.
    const send = c.transport.send.bind(c.transport);
    let dropped = 0;
    c.transport.send = (options: Parameters<NovaSession["transport"]["send"]>[0]) => {
      const payload = options.payload as { type?: string };
      if (dropped === 0 && payload.type === "action.dispatch") {
        dropped += 1;
        return Promise.resolve();
      }
      return send(options);
    };
    let settled: "pending" | "accepted" = "pending";
    const dispatched = c.client.dispatch({ type: "mark", payload: { marker: "lost" } }).then(() => {
      settled = "accepted";
    });
    await pump(hub);
    expect(dropped).toBe(1);
    expect(a.getStateModeDiagnostics().revision).toBe(1);

    await advanceWithPumps(hub, actionTimeoutMs + 200);
    await pumpUntil(hub, () => settled === "accepted", "retried dispatch acknowledged");
    await dispatched;
    expect(a.getCanonicalState()?.state).toEqual({ count: 1, markers: ["lost"] });
    expect(a.getStateModeDiagnostics().revision).toBe(2);
  });
});

describe("silent authority", { timeout: 60_000 }, () => {
  it("a dispatch in flight to an authority that stopped heartbeating is applied exactly once", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    // The authority keeps running but stops heartbeating: followers suspect it,
    // campaign, and re-adopt it on every new term (authorityChanged fires).
    const send = a.transport.send.bind(a.transport);
    a.transport.send = (options: Parameters<NovaSession["transport"]["send"]>[0]) => {
      const payload = options.payload as { type?: string };
      if (payload.type === "authority.heartbeat") return Promise.resolve();
      return send(options);
    };
    let settled: "pending" | "accepted" = "pending";
    const dispatched = c.client
      .dispatch({ type: "mark", payload: { marker: "silent" } })
      .then(() => {
        settled = "accepted";
      });
    for (let elapsed = 0; elapsed < 6_000; elapsed += 100) {
      await advance(100);
      await pump(hub);
    }
    await pumpUntil(hub, () => settled === "accepted", "silent-authority dispatch acknowledged");
    await dispatched;
    expect(a.getCanonicalState()?.state).toEqual({ count: 1, markers: ["silent"] });
    expect(b.getCanonicalState()?.state).toEqual({ count: 1, markers: ["silent"] });
    expect(a.getStateModeDiagnostics().revision).toBe(2);
  });
});

/**
 * Drop the next transport send matching `match` (a lost message). Returns a
 * counter of dropped sends.
 */
function dropNextMatching(
  transport: NovaSession["transport"],
  match: (options: Parameters<NovaSession["transport"]["send"]>[0]) => boolean,
): { dropped: number } {
  const send = transport.send.bind(transport);
  const counter = { dropped: 0 };
  transport.send = (options: Parameters<NovaSession["transport"]["send"]>[0]) => {
    if (counter.dropped === 0 && match(options)) {
      counter.dropped += 1;
      return Promise.resolve();
    }
    return send(options);
  };
  return counter;
}

function payloadOf(options: Parameters<NovaSession["transport"]["send"]>[0]): {
  type?: string;
  historyMode?: string;
} {
  return options.payload as { type?: string; historyMode?: string };
}

describe("fan-out review fixes", { timeout: 60_000 }, () => {
  it("a dispatch the game saw time out is never committed by a late copy", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, , c] = trio(sessions);
    // The link from c drops every dispatch for 15 s (longer than the deadline).
    let blackhole = true;
    const send = c.transport.send.bind(c.transport);
    c.transport.send = (options: Parameters<NovaSession["transport"]["send"]>[0]) => {
      if (blackhole && payloadOf(options).type === "action.dispatch") return Promise.resolve();
      return send(options);
    };
    let outcome = "pending";
    const dispatched = c.client.dispatch({ type: "mark", payload: { marker: "late" } }).then(
      () => {
        outcome = "accepted";
      },
      (error: unknown) => {
        outcome = String((error as { code?: string }).code);
      },
    );
    await pump(hub);
    await advanceWithPumps(hub, 15_000);
    expect(outcome).toBe("timed_out");
    await dispatched;

    // The link recovers. No copy may now commit: the deadline has passed.
    blackhole = false;
    // Long enough for several retry cycles to come and go after the link recovers.
    await advanceWithPumps(hub, 15_000);
    expect(a.getStateModeDiagnostics().revision).toBe(1);
    expect(a.getCanonicalState()?.state).toEqual({ count: 0, markers: [] });
  });

  it("a gap with no further commits is repaired by the authority's heartbeat", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    // The broadcast of commit 2 never leaves: b and c miss it, and nothing
    // else commits, so no delta arrives to expose the gap.
    const drop = dropNextMatching(
      a.transport,
      (options) =>
        payloadOf(options).type === "state.snapshot" && options.targetConnectionId === undefined,
    );
    const missed = c.client.dispatch({ type: "mark", payload: { marker: "missed" } });
    await pumpUntil(hub, () => drop.dropped === 1, "commit 2 broadcast dropped");
    await missed;
    await advanceWithPumps(hub, 1_000);
    await pumpUntil(
      hub,
      () =>
        b.getStateModeDiagnostics().revision === 2 &&
        c.getStateModeDiagnostics().revision === 2 &&
        b.getStateModeDiagnostics().processedActionCount === 1 &&
        c.getStateModeDiagnostics().processedActionCount === 1,
      "heartbeat-driven repair",
    );
    expect(b.getCanonicalState()?.state).toEqual({ count: 1, markers: ["missed"] });
  });

  it("a lost resync reply is retried after the window, and the history recovers", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    const served = recordInbound(a);
    const dropCommit2 = dropNextMatching(
      a.transport,
      (options) =>
        payloadOf(options).type === "state.snapshot" && options.targetConnectionId === undefined,
    );
    const missed = c.client.dispatch({ type: "mark", payload: { marker: "missed" } });
    await pumpUntil(hub, () => dropCommit2.dropped === 1, "commit 2 dropped");
    await missed;
    // The first full snapshot the authority sends b is lost on the way back.
    const dropReply = dropNextMatching(
      a.transport,
      (options) =>
        payloadOf(options).type === "state.snapshot" &&
        payloadOf(options).historyMode === "full" &&
        options.targetConnectionId === b.transport.selfConnectionId,
    );
    const after = c.dispatch(
      { type: "mark", payload: { marker: "after" }, baseRevision: 2 },
      "after-gap",
    );
    await pumpUntil(hub, () => dropReply.dropped === 1, "resync reply to b dropped");
    await after;
    // The request is still outstanding; the next heartbeat after the window asks again.
    await advanceWithPumps(hub, 1_500);
    await pumpUntil(
      hub,
      () =>
        b.getStateModeDiagnostics().revision === 3 &&
        b.getStateModeDiagnostics().processedActionCount ===
          a.getStateModeDiagnostics().processedActionCount,
      "b recovers after the retried resync",
    );
    const fromB = served.filter(
      (entry) =>
        entry.type === "state.resync" &&
        (entry.payload as { senderMemberId?: string }).senderMemberId === "member-b",
    );
    expect(fromB.length).toBeGreaterThanOrEqual(2);
    expect(b.getCanonicalState()?.state).toEqual({ count: 2, markers: ["missed", "after"] });
  });

  it("after migration a replay with the original base is acknowledged as accepted", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    await c.dispatch({ type: "mark", payload: { marker: "dup" }, baseRevision: 1 }, "dup-1");
    await pumpUntil(hub, () => b.getStateModeDiagnostics().revision === 2, "dup-1 commits");
    await a.leave();
    await settleElection(hub);
    await pumpUntil(
      hub,
      () =>
        b.getStateModeDiagnostics().authorityMemberId === "member-b" &&
        c.getStateModeDiagnostics().authorityMemberId === "member-b",
      "migration to member-b",
    );
    const acks: string[] = [];
    c.onSessionEvent((event) => {
      if (event.type === "actionAck" && event.ack.actionId === "dup-1") acks.push(event.ack.status);
    });
    // A retry carries the original base (1), which is stale for the current revision.
    await c.dispatch({ type: "mark", payload: { marker: "dup" }, baseRevision: 1 }, "dup-1");
    await pumpUntil(hub, () => acks.length > 0, "replay acknowledged");
    expect(acks).toEqual(["accepted"]);
    expect(b.getStateModeDiagnostics().revision).toBe(2);
  });

  it("replays a lost rejection after authority handoff", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    const lost = dropNextMatching(a.transport, (options) => {
      const payload = options.payload as { type?: string; actionId?: string };
      return payload.type === "action.ack" && payload.actionId === "stale-move";
    });
    await c.dispatch({ type: "mark", payload: { marker: "stale" }, baseRevision: 0 }, "stale-move");
    await pumpUntil(hub, () => lost.dropped === 1, "original rejection dropped");

    const valid = a.client.dispatch({ type: "mark", payload: { marker: "valid" } });
    await pumpUntil(hub, () => b.getStateModeDiagnostics().revision === 2, "history replicated");
    await valid;
    await a.leave();
    await settleElection(hub);
    await pumpUntil(
      hub,
      () => b.getStateModeDiagnostics().authorityMemberId === "member-b",
      "replacement authority elected",
    );

    const acks: Array<{ status: string; errorCode?: string }> = [];
    c.onSessionEvent((event) => {
      if (event.type === "actionAck" && event.ack.actionId === "stale-move") {
        acks.push(event.ack);
      }
    });
    await c.dispatch({ type: "mark", payload: { marker: "stale" }, baseRevision: 0 }, "stale-move");
    await pumpUntil(hub, () => acks.length > 0, "replacement authority replayed the result");
    expect(acks).toEqual([
      expect.objectContaining({ status: "superseded", errorCode: "stale_revision" }),
    ]);
    expect(b.getCanonicalState()?.state).toEqual({ count: 1, markers: ["valid"] });
  });

  it("the first broadcast after migration is a full snapshot", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    const inbound = recordInbound(c);
    await a.leave();
    await settleElection(hub);
    await pumpUntil(
      hub,
      () =>
        b.getStateModeDiagnostics().authorityMemberId === "member-b" &&
        c.getStateModeDiagnostics().authorityMemberId === "member-b",
      "migration to member-b",
    );
    const isFromB = (entry: { type: string; payload: unknown }) =>
      entry.type === "state.snapshot" &&
      (entry.payload as { senderMemberId?: string }).senderMemberId === "member-b";
    // The authority flags flip before member-b's post-restore broadcast: that
    // broadcast waits on its real-async state hash, so wait for the snapshot
    // itself rather than for the flags.
    await pumpUntil(hub, () => inbound.some(isFromB), "the first snapshot from member-b");
    const fromB = inbound.filter(isFromB);
    expect(fromB.length).toBeGreaterThan(0);
    expect(fromB[0] && (fromB[0].payload as { historyMode?: string }).historyMode).toBe("full");
  });

  it("a full snapshot replaces the window: an ID the sender does not hold is forgotten", async () => {
    const { engine, host } = makeEngine("member-b");
    await seedFollower(engine, 1, { count: 0 });
    const hash1 = await stateHashOf({ count: 0 });
    engine.handleSnapshot({
      revision: 2,
      stateHash: await stateHashOf({ count: 1 }),
      term: 1,
      authorityMemberId: "member-a",
      historyMode: "increment",
      baseStateHash: hash1,
      processedActionIds: ["discarded"],
      state: { count: 1 },
      senderMemberId: "member-a",
    });
    expect(engine.processedActionIds()).toEqual(["discarded"]);
    engine.handleSnapshot({
      revision: 3,
      stateHash: await stateHashOf({ count: 2 }),
      term: 1,
      authorityMemberId: "member-a",
      historyMode: "full",
      processedActionIds: ["kept"],
      state: { count: 2 },
      senderMemberId: "member-a",
    });
    expect(engine.processedActionIds()).toEqual(["kept"]);
    expect(host.resyncs).toHaveLength(0);
  });

  it("an increment on another lineage is a gap even at the next revision; a same revision is a duplicate", async () => {
    const { engine, host } = makeEngine("member-b");
    await seedFollower(engine, 1, { count: 0 });
    const hash1 = await stateHashOf({ count: 0 });
    const hash2 = await stateHashOf({ count: 1 });
    // Same revision, same hash: a duplicate, not a gap.
    engine.handleSnapshot({
      revision: 1,
      stateHash: hash1,
      term: 1,
      authorityMemberId: "member-a",
      historyMode: "increment",
      baseStateHash: null,
      processedActionIds: [],
      state: { count: 0 },
      senderMemberId: "member-a",
    });
    expect(host.resyncs).toHaveLength(0);
    // Next revision, but built on a state we do not hold: a gap.
    engine.handleSnapshot({
      revision: 2,
      stateHash: hash2,
      term: 1,
      authorityMemberId: "member-a",
      historyMode: "increment",
      baseStateHash: "f".repeat(64),
      processedActionIds: ["x"],
      state: { count: 1 },
      senderMemberId: "member-a",
    });
    expect(host.resyncs).toHaveLength(1);
  });

  it("the pending-history bound falls back to a full broadcast", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    const inbound = recordInbound(b);
    // Stale dispatches are rejected without a commit, so their IDs pile up
    // as pending history until the bound is exceeded.
    for (let i = 0; i < STATE_WINDOW_LIMIT + 5; i += 1) {
      await c.dispatch(
        { type: "mark", payload: { marker: `stale-${i}` }, baseRevision: 0 },
        `stale-${i}`,
      );
    }
    await pump(hub);
    await c.dispatch({ type: "mark", payload: { marker: "valid" }, baseRevision: 1 }, "valid");
    await pumpUntil(hub, () => b.getStateModeDiagnostics().revision === 2, "valid commits");
    const commit = inbound.find(
      (entry) =>
        entry.type === "state.snapshot" && (entry.payload as { revision?: number }).revision === 2,
    );
    const payload = commit?.payload as { historyMode?: string; processedActionIds?: string[] };
    expect(payload.historyMode).toBe("full");
    expect(payload.processedActionIds ?? []).toContain("valid");
    expect(a.getStateModeDiagnostics().revision).toBe(2);
  });

  it("the dedup window is exactly the last 256 IDs: the oldest is still recognised, then evicted", async () => {
    const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    for (let i = 0; i < STATE_WINDOW_LIMIT; i += 1) {
      await c.dispatch(
        { type: "mark", payload: { marker: `w${i}` }, baseRevision: i + 1 },
        `w${i}`,
      );
      await pumpUntil(hub, () => b.getStateModeDiagnostics().revision === i + 2, `w${i} commits`);
    }
    expect(b.getStateModeDiagnostics().processedActionCount).toBe(STATE_WINDOW_LIMIT);
    // The oldest ID (w0) is still in the window: its replay is acknowledged, not re-applied.
    await c.dispatch({ type: "mark", payload: { marker: "w0" }, baseRevision: 1 }, "w0");
    await pump(hub);
    expect(a.getStateModeDiagnostics().revision).toBe(STATE_WINDOW_LIMIT + 1);
    // One more action evicts w0: the window is now exactly the newest 256 IDs.
    await c.dispatch(
      { type: "mark", payload: { marker: "w-extra" }, baseRevision: STATE_WINDOW_LIMIT + 1 },
      "w-extra",
    );
    await pumpUntil(
      hub,
      () => b.getStateModeDiagnostics().revision === STATE_WINDOW_LIMIT + 2,
      "extra commits",
    );
    expect(b.getStateModeDiagnostics().processedActionCount).toBe(STATE_WINDOW_LIMIT);
    expect(c.getStateModeDiagnostics().processedActionCount).toBe(STATE_WINDOW_LIMIT);
  });
});

describe(
  "review follow-ups: lineage, answered resync, merge rule, restore gate",
  { timeout: 60_000 },
  () => {
    it("a same-revision increment that wins a conflict is a gap and requests a resync", async () => {
      const { engine, host } = makeEngine("member-b");
      await seedFollower(engine, 1, { count: 0 });
      const otherState = { count: 9 };
      const otherHash = await stateHashOf(otherState);
      // Two members report the other hash, so it outvotes ours at revision 1.
      engine.handleElection({
        term: 1,
        candidateMemberId: "member-c",
        observed: [
          { memberId: "member-c", revision: 1, stateHash: otherHash },
          { memberId: "member-a", revision: 1, stateHash: otherHash },
        ],
      });
      engine.handleSnapshot({
        revision: 1,
        stateHash: otherHash,
        term: 1,
        authorityMemberId: "member-a",
        historyMode: "increment",
        baseStateHash: null,
        processedActionIds: ["x"],
        state: otherState,
        senderMemberId: "member-a",
      });
      expect(host.resyncs).toEqual([{ target: "member-a", request: { knownRevision: 1 } }]);
    });

    it("a persistent same-revision conflict does not cause a full reply per second", async () => {
      const { engine, host } = makeEngine("member-b");
      await seedFollower(engine, 1, { count: 0 });
      const stateThree = { count: 3 };
      // A gap: revision 3 built on a base we do not hold.
      engine.handleSnapshot({
        revision: 3,
        stateHash: await stateHashOf(stateThree),
        term: 1,
        authorityMemberId: "member-a",
        historyMode: "increment",
        baseStateHash: "f".repeat(64),
        processedActionIds: ["g"],
        state: stateThree,
        senderMemberId: "member-a",
      });
      expect(host.resyncs).toHaveLength(1);
      // The authority's answer is a full snapshot at revision 3 whose hash loses
      // the vote, so we keep our own state. The request is still answered.
      engine.handleSnapshot({
        revision: 3,
        stateHash: await stateHashOf({ count: 33 }),
        term: 1,
        authorityMemberId: "member-a",
        historyMode: "full",
        processedActionIds: ["g"],
        state: { count: 33 },
        senderMemberId: "member-a",
      });
      // Heartbeats at our revision for five seconds must not ask again. They
      // arrive every 100 ms (the test timings) so the grace period never lapses.
      for (let i = 0; i < 50; i += 1) {
        await advance(100);
        engine.handleHeartbeat({
          term: 1,
          authorityMemberId: "member-a",
          stateRevision: 3,
          heartbeatSeq: i,
        });
      }
      expect(engine.getAuthorityMemberId()).toBe("member-a");
      expect(host.resyncs).toHaveLength(1);
    });

    it("an incomplete authority's full snapshot merges and does not shrink a complete window", async () => {
      const { engine, host } = makeEngine("member-b");
      await seedFollower(engine, 1, { count: 0 });
      const hash1 = await stateHashOf({ count: 0 });
      const hash2 = await stateHashOf({ count: 1 });
      const hash3 = await stateHashOf({ count: 2 });
      engine.handleSnapshot({
        revision: 2,
        stateHash: hash2,
        term: 1,
        authorityMemberId: "member-a",
        historyMode: "increment",
        baseStateHash: hash1,
        processedActionIds: ["a"],
        state: { count: 1 },
        senderMemberId: "member-a",
      });
      engine.handleSnapshot({
        revision: 3,
        stateHash: hash3,
        term: 1,
        authorityMemberId: "member-a",
        historyMode: "increment",
        baseStateHash: hash2,
        processedActionIds: ["b"],
        state: { count: 2 },
        senderMemberId: "member-a",
      });
      expect(engine.processedActionIds()).toEqual(["a", "b"]);
      // The authority's window has a gap, so its full broadcast says so.
      engine.handleSnapshot({
        revision: 4,
        stateHash: await stateHashOf({ count: 3 }),
        term: 1,
        authorityMemberId: "member-a",
        historyMode: "full",
        historyComplete: false,
        processedActionIds: ["x"],
        state: { count: 3 },
        senderMemberId: "member-a",
      });
      expect(engine.processedActionIds()).toEqual(["a", "b", "x"]);
      expect(engine.isHistoryComplete()).toBe(true);
      expect(host.resyncs).toHaveLength(0);
    });

    it("the first broadcast after re-election is full, even with a dispatch during the hash await", async () => {
      let holdNextHash = false;
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { engine, host } = makeEngine("member-b", {
        connected: new Set(["member-b", "member-c"]),
        stateHash: async (value) => {
          if (holdNextHash) {
            holdNextHash = false;
            await gate;
          }
          return stateHashOf(value);
        },
      });
      // Member b leads at term 1, broadcasts a full revision 1, then steps down.
      expect(await engine.initializeAsAuthority()).toBe(true);
      await waitForEngine(() => host.snapshots.length > 0, "initial broadcast");
      host.connected.add("member-a");
      engine.handleAnnounce({ term: 2, authorityMemberId: "member-a", stateRevision: 1 });
      expect(engine.getAuthorityMemberId()).toBe("member-a");

      // Member a leaves; b wins the next term and its restore verification is held.
      const before = host.snapshots.length;
      holdNextHash = true;
      host.connected.delete("member-a");
      engine.notifyAuthorityLeft();
      await advance(400);
      expect(engine.getAuthorityMemberId()).toBe("member-b");
      // A dispatch arrives during the hash await: it must wait for the restore.
      engine.handleLocalAction({
        actionId: "during-restore",
        type: "increment",
        payload: {},
        baseRevision: 1,
      });
      expect(host.snapshots.length).toBe(before);
      // Let the dispatch's own state hash complete while the restore is still held.
      for (let i = 0; i < 5; i += 1) await yieldLoop();
      expect(host.snapshots.length).toBe(before);
      release();
      await waitForEngine(
        () => host.snapshots.length >= before + 2,
        "restore and commit broadcasts",
      );
      expect(host.snapshots[before]?.snapshot.historyMode).toBe("full");
      expect(host.snapshots[before + 1]?.snapshot.historyMode).toBe("increment");
      expect(host.snapshots[before + 1]?.snapshot.processedActionIds).toEqual(["during-restore"]);
      expect(engine.getRevision()).toBe(2);
    });

    it("becoming authority with a gapped window emits a host-side diagnostic", async () => {
      const { engine, host } = makeEngine("member-b");
      await seedFollower(engine, 1, { count: 0 });
      // A gap: the window is incomplete when member b takes over.
      engine.handleSnapshot({
        revision: 3,
        stateHash: await stateHashOf({ count: 2 }),
        term: 1,
        authorityMemberId: "member-a",
        historyMode: "increment",
        baseStateHash: "f".repeat(64),
        processedActionIds: ["g"],
        state: { count: 2 },
        senderMemberId: "member-a",
      });
      host.connected.delete("member-a");
      engine.notifyAuthorityLeft();
      await advance(400);
      expect(engine.getAuthorityMemberId()).toBe("member-b");
      expect(host.events).toContainEqual(
        expect.objectContaining({ type: "historyIncomplete", authorityMemberId: "member-b" }),
      );
    });
  },
);

describe(
  "review follow-ups 3: fresh joiner, diagnostics, restore revert",
  { timeout: 60_000 },
  () => {
    it("a fresh joiner that merges an incomplete window treats it as gapped and asks for repair", async () => {
      const { engine, host } = makeEngine("member-b");
      engine.handleAnnounce({ term: 1, authorityMemberId: "member-a", stateRevision: 4 });
      engine.handleSnapshot({
        revision: 4,
        stateHash: await stateHashOf({ count: 3 }),
        term: 1,
        authorityMemberId: "member-a",
        historyMode: "full",
        historyComplete: false,
        processedActionIds: ["x"],
        state: { count: 3 },
        senderMemberId: "member-a",
      });
      expect(engine.isHistoryComplete()).toBe(false);
      expect(engine.getDiagnostics().historyComplete).toBe(false);
      expect(host.resyncs).toEqual([{ target: "member-a", request: { knownRevision: 4 } }]);
      // A complete full snapshot repairs the window.
      engine.handleSnapshot({
        revision: 4,
        stateHash: await stateHashOf({ count: 3 }),
        term: 1,
        authorityMemberId: "member-a",
        historyMode: "full",
        processedActionIds: ["x", "y"],
        state: { count: 3 },
        senderMemberId: "member-a",
      });
      expect(engine.isHistoryComplete()).toBe(true);
      expect(engine.processedActionIds()).toEqual(["x", "y"]);
    });

    it("a gapped authority's diagnostic is visible in the diagnostics and forwarded to session listeners", async () => {
      const { hub, sessions } = await makeParty(["member-a", "member-b", "member-c"]);
      const [a, b, c] = trio(sessions);
      // Commit 2's broadcast never reaches anyone, and b's resync requests are
      // blackholed, so b stays gapped after commit 3.
      const dropCommit2 = dropNextMatching(
        a.transport,
        (options) =>
          payloadOf(options).type === "state.snapshot" && options.targetConnectionId === undefined,
      );
      const sendB = b.transport.send.bind(b.transport);
      b.transport.send = (options: Parameters<NovaSession["transport"]["send"]>[0]) =>
        payloadOf(options).type === "state.resync" ? Promise.resolve() : sendB(options);
      const events: Array<{ type: string; authorityMemberId?: string }> = [];
      b.onSessionEvent((event) => {
        events.push(event as { type: string; authorityMemberId?: string });
      });

      const missed = c.client.dispatch({ type: "mark", payload: { marker: "missed" } });
      await pumpUntil(hub, () => dropCommit2.dropped === 1, "commit 2 dropped");
      await missed;
      await c.dispatch(
        { type: "mark", payload: { marker: "after" }, baseRevision: 2 },
        "after-gap",
      );
      await pumpUntil(hub, () => b.getStateModeDiagnostics().revision === 3, "b sees commit 3");
      expect(b.getStateModeDiagnostics().historyComplete).toBe(false);

      await a.leave();
      await settleElection(hub);
      await pumpUntil(
        hub,
        () => b.getStateModeDiagnostics().authorityMemberId === "member-b",
        "b becomes authority",
      );
      expect(events).toContainEqual(
        expect.objectContaining({ type: "historyIncomplete", authorityMemberId: "member-b" }),
      );
    });

    it("a newer snapshot that replaces the state during the restore hash is not reverted", async () => {
      let holdNextHash = false;
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { engine, host } = makeEngine("member-b", {
        connected: new Set(["member-b", "member-c"]),
        stateHash: async (value) => {
          if (holdNextHash) {
            holdNextHash = false;
            await gate;
          }
          return stateHashOf(value);
        },
      });
      expect(await engine.initializeAsAuthority()).toBe(true);
      await waitForEngine(() => host.snapshots.length > 0, "initial broadcast");
      host.connected.add("member-a");
      engine.handleAnnounce({ term: 2, authorityMemberId: "member-a", stateRevision: 1 });
      host.connected.delete("member-a");
      holdNextHash = true;
      engine.notifyAuthorityLeft();
      await advance(400);
      expect(engine.getAuthorityMemberId()).toBe("member-b");

      // While the restore hash is held, member c pushes a newer state.
      const before = host.snapshots.length;
      const newer = { count: 9 };
      engine.handleSnapshot({
        revision: 3,
        stateHash: await stateHashOf(newer),
        term: engine.getTerm(),
        authorityMemberId: "member-b",
        historyMode: "full",
        processedActionIds: [],
        state: newer,
        senderMemberId: "member-c",
      });
      release();
      // Restore still completes: the first broadcast is the full snapshot of the
      // newer state, and a dispatch then commits (nothing stays gated).
      await waitForEngine(() => host.snapshots.length > before, "restore broadcast");
      expect(host.snapshots[before]?.snapshot.historyMode).toBe("full");
      expect(host.snapshots[before]?.snapshot.revision).toBe(3);
      expect(engine.getCanonicalState()).toEqual(newer);
      expect(engine.getRevision()).toBe(3);
      expect(host.events).not.toContainEqual(
        expect.objectContaining({ type: "stateError", code: "invalid_snapshot" }),
      );
      engine.handleLocalAction({
        actionId: "after-restore",
        type: "increment",
        payload: {},
        baseRevision: 3,
      });
      await waitForEngine(() => engine.getRevision() === 4, "post-restore commit");
      expect(engine.getCanonicalState()).toEqual({ count: 10 });
    });
  },
);

/**
 * A game whose state is mostly static (a padded table) with one changing
 * score per actor, so a delta is far smaller than the full state. `reset`
 * replaces everything, which a delta cannot beat.
 */
function deltaGameHandlers(): NovaStateHandlers {
  const padKeys = Array.from({ length: 40 }, (_, i) => `pad-${i}`);
  return {
    createInitialState: () => ({
      count: 0,
      scores: {} as Record<string, number>,
      table: Object.fromEntries(padKeys.map((key) => [key, "static value that never changes"])),
    }),
    actions: {
      bump(draft: { count: number; scores: Record<string, number> }, context) {
        const actor = context.actor?.id ?? "unknown";
        draft.count += 1;
        draft.scores[actor] = (draft.scores[actor] ?? 0) + 1;
      },
      reset(draft: Record<string, unknown>) {
        for (const key of Object.keys(draft)) delete draft[key];
        draft.reset = true;
      },
      put(draft: Record<string, unknown>, _context, payload: { path: string[]; value: unknown }) {
        let node: Record<string, unknown> = draft;
        for (const key of payload.path.slice(0, -1)) {
          if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
          node = node[key] as Record<string, unknown>;
        }
        node[payload.path[payload.path.length - 1] as string] = payload.value;
      },
    },
  };
}

async function startDeltaParty(hub: InMemoryTransportHub, sessions: NovaSession[]): Promise<void> {
  for (const session of sessions) {
    session.client.defineGame({ title: "Delta Game", mode: "state", ...deltaGameHandlers() });
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
    "delta party start",
  );
}

async function makeDeltaParty(memberIds: string[]): Promise<{
  hub: InMemoryTransportHub;
  sessions: NovaSession[];
}> {
  const hub = newTestHub(`delta-${memberIds.join("-")}`);
  const sessions = memberIds.map((id) => makeSession(hub, id));
  await startDeltaParty(hub, sessions);
  return { hub, sessions };
}

/** Rewrite the next outbound state snapshot with `change` (a corrupted or stale delta). */
function rewriteNextSnapshot(
  transport: NovaSession["transport"],
  change: (payload: Record<string, unknown>) => Record<string, unknown>,
): { rewritten: number } {
  const send = transport.send.bind(transport);
  const counter = { rewritten: 0 };
  transport.send = (options: Parameters<NovaSession["transport"]["send"]>[0]) => {
    const payload = options.payload as Record<string, unknown>;
    if (
      counter.rewritten === 0 &&
      payload.type === "state.snapshot" &&
      payload.stateMode === "delta"
    ) {
      counter.rewritten += 1;
      return send({ ...options, payload: change(payload) as typeof options.payload });
    }
    return send(options);
  };
  return counter;
}

describe("state deltas over the transport", { timeout: 60_000 }, () => {
  it("deltas are applied in order and the replicas converge", async () => {
    const { hub, sessions } = await makeDeltaParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    const inbound = recordInbound(b);
    for (const [index] of [0, 1, 2].entries()) {
      const applied = c.dispatch({ type: "bump", payload: {} }, `bump-${index}`);
      await pumpUntil(
        hub,
        () => b.getStateModeDiagnostics().revision === 2 + index,
        `bump ${index}`,
      );
      await applied;
    }
    const commits = inbound
      .filter((entry) => entry.type === "state.snapshot")
      .map((entry) => entry.payload as { revision: number; stateMode: string; ops?: unknown[] })
      .filter((payload) => payload.revision >= 2);
    expect(commits.map((payload) => payload.stateMode)).toEqual(["delta", "delta", "delta"]);
    await pumpUntil(
      hub,
      () => c.getStateModeDiagnostics().revision === a.getStateModeDiagnostics().revision,
      "c converges",
    );
    expect(b.getCanonicalState()?.state).toEqual(a.getCanonicalState()?.state);
    expect(c.getCanonicalState()?.state).toEqual(a.getCanonicalState()?.state);
    expect((a.getCanonicalState()?.state as { count: number } | null)?.count).toBe(3);
  });

  it("a delta with a wrong base triggers a resync and the replica recovers", async () => {
    const { hub, sessions } = await makeDeltaParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    const served = recordInbound(a);
    const corrupt = rewriteNextSnapshot(a.transport, (payload) => ({
      ...payload,
      baseStateHash: "f".repeat(64),
    }));
    const first = c.dispatch({ type: "bump", payload: {} }, "bump-0");
    await pumpUntil(hub, () => corrupt.rewritten === 1, "delta rewritten");
    await first;
    await pumpUntil(
      hub,
      () =>
        b.getStateModeDiagnostics().revision === 2 && served.some((e) => e.type === "state.resync"),
      "resync after the wrong base",
    );
    await pumpUntil(
      hub,
      () =>
        b.getStateModeDiagnostics().processedActionCount ===
        a.getStateModeDiagnostics().processedActionCount,
      "b repaired",
    );
    expect(b.getCanonicalState()?.state).toEqual(a.getCanonicalState()?.state);
  });

  it("a corrupted delta fails the hash check, resyncs, and the replica recovers", async () => {
    const { hub, sessions } = await makeDeltaParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    const served = recordInbound(a);
    // The ops are changed but the sender's hash is kept: the receiver must detect it.
    const corrupt = rewriteNextSnapshot(a.transport, (payload) => ({
      ...payload,
      ops: [{ op: "set", path: ["count"], value: 999 }],
    }));
    const first = c.dispatch({ type: "bump", payload: {} }, "bump-0");
    await pumpUntil(hub, () => corrupt.rewritten === 1, "delta corrupted");
    await first;
    await pumpUntil(
      hub,
      () =>
        served.some(
          (e) =>
            e.type === "state.resync" &&
            (e.payload as { senderMemberId?: string }).senderMemberId === "member-b",
        ),
      "b asks for a repair",
    );
    await pumpUntil(
      hub,
      () =>
        b.getStateModeDiagnostics().revision === 2 && b.getCanonicalState()?.state !== undefined,
      "b recovers",
    );
    expect(b.getCanonicalState()?.state).toEqual(a.getCanonicalState()?.state);
    expect((b.getCanonicalState()?.state as { count: number } | null)?.count).toBe(1);
  });

  it("a large change falls back to a full snapshot", async () => {
    const { hub, sessions } = await makeDeltaParty(["member-a", "member-b", "member-c"]);
    const [, b, c] = trio(sessions);
    const inbound = recordInbound(b);
    const applied = c.dispatch({ type: "reset", payload: {} }, "reset-0");
    await pumpUntil(hub, () => b.getStateModeDiagnostics().revision === 2, "reset commits");
    await applied;
    const commit = inbound
      .map((entry) => entry.payload as { type?: string; revision?: number; stateMode?: string })
      .find((payload) => payload.type === "state.snapshot" && payload.revision === 2);
    expect(commit?.stateMode).toBe("full");
    expect(b.getCanonicalState()?.state).toEqual({ reset: true });
  });

  it("after migration the replicas stay correct on deltas", async () => {
    const { hub, sessions } = await makeDeltaParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    for (const [index] of [0, 1].entries()) {
      const applied = c.dispatch({ type: "bump", payload: {} }, `pre-${index}`);
      await pumpUntil(
        hub,
        () => b.getStateModeDiagnostics().revision === 2 + index,
        `pre ${index}`,
      );
      await applied;
    }
    await a.leave();
    await settleElection(hub);
    await pumpUntil(
      hub,
      () =>
        b.getStateModeDiagnostics().authorityMemberId === "member-b" &&
        c.getStateModeDiagnostics().authorityMemberId === "member-b",
      "migration to member-b",
    );
    const after = c.dispatch({ type: "bump", payload: {} }, "post-0");
    await pumpUntil(hub, () => b.getStateModeDiagnostics().revision === 4, "post-migration delta");
    await pumpUntil(hub, () => c.getStateModeDiagnostics().revision === 4, "c applies the delta");
    await after;
    expect((b.getCanonicalState()?.state as { count: number } | null)?.count).toBe(3);
    expect(c.getCanonicalState()?.state).toEqual(b.getCanonicalState()?.state);
  });

  it("a late joiner receives a full state", async () => {
    const { hub, sessions } = await makeDeltaParty(["member-a", "member-b", "member-c"]);
    const [a, , c] = trio(sessions);
    for (const [index] of [0, 1].entries()) {
      const applied = c.dispatch({ type: "bump", payload: {} }, `late-${index}`);
      await pumpUntil(
        hub,
        () => a.getStateModeDiagnostics().revision === 2 + index,
        `late ${index}`,
      );
      await applied;
    }
    const late = makeSession(hub, "member-d");
    late.client.defineGame({ title: "Delta Game", mode: "state", ...deltaGameHandlers() });
    const lateInbound = recordInbound(late);
    await late.join();
    await pumpUntil(
      hub,
      () => late.getStateModeDiagnostics().revision === a.getStateModeDiagnostics().revision,
      "late joiner catches up",
    );
    const catchUp = lateInbound.find((entry) => entry.type === "state.snapshot") as
      | { payload: { stateMode: string; historyMode: string } }
      | undefined;
    expect(catchUp?.payload.stateMode).toBe("full");
    expect(late.getCanonicalState()?.state).toEqual(a.getCanonicalState()?.state);
  });

  /** Every key shape the protocol refuses must still converge, through a full snapshot. */
  it.each([
    ["a 65-character key", ["k".repeat(65)]],
    ["an empty key", [""]],
    ["a constructor key", ["constructor"]],
  ])("a commit that adds %s is sent in full and every replica converges", async (_label, path) => {
    const { hub, sessions } = await makeDeltaParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    const inbound = recordInbound(b);
    // The sender chooses a full state up front, so no send fails and no fallback is raised.
    const fallbacks: string[] = [];
    a.onSessionEvent((event) => {
      if (event.type === "snapshotFallback") fallbacks.push(event.reason);
    });
    const applied = c.dispatch({ type: "put", payload: { path, value: 7 } }, "put-0");
    await pumpUntil(hub, () => b.getStateModeDiagnostics().revision === 2, "put commits");
    await applied;
    const commit = inbound
      .map((entry) => entry.payload as { type?: string; revision?: number; stateMode?: string })
      .find((payload) => payload.type === "state.snapshot" && payload.revision === 2);
    expect(commit?.stateMode).toBe("full");
    await pumpUntil(hub, () => c.getStateModeDiagnostics().revision === 2, "c applies the commit");
    expect(fallbacks).toEqual([]);
    expect(b.getCanonicalState()?.state).toEqual(a.getCanonicalState()?.state);
    expect(c.getCanonicalState()?.state).toEqual(a.getCanonicalState()?.state);
  });

  it("a change 33 levels deep is sent in full and every replica converges", async () => {
    const { hub, sessions } = await makeDeltaParty(["member-a", "member-b", "member-c"]);
    const [a, b, c] = trio(sessions);
    const path = Array.from({ length: 33 }, (_, index) => `level${index}`);
    // First the deep structure exists (its own delta is shallow)...
    const built = c.dispatch({ type: "put", payload: { path, value: 1 } }, "deep-0");
    await pumpUntil(hub, () => b.getStateModeDiagnostics().revision === 2, "deep structure");
    await built;
    // ...then a change to the leaf 33 levels down cannot be addressed by a delta.
    const inbound = recordInbound(b);
    const changed = c.dispatch({ type: "put", payload: { path, value: 2 } }, "deep-1");
    await pumpUntil(hub, () => b.getStateModeDiagnostics().revision === 3, "deep change");
    await changed;
    const commit = inbound
      .map((entry) => entry.payload as { type?: string; revision?: number; stateMode?: string })
      .find((payload) => payload.type === "state.snapshot" && payload.revision === 3);
    expect(commit?.stateMode).toBe("full");
    await pumpUntil(
      hub,
      () => c.getStateModeDiagnostics().revision === 3,
      "c applies the deep change",
    );
    expect(b.getCanonicalState()?.state).toEqual(a.getCanonicalState()?.state);
    expect(c.getCanonicalState()?.state).toEqual(a.getCanonicalState()?.state);
  });
});

describe("delta robustness (engine)", { timeout: 60_000 }, () => {
  it("a full snapshot without its state asks for a repair instead of being dropped", async () => {
    const { engine, host } = makeEngine("member-b");
    await seedFollower(engine, 1, { count: 0 });
    engine.handleSnapshot({
      revision: 2,
      stateHash: null,
      term: 1,
      authorityMemberId: "member-a",
      historyMode: "full",
      processedActionIds: [],
      state: undefined,
      senderMemberId: "member-a",
    });
    expect(engine.getRevision()).toBe(1);
    expect(host.resyncs).toEqual([{ target: "member-a", request: { knownRevision: 1 } }]);
  });

  it("a synchronous hash failure during a delta does not leave the engine holding traffic", async () => {
    let failHash = false;
    // A plain (not async) function: the failure is thrown synchronously.
    const { engine, host } = makeEngine("member-b", {
      stateHash: (value) => {
        if (failHash) throw new Error("hash backend unavailable");
        return stateHashOf(value);
      },
    });
    await seedFollower(engine, 1, { count: 0 });
    const hash1 = await stateHashOf({ count: 0 });
    failHash = true;
    engine.handleSnapshot({
      revision: 2,
      stateHash: await stateHashOf({ count: 1 }),
      term: 1,
      authorityMemberId: "member-a",
      historyMode: "increment",
      baseStateHash: hash1,
      stateMode: "delta",
      ops: [{ op: "set", path: ["count"], value: 1 }],
      processedActionIds: ["x"],
      senderMemberId: "member-a",
    });
    expect(engine.isDeltaPending()).toBe(false);
    expect(host.resyncs).toHaveLength(1);
    // The engine is not wedged: a later full snapshot is applied.
    failHash = false;
    engine.handleSnapshot({
      revision: 3,
      stateHash: await stateHashOf({ count: 5 }),
      term: 1,
      authorityMemberId: "member-a",
      historyMode: "full",
      processedActionIds: [],
      state: { count: 5 },
      senderMemberId: "member-a",
    });
    expect(engine.getRevision()).toBe(3);
  });

  it("a delta that cannot be sent falls back to the full state and reports a diagnostic", async () => {
    const big = {
      createInitialState: () => ({
        count: 0,
        table: Object.fromEntries(
          Array.from({ length: 40 }, (_, i) => [`pad-${i}`, "static value that never changes"]),
        ),
      }),
      actions: {
        bump(draft: { count: number }) {
          draft.count += 1;
        },
      },
    };
    const host = new RecordingHost();
    const sentEnvelopes: Array<{ stateMode: string }> = [];
    host.sendSnapshot = (snapshot, target) => {
      sentEnvelopes.push({ stateMode: snapshot.stateMode });
      if (snapshot.stateMode === "delta") throw new Error("transport refused the delta");
      host.snapshots.push({ target, snapshot });
    };
    const engine = trackEngine(
      new NovaStateEngine({
        host,
        executor: new LocalGameExecutor(big),
        selfMemberId: "member-a",
        ...ENGINE_TIMINGS,
      }),
    );
    engine.beginGame();
    expect(await engine.initializeAsAuthority()).toBe(true);
    engine.handleLocalAction({ actionId: "bump-1", type: "bump", payload: {}, baseRevision: 1 });
    await waitForEngine(() => engine.getRevision() === 2, "bump commits");
    expect(sentEnvelopes.map((entry) => entry.stateMode)).toEqual(["full", "delta", "full"]);
    expect(host.events).toContainEqual(expect.objectContaining({ type: "snapshotFallback" }));
    expect(host.snapshots[host.snapshots.length - 1]?.snapshot.revision).toBe(2);
  });
});
