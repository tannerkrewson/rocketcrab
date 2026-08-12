/**
 * A1 simulation-engine unit tests.
 *
 * The engine is tested in isolation with fake timers and a recording host:
 * the local tick clock, snapshot production (the game's serializeState
 * callback), snapshot retention and replication, restore after authority
 * migration (adopt highest valid snapshot, hash-checked), follower pushes,
 * input rate bounding, latency/drift reporting, clock resync, stale-term
 * gating, and snapshot size bounds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stateHashOf } from "./state-engine";
import {
  LocalSimulationExecutor,
  NovaSimulationEngine,
  type NovaSimulationExecutor,
  type SimulationEngineEvent,
  type SimulationEngineHost,
  type SimulationSnapshotEnvelope,
} from "./simulation-engine";
import type { NovaPlayer } from "./types";

const PLAYERS: NovaPlayer[] = [
  { id: "member-a", name: "Ada" },
  { id: "member-b", name: "Ben" },
];

/** A recording host: every snapshot/event is captured for assertions. */
class RecordingHost implements SimulationEngineHost {
  readonly snapshots: Array<{ target?: string; snapshot: SimulationSnapshotEnvelope }> = [];
  readonly events: SimulationEngineEvent[] = [];

  players(): readonly NovaPlayer[] {
    return [...PLAYERS];
  }
  sendSnapshot(snapshot: SimulationSnapshotEnvelope, targetMemberId?: string): void {
    this.snapshots.push({ target: targetMemberId, snapshot });
  }
  emit(event: SimulationEngineEvent): void {
    this.events.push(event);
  }
}

/** The test game: a serialized counter that the test can mutate. */
function counterExecutor(initial = 1): { executor: NovaSimulationExecutor; bump: () => void } {
  let value = initial;
  return {
    executor: {
      async serializeState() {
        return { ok: true as const, state: { count: value } };
      },
    },
    bump() {
      value += 1;
    },
  };
}

/** Every engine created in this file (disposed after each test). */
const createdEngines: NovaSimulationEngine[] = [];

function track(engine: NovaSimulationEngine): NovaSimulationEngine {
  createdEngines.push(engine);
  return engine;
}

function makeEngine(
  selfMemberId: string,
  options: Partial<{
    executor: NovaSimulationExecutor;
    tickMs: number;
    snapshotIntervalMs: number;
    restoreWindowMs: number;
    now: () => number;
  }> = {},
): { engine: NovaSimulationEngine; host: RecordingHost } {
  const host = new RecordingHost();
  const engine = track(
    new NovaSimulationEngine({
      host,
      executor: options.executor ?? counterExecutor().executor,
      selfMemberId,
      tickMs: options.tickMs ?? 100,
      snapshotIntervalMs: options.snapshotIntervalMs ?? 500,
      restoreWindowMs: options.restoreWindowMs ?? 100,
      ...(options.now !== undefined ? { now: options.now } : {}),
    }),
  );
  return { engine, host };
}

const TICKS: Array<{ engine: NovaSimulationEngine; host: RecordingHost }> = [];
const TIMINGS = { tickMs: 100, snapshotIntervalMs: 500, restoreWindowMs: 100 };

function makeTimedEngine(
  selfMemberId: string,
  executor?: NovaSimulationExecutor,
  now?: () => number,
): { engine: NovaSimulationEngine; host: RecordingHost } {
  const pair = makeEngine(selfMemberId, {
    executor,
    tickMs: TIMINGS.tickMs,
    snapshotIntervalMs: TIMINGS.snapshotIntervalMs,
    restoreWindowMs: TIMINGS.restoreWindowMs,
    ...(now !== undefined ? { now } : {}),
  });
  TICKS.push(pair);
  return pair;
}

