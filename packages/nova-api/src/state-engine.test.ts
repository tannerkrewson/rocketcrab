/**
 * S2 state-engine unit tests: the action protocol guarantees from the
 * issue's acceptance criteria — duplicate, stale, malformed, late, and
 * timed-out actions; exactly-once application; sequential execution;
 * per-player views; bounded history; and the invariant that an
 * authority-runtime failure never corrupts the last committed state.
 *
 * The engine is exercised through a recording fake host and the real
 * {@link LocalGameExecutor} (immer), so the tests cover the same code path
 * the arena uses over either transport.
 */
import { describe, expect, it, vi } from "vitest";
import { actionPayloadBytes, stateSnapshotBytes } from "@rocketcrab/protocol";
import {
  NovaStateEngine,
  type AuthorityAnnounceEnvelope,
  type StateEngineEvent,
  type StateEngineHost,
  type StateSnapshotEnvelope,
  type StateViewEnvelope,
} from "./state-engine";
import { LocalGameExecutor, type NovaStateExecutor } from "./state-executor";
import type { NovaActionAck, NovaPlayer, NovaStateHandlers } from "./types";

const PLAYERS: NovaPlayer[] = [
  { id: "member-a", name: "Ada" },
  { id: "member-b", name: "Ben" },
];

/** A recording host: every send/event is captured for assertions. */
class RecordingHost implements StateEngineHost {
  readonly acks: Array<{ target: string; ack: NovaActionAck }> = [];
  readonly snapshots: Array<{ target?: string; snapshot: StateSnapshotEnvelope }> = [];
  readonly views: Array<{ target: string; view: StateViewEnvelope }> = [];
  readonly announces: AuthorityAnnounceEnvelope[] = [];
  readonly events: StateEngineEvent[] = [];
  connected = new Set<string>(PLAYERS.map((player) => player.id));

  players(): readonly NovaPlayer[] {
    return [...PLAYERS];
  }
  isConnected(memberId: string): boolean {
    return this.connected.has(memberId);
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
  emit(event: StateEngineEvent): void {
    this.events.push(event);
  }
}

/** The test game: a counter that also tracks the acting player. */
function handlers(overrides: Partial<NovaStateHandlers> = {}): NovaStateHandlers {
  return {
    createInitialState: () => ({ count: 0, lastActor: null }),
    actions: {
      increment(
        draft: { count: number; lastActor: string | null },
        context,
        payload: { by?: number },
      ) {
        draft.count += payload.by ?? 1;
        draft.lastActor = context.actor?.id ?? null;
      },
    },
    selectView: (state: { count: number }, viewer) => ({
      count: state.count,
      for: viewer.id,
    }),
    ...overrides,
  };
}

async function makeEngine(
  options: {
    executor?: NovaStateExecutor;
    now?: () => number;
    historyLimit?: number;
    executorTimeoutMs?: number;
  } = {},
): Promise<{ engine: NovaStateEngine; host: RecordingHost; now: () => number }> {
  const host = new RecordingHost();
  const now = options.now ?? (() => 1_700_000_000_000);
  const engine = new NovaStateEngine({
    host,
    executor: options.executor ?? new LocalGameExecutor(handlers()),
    selfMemberId: "member-a",
    now,
    ...(options.historyLimit !== undefined ? { historyLimit: options.historyLimit } : {}),
    ...(options.executorTimeoutMs !== undefined
      ? { executorTimeoutMs: options.executorTimeoutMs }
      : {}),
  });
  engine.beginGame();
  const ok = await engine.initializeAsAuthority();
  expect(ok).toBe(true);
  return { engine, host, now };
}

/** Start the engine and return it with a committed revision 1. */
async function startedEngine(options: { historyLimit?: number } = {}): Promise<{
  engine: NovaStateEngine;
  host: RecordingHost;
}> {
  const { engine, host } = await makeEngine(options);
  expect(host.snapshots).toHaveLength(1);
  expect(host.snapshots[0]?.snapshot.revision).toBe(1);
  return { engine, host };
}

describe("NovaStateEngine authority start", () => {
  it("creates the initial state, publishes revision 1 with a hash, views, and an announce", async () => {
    const { engine, host } = await startedEngine();
    const snapshot = host.snapshots[0]?.snapshot;
    expect(snapshot?.revision).toBe(1);
    expect(snapshot?.state).toEqual({ count: 0, lastActor: null });
    expect(snapshot?.stateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot?.authorityMemberId).toBe("member-a");
    expect(host.views).toHaveLength(2);
    expect(host.views[0]?.view.view).toEqual({ count: 0, for: "member-a" });
    expect(host.views[1]?.view.view).toEqual({ count: 0, for: "member-b" });
    expect(host.announces).toHaveLength(1);
    expect(host.announces[0]?.authorityMemberId).toBe("member-a");
    expect(host.announces[0]?.stateRevision).toBe(1);
    const diagnostics = engine.getDiagnostics();
    expect(diagnostics.revision).toBe(1);
    expect(diagnostics.stateSizeBytes).toBeGreaterThan(0);
    expect(diagnostics.stateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(diagnostics.authorityMemberId).toBe("member-a");
    expect(diagnostics.appliedCount).toBe(1); // the initial commit
  });

  it("rejects an unstarted game: actions before start are refused", async () => {
    const host = new RecordingHost();
    const engine = new NovaStateEngine({
      host,
      executor: new LocalGameExecutor(handlers()),
      selfMemberId: "member-a",
    });
    engine.handleInboundAction({
      actionId: "action-x",
      seq: 1,
      actionType: "increment",
      payload: {},
      baseRevision: 0,
      sentAt: 1_700_000_000_000,
      senderMemberId: "member-b",
    });
    expect(host.acks).toHaveLength(1);
    expect(host.acks[0]?.ack.status).toBe("rejected");
    expect(host.acks[0]?.ack.errorCode).toBe("not_started");
    expect(host.snapshots).toHaveLength(0);
  });
});

describe("NovaStateEngine action protocol", () => {
  it("applies actions sequentially and increments revisions with per-player views", async () => {
    const { engine, host } = await startedEngine();
    engine.handleLocalAction({
      actionId: "action-1",
      type: "increment",
      payload: { by: 2 },
      baseRevision: 1,
    });
    await engine.flushPending();
    engine.handleInboundAction({
      actionId: "action-2",
      seq: 1,
      actionType: "increment",
      payload: { by: 3 },
      baseRevision: 2,
      sentAt: 1_700_000_000_000,
      senderMemberId: "member-b",
    });
    await engine.flushPending();
    expect(engine.getDiagnostics().revision).toBe(3);
    const lastSnapshot = host.snapshots.at(-1)?.snapshot;
    expect(lastSnapshot?.state).toEqual({ count: 5, lastActor: "member-b" });
    expect(lastSnapshot?.revision).toBe(3);
    const acceptedAcks = host.acks.filter((ack) => ack.ack.status === "accepted");
    expect(acceptedAcks).toHaveLength(2);
    expect(acceptedAcks[0]?.ack.revision).toBe(2);
    expect(acceptedAcks[1]?.ack.revision).toBe(3);
    // Views after the last commit reflect the actor.
    const bView = host.views.at(-1);
    expect(bView?.view.view).toEqual({ count: 5, for: "member-b" });
    expect(host.events.filter((e) => e.type === "stateCommitted")).toHaveLength(3);
  });

  it("processes duplicate actions exactly once and replays the ack", async () => {
    const { engine, host } = await startedEngine();
    engine.handleLocalAction({
      actionId: "action-dup",
      type: "increment",
      payload: {},
      baseRevision: 1,
    });
    await engine.flushPending();
    expect(engine.getDiagnostics().revision).toBe(2);
    expect(host.snapshots).toHaveLength(2);
    // The transport re-delivers the same action id.
    engine.handleLocalAction({
      actionId: "action-dup",
      type: "increment",
      payload: {},
      baseRevision: 1,
    });
    await engine.flushPending();
    // No second apply: revision and snapshot count unchanged.
    expect(engine.getDiagnostics().revision).toBe(2);
    expect(host.snapshots).toHaveLength(2);
    const dupAcks = host.acks.filter((ack) => ack.ack.actionId === "action-dup");
    expect(dupAcks).toHaveLength(2);
    expect(dupAcks[0]?.ack.status).toBe("accepted");
    expect(dupAcks[1]?.ack.status).toBe("accepted");
    expect(dupAcks[1]?.ack.revision).toBe(2);
  });

  it("rejects stale actions (wrong base revision) as superseded without mutating state", async () => {
    const { engine, host } = await startedEngine();
    engine.handleInboundAction({
      actionId: "action-stale",
      seq: 1,
      actionType: "increment",
      payload: {},
      baseRevision: 0, // based on a state that never existed
      sentAt: 1_700_000_000_000,
      senderMemberId: "member-b",
    });
    await engine.flushPending();
    expect(engine.getDiagnostics().revision).toBe(1);
    expect(host.snapshots).toHaveLength(1);
    const ack = host.acks.find((ack) => ack.ack.actionId === "action-stale");
    expect(ack?.ack.status).toBe("superseded");
    expect(ack?.ack.errorCode).toBe("stale_revision");
    expect(ack?.ack.errorMessage).toContain("current revision is 1");
    expect(host.events.some((e) => e.type === "actionRejected")).toBe(true);
  });

  it("rejects timed-out actions", async () => {
    const { engine, host } = await startedEngine();
    engine.handleInboundAction({
      actionId: "action-late",
      seq: 1,
      actionType: "increment",
      payload: {},
      baseRevision: 1,
      sentAt: 1_700_000_000_000 - 60_000,
      expiresAtMs: 1_700_000_000_000 - 1, // already expired
      senderMemberId: "member-b",
    });
    await engine.flushPending();
    expect(engine.getDiagnostics().revision).toBe(1);
    const ack = host.acks.find((ack) => ack.ack.actionId === "action-late");
    expect(ack?.ack.status).toBe("rejected");
    expect(ack?.ack.errorCode).toBe("timed_out");
  });

  it("rejects malformed actions (payload too large) without mutating state", async () => {
    const { engine, host } = await startedEngine();
    const big = "x".repeat(actionPayloadBytes + 1);
    engine.handleInboundAction({
      actionId: "action-big",
      seq: 1,
      actionType: "increment",
      payload: { blob: big },
      baseRevision: 1,
      sentAt: 1_700_000_000_000,
      senderMemberId: "member-b",
    });
    await engine.flushPending();
    expect(engine.getDiagnostics().revision).toBe(1);
    const ack = host.acks.find((ack) => ack.ack.actionId === "action-big");
    expect(ack?.ack.errorCode).toBe("payload_too_large");
  });

  it("rejects late actions after the game ended", async () => {
    const { engine, host } = await startedEngine();
    engine.endGame();
    engine.handleInboundAction({
      actionId: "action-late-end",
      seq: 1,
      actionType: "increment",
      payload: {},
      baseRevision: 1,
      sentAt: 1_700_000_000_000,
      senderMemberId: "member-b",
    });
    await engine.flushPending();
    const ack = host.acks.find((ack) => ack.ack.actionId === "action-late-end");
    expect(ack?.ack.status).toBe("rejected");
    expect(ack?.ack.errorCode).toBe("game_ended");
  });

  it("rejects unknown action types with unknown_action", async () => {
    const { engine, host } = await startedEngine();
    engine.handleLocalAction({
      actionId: "action-unknown",
      type: "noSuchAction",
      payload: {},
      baseRevision: 1,
    });
    await engine.flushPending();
    expect(engine.getDiagnostics().revision).toBe(1);
    const ack = host.acks.find((ack) => ack.ack.actionId === "action-unknown");
    expect(ack?.ack.status).toBe("rejected");
    expect(ack?.ack.errorCode).toBe("unknown_action");
  });

  it("rejects handler errors without mutating state", async () => {
    const { engine, host } = await makeEngine({
      executor: new LocalGameExecutor(
        handlers({
          actions: {
            explode: () => {
              throw new Error("boom");
            },
          },
        }),
      ),
    });
    engine.handleLocalAction({
      actionId: "action-throws",
      type: "explode",
      payload: {},
      baseRevision: 1,
    });
    await engine.flushPending();
    expect(engine.getDiagnostics().revision).toBe(1);
    const ack = host.acks.find((ack) => ack.ack.actionId === "action-throws");
    expect(ack?.ack.status).toBe("rejected");
    expect(ack?.ack.errorCode).toBe("handler_error");
    expect(ack?.ack.errorMessage).toContain("boom");
  });

  it("rejects a state that grows past the snapshot bound", async () => {
    const { engine, host } = await makeEngine({
      executor: new LocalGameExecutor(
        handlers({
          actions: {
            huge: (draft: { blob: string }) => {
              draft.blob = "x".repeat(stateSnapshotBytes);
            },
          },
        }),
      ),
    });
    engine.handleLocalAction({
      actionId: "action-huge",
      type: "huge",
      payload: {},
      baseRevision: 1,
    });
    await engine.flushPending();
    expect(engine.getDiagnostics().revision).toBe(1);
    const ack = host.acks.find((ack) => ack.ack.actionId === "action-huge");
    expect(ack?.ack.errorCode).toBe("state_too_large");
    expect(host.snapshots).toHaveLength(1); // no new commit
  });

  it("does not corrupt the last committed state when the executor fails", async () => {
    const failing: NovaStateExecutor = {
      createInitialState: async () => ({ ok: true, state: { count: 0 }, views: {} }),
      applyAction: async () => ({
        ok: false,
        code: "execution_failed",
        message: "the authority frame crashed",
      }),
      computeView: async () => ({ ok: false, code: "view_error", message: "no view" }),
    };
    const { engine, host } = await makeEngine({ executor: failing });
    expect(engine.getDiagnostics().revision).toBe(1);
    engine.handleLocalAction({
      actionId: "action-crash",
      type: "increment",
      payload: {},
      baseRevision: 1,
    });
    await engine.flushPending();
    expect(engine.getDiagnostics().revision).toBe(1); // last committed state intact
    expect(engine.getCanonicalState()).toEqual({ count: 0 });
    expect(host.snapshots).toHaveLength(1);
    const ack = host.acks.find((ack) => ack.ack.actionId === "action-crash");
    expect(ack?.ack.errorCode).toBe("execution_failed");
    expect(host.events.some((e) => e.type === "stateError")).toBe(true);
  });

  it("rejects actions whose executor never answers (executor timeout)", async () => {
    vi.useFakeTimers();
    try {
      const never: NovaStateExecutor = {
        createInitialState: async () => ({ ok: true, state: { count: 0 }, views: {} }),
        applyAction: () => new Promise(() => {}), // never settles
        computeView: async () => ({ ok: false, code: "view_error", message: "x" }),
      };
      const { engine, host } = await makeEngine({ executor: never, executorTimeoutMs: 50 });
      engine.handleLocalAction({
        actionId: "action-hang",
        type: "increment",
        payload: {},
        baseRevision: 1,
      });
      const pending = engine.flushPending();
      await vi.advanceTimersByTimeAsync(100);
      await pending;
      expect(engine.getDiagnostics().revision).toBe(1);
      const ack = host.acks.find((ack) => ack.ack.actionId === "action-hang");
      expect(ack?.ack.errorCode).toBe("execution_timeout");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("NovaStateEngine views and replication", () => {
  it("computes per-player views through selectView", async () => {
    const { engine, host } = await startedEngine();
    engine.handleLocalAction({
      actionId: "action-view",
      type: "increment",
      payload: {},
      baseRevision: 1,
    });
    await engine.flushPending();
    const bViews = host.views.filter((entry) => entry.target === "member-b");
    expect(bViews).toHaveLength(2); // initial + after the action
    expect(bViews.at(-1)?.view.view).toEqual({ count: 1, for: "member-b" });
    const aViews = host.views.filter((entry) => entry.target === "member-a");
    expect(aViews.at(-1)?.view.view).toEqual({ count: 1, for: "member-a" });
  });

  it("keeps the previous view when selectView fails for one player", async () => {
    const { engine, host } = await makeEngine({
      executor: new LocalGameExecutor(
        handlers({
          selectView: (state, viewer) => {
            if (viewer.id === "member-b") {
              throw new Error("no view for ben");
            }
            return state;
          },
        }),
      ),
    });
    expect(engine.getDiagnostics().revision).toBe(1); // initial commit happened
    engine.handleLocalAction({
      actionId: "action-view-error",
      type: "increment",
      payload: {},
      baseRevision: 1,
    });
    await engine.flushPending();
    // The action still committed (revision 2) but member-b never got a view.
    expect(engine.getDiagnostics().revision).toBe(2);
    expect(host.views.filter((v) => v.target === "member-b")).toHaveLength(0);
    expect(host.events.some((e) => e.type === "stateError" && e.code === "view_error")).toBe(true);
  });

  it("replicates snapshots into follower shells with processed action ids", async () => {
    const host = new RecordingHost();
    const follower = new NovaStateEngine({
      host,
      executor: new LocalGameExecutor(null),
      selfMemberId: "member-b",
    });
    follower.handleSnapshot({
      revision: 7,
      stateHash: "a".repeat(64),
      term: 1,
      authorityMemberId: "member-a",
      processedActionIds: ["action-1", "action-2"],
      state: { count: 7 },
    });
    expect(follower.getCanonicalState()).toEqual({ count: 7 });
    expect(follower.getDiagnostics().revision).toBe(7);
    expect(follower.getAuthorityMemberId()).toBe("member-a");
    expect(follower.processedActionIds()).toEqual(["action-1", "action-2"]);
    expect(follower.getDiagnostics().stateHash).toBe("a".repeat(64));
  });

  it("retains a bounded action history", async () => {
    const { engine } = await startedEngine({ historyLimit: 8 });
    for (let i = 0; i < 20; i += 1) {
      engine.handleLocalAction({
        actionId: `action-${i}`,
        type: "increment",
        payload: {},
        baseRevision: engine.getDiagnostics().revision,
      });
      await engine.flushPending();
    }
    const diagnostics = engine.getDiagnostics();
    expect(diagnostics.processedActionCount).toBe(8);
    expect(engine.processedActionIds()).toHaveLength(8);
    expect(diagnostics.revision).toBe(21);
  });

  it("reports action-rate and count diagnostics", async () => {
    const now = (() => {
      let t = 1_700_000_000_000;
      return () => {
        t += 250;
        return t;
      };
    })();
    const { engine } = await makeEngine({ now });
    for (let i = 0; i < 8; i += 1) {
      engine.handleLocalAction({
        actionId: `action-rate-${i}`,
        type: "increment",
        payload: {},
        baseRevision: engine.getDiagnostics().revision,
      });
      await engine.flushPending();
    }
    const diagnostics = engine.getDiagnostics();
    expect(diagnostics.appliedCount).toBe(9); // initial + 8
    expect(diagnostics.actionRatePerSecond).toBeGreaterThan(0);
    expect(diagnostics.pendingActionCount).toBe(0);
    expect(diagnostics.lastCommitAt).not.toBeNull();
  });

  it("tracks the authority and rejects announces from disconnected members", async () => {
    const host = new RecordingHost();
    const engine = new NovaStateEngine({
      host,
      executor: new LocalGameExecutor(null),
      selfMemberId: "member-b",
    });
    engine.handleAnnounce({ authorityMemberId: "member-x", stateRevision: 3 });
    expect(engine.getAuthorityMemberId()).toBeNull(); // member-x not connected
    engine.handleAnnounce({ authorityMemberId: "member-a", stateRevision: 3 });
    expect(engine.getAuthorityMemberId()).toBe("member-a");
  });

  it("clears the authority when it leaves and keeps the committed state", async () => {
    const { engine } = await startedEngine();
    expect(engine.getAuthorityMemberId()).toBe("member-a");
    engine.notifyAuthorityLeft();
    expect(engine.getAuthorityMemberId()).toBeNull();
    expect(engine.getCanonicalState()).toEqual({ count: 0, lastActor: null });
    expect(engine.getDiagnostics().revision).toBe(1);
  });
});

describe("NovaStateEngine diagnostics defaults", () => {
  it("reports empty diagnostics before any state", () => {
    const host = new RecordingHost();
    const engine = new NovaStateEngine({
      host,
      executor: new LocalGameExecutor(null),
      selfMemberId: "member-a",
    });
    const diagnostics = engine.getDiagnostics();
    expect(diagnostics.revision).toBe(0);
    expect(diagnostics.stateSizeBytes).toBe(0);
    expect(diagnostics.stateHash).toBeNull();
    expect(diagnostics.authorityMemberId).toBeNull();
    expect(diagnostics.appliedCount).toBe(0);
    expect(diagnostics.rejectedCount).toBe(0);
    expect(diagnostics.actionRatePerSecond).toBe(0);
  });
});

describe("NovaStateEngine initial-state failures", () => {
  it("fails the start when createInitialState errors and never commits", async () => {
    const host = new RecordingHost();
    const engine = new NovaStateEngine({
      host,
      executor: new LocalGameExecutor(
        handlers({
          createInitialState: () => {
            throw new Error("bad initial state");
          },
        }),
      ),
      selfMemberId: "member-a",
    });
    engine.beginGame();
    const ok = await engine.initializeAsAuthority();
    expect(ok).toBe(false);
    expect(host.snapshots).toHaveLength(0);
    expect(
      host.events.some((e) => e.type === "stateError" && e.code === "initial_state_error"),
    ).toBe(true);
    expect(engine.getDiagnostics().revision).toBe(0);
  });

  it("creates state with the default executor when no handlers are registered", async () => {
    const { engine, host } = await startedEngineWithDefault();
    expect(host.snapshots[0]?.snapshot.state).toEqual({});
    expect(engine.getDiagnostics().revision).toBe(1);
  });
});

async function startedEngineWithDefault(): Promise<{
  engine: NovaStateEngine;
  host: RecordingHost;
}> {
  const host = new RecordingHost();
  const engine = new NovaStateEngine({
    host,
    executor: new LocalGameExecutor(null),
    selfMemberId: "member-a",
  });
  engine.beginGame();
  const ok = await engine.initializeAsAuthority();
  expect(ok).toBe(true);
  return { engine, host };
}