describe(
  "NovaSimulationEngine",
  // Wall-clock waits (WAIT_BUDGET_MS) can legitimately exceed vitest's 5s
  // default under CPU contention in parallel runs.
  { timeout: 60_000 },
  () => {
    beforeEach(() => {
      // setImmediate stays REAL so tests can yield to the event loop for
      // real-async steps (crypto digest) while engine timers are faked.
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
      });
    });

    afterEach(() => {
      for (const pair of TICKS) {
        pair.engine.dispose();
      }
      TICKS.length = 0;
      for (const engine of createdEngines) {
        engine.dispose();
      }
      createdEngines.length = 0;
      vi.useRealTimers();
    });

    // ------------------------------------------------------------------
    // The clock
    // ------------------------------------------------------------------

    it("advances the local tick on the configured cadence", () => {
      const { engine, host } = makeTimedEngine("member-a");
      engine.begin();
      expect(engine.getTick()).toBe(0);
      vi.advanceTimersByTime(300);
      expect(engine.getTick()).toBe(3);
      expect(host.events.filter((event) => event.type === "tick")).toEqual([
        { type: "tick", tick: 1 },
        { type: "tick", tick: 2 },
        { type: "tick", tick: 3 },
      ]);
      // The clock stops at end.
      engine.end();
      vi.advanceTimersByTime(300);
      expect(engine.getTick()).toBe(3);
    });

    it("clamps the tick interval into the Nova bounds", () => {
      const { engine, host } = makeEngine("member-a", { tickMs: 1, snapshotIntervalMs: 5 });
      engine.begin();
      vi.advanceTimersByTime(32);
      expect(engine.getTick()).toBe(2); // 16 ms min: 2 ticks in 32 ms
      expect(host.events.filter((event) => event.type === "tick")).toHaveLength(2);
    });

    // ------------------------------------------------------------------
    // Snapshot production
    // ------------------------------------------------------------------

    it("produces authoritative snapshots on the cadence and retains them", async () => {
      const game = counterExecutor(7);
      const { engine, host } = makeTimedEngine("member-a", game.executor);
      engine.onAuthorityChanged("member-a", 1);
      engine.begin();
      vi.advanceTimersByTime(500); // the first snapshot fires at the cadence
      await waitUntil(() => host.snapshots.length >= 1, "first snapshot");
      const sent = host.snapshots[0];
      expect(sent?.target).toBeUndefined(); // broadcast
      expect(sent?.snapshot).toMatchObject({
        tick: 5,
        state: { count: 7 },
        term: 1,
        authorityMemberId: "member-a",
      });
      expect(sent?.snapshot.stateHash).toMatch(/^[0-9a-f]{64}$/);
      // The produced snapshot is the retained replication copy.
      expect(engine.getLatestSnapshot()?.state).toEqual({ count: 7 });
      expect(engine.getLatestSnapshot()?.tick).toBe(5);
      // Diagnostics expose the cadence and snapshot age.
      const diagnostics = engine.getDiagnostics();
      expect(diagnostics.tickMs).toBe(100);
      expect(diagnostics.snapshotIntervalMs).toBe(500);
      expect(diagnostics.snapshotsReceived).toBe(0); // produced, not received
      expect(diagnostics.snapshotAgeMs).toBe(0);
      expect(diagnostics.snapshotSizeBytes).toBeGreaterThan(0);
      expect(diagnostics.authorityMemberId).toBe("member-a");
      expect(diagnostics.term).toBe(1);
      // The cadence repeats.
      vi.advanceTimersByTime(500);
      await waitUntil(() => host.snapshots.length >= 2, "second snapshot");
    });

    it("emits a clear error when the game has no serializeState handler", async () => {
      const { engine, host } = makeTimedEngine("member-a", new LocalSimulationExecutor(null));
      engine.onAuthorityChanged("member-a", 1);
      engine.begin();
      vi.advanceTimersByTime(500);
      await waitUntil(
        () => host.events.some((event) => event.type === "error"),
        "no-serializeState error",
      );
      expect(host.snapshots).toHaveLength(0);
      expect(host.events).toContainEqual({
        type: "error",
        code: "no_snapshot_handler",
        message: expect.stringContaining("serializeState") as unknown as string,
      });
    });

    it("emits a clear error when serializeState throws", async () => {
      const { engine, host } = makeTimedEngine("member-a", {
        async serializeState() {
          throw new Error("game exploded");
        },
      });
      engine.onAuthorityChanged("member-a", 1);
      engine.begin();
      vi.advanceTimersByTime(500);
      await waitUntil(() => host.events.some((event) => event.type === "error"), "serialize error");
      expect(host.snapshots).toHaveLength(0);
      expect(host.events).toContainEqual({
        type: "error",
        code: "snapshot_error",
        message: "game exploded",
      });
    });

    it("skips snapshots above the size bound", async () => {
      const big = { blob: "x".repeat(600 * 1024) };
      const { engine, host } = makeTimedEngine("member-a", {
        async serializeState() {
          return { ok: true as const, state: big };
        },
      });
      engine.onAuthorityChanged("member-a", 1);
      engine.begin();
      vi.advanceTimersByTime(500);
      await waitUntil(() => host.events.some((event) => event.type === "error"), "size error");
      expect(host.snapshots).toHaveLength(0);
      expect(host.events).toContainEqual({
        type: "error",
        code: "state_too_large",
        message: expect.stringContaining("hard limit") as unknown as string,
      });
    });

    it("does not produce snapshots as a follower or before starting", async () => {
      const { engine, host } = makeTimedEngine("member-a");
      engine.onAuthorityChanged("member-b", 1); // follower
      engine.begin();
      vi.advanceTimersByTime(2_000);
      expect(host.snapshots).toHaveLength(0);
    });

    // ------------------------------------------------------------------
    // Replication and restore after migration
    // ------------------------------------------------------------------

    it("retains replicated snapshots (highest tick wins) and reports them", () => {
      const { engine, host } = makeTimedEngine("member-b");
      const received = engine.handleSnapshot({
        tick: 10,
        term: 1,
        authorityMemberId: "member-a",
        stateHash: "a".repeat(64),
        state: { count: 10 },
        sentAt: 0,
      });
      expect(received).toEqual({ tick: 10, state: { count: 10 }, stateHash: "a".repeat(64) });
      expect(host.events).toHaveLength(0); // the session delivers to the frame
      engine.handleSnapshot({
        tick: 8, // older: kept only as a delivered correction, not retained
        term: 1,
        authorityMemberId: "member-a",
        stateHash: "b".repeat(64),
        state: { count: 8 },
        sentAt: 0,
      });
      expect(engine.getLatestSnapshot()?.tick).toBe(10);
      const diagnostics = engine.getDiagnostics();
      expect(diagnostics.snapshotsReceived).toBe(2);
      expect(diagnostics.authorityTick).toBe(10);
      expect(diagnostics.authorityMemberId).toBe("member-a");
    });

    it("drops stale-term snapshots", () => {
      const { engine } = makeTimedEngine("member-b");
      engine.onAuthorityChanged("member-b", 3); // term 3
      const received = engine.handleSnapshot({
        tick: 50,
        term: 2, // stale term
        authorityMemberId: "member-a",
        stateHash: "a".repeat(64),
        state: { count: 50 },
        sentAt: 0,
      });
      expect(received).toBeNull();
      expect(engine.getLatestSnapshot()).toBeNull();
      expect(engine.getDiagnostics().term).toBe(3);
    });

    it("restores after migration: adopts the highest push and re-broadcasts", async () => {
      // B holds a replicated snapshot, then becomes the elected authority.
      const { engine, host } = makeTimedEngine("member-b");
      engine.handleSnapshot({
        tick: 10,
        term: 1,
        authorityMemberId: "member-a",
        stateHash: null,
        state: { count: 10 },
        sentAt: 0,
      });
      engine.onAuthorityChanged("member-b", 2); // election: B wins term 2
      // A peer push with a higher snapshot arrives during the restore window.
      const higher = await stateHashOf({ count: 14 });
      engine.handleSnapshot({
        tick: 14,
        term: 2,
        authorityMemberId: "member-b",
        stateHash: higher,
        state: { count: 14 },
        sentAt: 0,
      });
      // The restore window closes: the highest valid snapshot is adopted and
      // re-broadcast as a correction (restore after authority migration).
      vi.advanceTimersByTime(100);
      await waitUntil(() => host.snapshots.length >= 1, "restore re-broadcast");
      expect(engine.getLatestSnapshot()).toEqual({
        tick: 14,
        state: { count: 14 },
        stateHash: higher,
      });
      const rebroadcast = host.snapshots.at(-1);
      expect(rebroadcast?.snapshot).toMatchObject({
        tick: 14,
        state: { count: 14 },
        term: 2,
        authorityMemberId: "member-b",
      });
      expect(rebroadcast?.target).toBeUndefined();
    });

    it("keeps the previous valid snapshot when the adopted push fails its hash", async () => {
      const { engine, host } = makeTimedEngine("member-b");
      const prior = await stateHashOf({ count: 10 });
      engine.handleSnapshot({
        tick: 10,
        term: 1,
        authorityMemberId: "member-a",
        stateHash: prior,
        state: { count: 10 },
        sentAt: 0,
      });
      engine.onAuthorityChanged("member-b", 2);
      engine.handleSnapshot({
        tick: 12,
        term: 2,
        authorityMemberId: "member-b",
        stateHash: "f".repeat(64), // does not match sha256({count: 12})
        state: { count: 12 },
        sentAt: 0,
      });
      vi.advanceTimersByTime(100);
      await waitUntil(() => host.snapshots.length >= 1, "restore re-broadcast");
      expect(engine.getLatestSnapshot()).toEqual({
        tick: 10,
        state: { count: 10 },
        stateHash: prior,
      });
      expect(host.events).toContainEqual({
        type: "error",
        code: "invalid_snapshot",
        message: expect.stringContaining("hash") as unknown as string,
      });
      // The previous valid snapshot is re-broadcast (restore still works).
      const rebroadcast = host.snapshots.at(-1);
      expect(rebroadcast?.snapshot.state).toEqual({ count: 10 });
    });

    it("pushes its retained snapshot to a newly announced authority (follower)", async () => {
      const { engine, host } = makeTimedEngine("member-b");
      engine.handleSnapshot({
        tick: 9,
        term: 1,
        authorityMemberId: "member-a",
        stateHash: null,
        state: { count: 9 },
        sentAt: 0,
      });
      // The authority migrated from A to C.
      engine.onAuthorityChanged("member-c", 2);
      expect(host.snapshots.at(-1)).toMatchObject({
        target: "member-c",
        snapshot: { tick: 9, state: { count: 9 }, term: 2, authorityMemberId: "member-c" },
      });
      // The cadence is stopped as a follower.
      engine.begin();
      vi.advanceTimersByTime(2_000);
      expect(host.snapshots.filter((send) => send.target === undefined)).toHaveLength(0);
    });

    // ------------------------------------------------------------------
    // Input rate bounds, latency, and drift
    // ------------------------------------------------------------------

    it("bounds input sends by the per-second rate", () => {
      const { engine } = makeTimedEngine("member-a");
      for (let i = 0; i < 600; i += 1) {
        expect(engine.recordInputSent()).toBe(true);
      }
      expect(engine.recordInputSent()).toBe(false); // 60/s over a 10 s window
      expect(engine.recordInputSent()).toBe(false);
      const diagnostics = engine.getDiagnostics();
      expect(diagnostics.inputsSent).toBe(600);
      expect(diagnostics.rateLimitRejections).toBe(2);
    });

    it("reports input latency and high latency", () => {
      let now = 1_000_000;
      const { engine } = makeTimedEngine("member-a", undefined, () => now);
      engine.handleInputReceived(1_000_000 - 80); // 80 ms latency
      engine.handleInputReceived(1_000_000 - 120); // 120 ms latency
      expect(engine.getDiagnostics().inputLatencyMs).toBe(100);
      expect(engine.getDiagnostics().highLatency).toBe(false);
      expect(engine.getDiagnostics().inputsReceived).toBe(2);
      // A high-latency sample pushes the window average over the 500 ms
      // threshold (latency is reported as the window average).
      engine.handleInputReceived(1_000_000 - 2_000);
      expect(engine.getDiagnostics().highLatency).toBe(true);
      expect(engine.getDiagnostics().inputLatencyMs).toBeCloseTo(733.33, 0);
    });

    it("resyncs the local clock to the authority's snapshot clock on drift", () => {
      let now = 1_000_000;
      const { engine } = makeTimedEngine("member-a", undefined, () => now);
      engine.begin();
      vi.advanceTimersByTime(500); // local tick 5
      // The authority is far ahead: a snapshot at tick 10 sent 50 ms ago.
      now += 50;
      engine.handleSnapshot({
        tick: 10,
        term: 1,
        authorityMemberId: "member-a",
        stateHash: null,
        state: {},
        sentAt: now - 50,
      });
      // Expected tick = 10 + 50/100 = 10.5 → resync to 11.
      expect(engine.getTick()).toBe(11);
      expect(engine.getDiagnostics().driftTicks).toBe(0); // realigned
      // Small drift does not resync.
      engine.handleSnapshot({
        tick: 11,
        term: 1,
        authorityMemberId: "member-a",
        stateHash: null,
        state: {},
        sentAt: now,
      });
      expect(engine.getTick()).toBe(11);
      expect(engine.getDiagnostics().driftTicks).toBe(0);
    });

    it("exposes complete diagnostics", () => {
      const { engine } = makeTimedEngine("member-a");
      engine.onAuthorityChanged("member-a", 4);
      const diagnostics = engine.getDiagnostics();
      expect(diagnostics).toMatchObject({
        tick: 0,
        tickMs: 100,
        snapshotIntervalMs: 500,
        authorityTick: null,
        authorityMemberId: "member-a",
        term: 4,
        lastSnapshotAt: null,
        snapshotAgeMs: null,
        inputsSent: 0,
        inputsReceived: 0,
        rateLimitRejections: 0,
        inputRatePerSecond: 0,
        inputLatencyMs: null,
        highLatency: false,
        driftTicks: 0,
        snapshotsReceived: 0,
        snapshotSizeBytes: null,
      });
    });
  },
);

/** Node's real macrotask (NOT faked by the test timers). */
declare function setImmediate(callback: () => void): unknown;

/**
 * Wall-clock budget for `waitUntil`. The engine's real-async work (sha256
 * digests) slows down arbitrarily under CPU contention in parallel CI runs,
 * so a fixed poll-count budget flakes (rocketcrab-9fv.7.24 / 7.32).
 * `performance.now` is NOT faked by the test timers, so a generous
 * wall-clock deadline is deterministic; the loop exits as soon as the
 * condition holds, so the budget is only consumed when something is
 * genuinely wedged.
 */
const WAIT_BUDGET_MS = 30_000;

/**
 * Wait until `condition` holds, yielding to the real event loop (crypto
 * digests complete on the threadpool, not in microtask turns). Bounded by
 * wall-clock time rather than a fixed poll count.
 */
async function waitUntil(condition: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + WAIT_BUDGET_MS;
  while (performance.now() < deadline) {
    if (condition()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${what}`);
}
