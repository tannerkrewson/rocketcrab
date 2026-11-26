import {
  actionTimeoutMs,
  authorityGracePeriodMs,
  authorityHeartbeatIntervalMs,
  playerLeaveGraceMs,
  stateSnapshotBytes,
  type StateActionRejection,
} from "@rocketcrab/protocol";
import type { NovaStateExecutor } from "./state-executor";
import { assertStructuredCloneSafe } from "./validation";
import type { NovaGameContext, NovaPlayer, NovaStateDiagnostics } from "./types";
import {
  STATE_HISTORY_LIMIT,
  RATE_WINDOW_MS,
  type PendingAction,
  type ProcessedActionRecord,
  type StateSnapshotEnvelope,
  describeError,
  type StateEngineHost,
  type NovaStateEngineOptions,
  type ActionStats,
  type ElectionState,
  type RestoreBackup,
  stateHashOf,
  serializedBytesSync,
  compareById,
} from "./state-engine-shared";

/** Session state, lifecycle, and shared state-engine operations. */
export abstract class StateEngineLifecycle {
  protected readonly host: StateEngineHost;
  protected executor: NovaStateExecutor;
  protected readonly selfMemberId: string;
  protected readonly now: () => number;
  protected readonly executorTimeoutMs: number;
  protected readonly historyLimit: number;
  protected readonly heartbeatIntervalMs: number;
  protected readonly gracePeriodMs: number;
  protected readonly electionWindowMs: number;
  protected readonly restoreWindowMs: number;
  protected readonly playerLeaveGraceMs: number;
  protected readonly stateHashImpl: (value: unknown) => Promise<string>;

  protected canonical: unknown | null = null;
  protected revision = 0;
  protected stateHash: string | null = null;
  protected term = 1;
  protected authorityMemberId: string | null = null;
  protected authorityElect: string | null = null;
  /** Last revision the current authority claimed (announces/heartbeats). */
  protected authorityStateRevision = 0;
  protected lastHeartbeatAt: number | null = null;
  protected heartbeatSeq = 0;
  protected started = false;
  protected ended = false;
  protected disposed = false;
  /** True once the elected authority finished restoring its state. */
  protected restoreDone = true;
  protected restoreBackup: RestoreBackup | null = null;
  protected election: ElectionState | null = null;
  protected graceTimer: ReturnType<typeof setTimeout> | null = null;
  protected heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  protected restoreTimer: ReturnType<typeof setTimeout> | null = null;
  protected winnerWaitTimer: ReturnType<typeof setTimeout> | null = null;
  /** revision -> (stateHash -> reporting member ids) for reconciliation. */
  protected readonly revisionVotes = new Map<number, Map<string, Set<string>>>();
  protected readonly history = new Map<string, ProcessedActionRecord>();
  /**
   * Action IDs decided locally since this authority's last broadcast. Only the
   * sitting authority fills it; the next broadcast drains it.
   */
  protected pendingHistoryIds = new Set<string>();
  /** Set when pending IDs exceed the bound: the next broadcast is full. */
  protected pendingHistoryOverflow = false;
  /** State hash of this engine's last broadcast (the base of the next increment). */
  protected lastBroadcastStateHash: string | null = null;
  /**
   * False from a detected gap until a full snapshot is applied. A follower
   * with an incomplete window asks again on each heartbeat until it is repaired.
   */
  protected historyComplete = true;
  /** Set once a full snapshot answers the outstanding request; cleared on a new gap. */
  protected historyRequestAnswered = false;
  /** The canonical state of the last broadcast: the base of the next delta. */
  protected lastBroadcastCanonical: unknown = null;
  /** True while a received delta's hash is being verified (the session holds inbound messages). */
  protected deltaPending = false;
  /** Revision of this engine's last broadcast snapshot (authority side). */
  protected lastBroadcastRevision: number | null = null;
  /** Receiver side: a resync request is in flight until this time (ms). */
  protected resyncOutstandingUntil = 0;
  /** Authority side: when each requester was last served a resync (ms). */
  protected readonly resyncServedAt = new Map<string, number>();
  protected readonly queue: PendingAction[] = [];
  protected processing: Promise<void> | null = null;
  protected readonly lastSeqByActor = new Map<string, number>();
  protected readonly stats: ActionStats = { applied: 0, rejected: 0, timestamps: [] };
  protected lastCommitAt: number | null = null;
  /** The game has no selectView, so views are the canonical state itself. */
  protected viewIsState = false;
  /**
   * The players the game's membership handlers have been told about, sorted
   * by id, replicated with every snapshot so a new authority reports the
   * difference. Null when unknown (no state yet, or an older authority).
   */
  protected roster: readonly NovaPlayer[] | null = null;
  /** Ticks per second once the game declared a `tick` handler. */
  protected tickRate: number | null = null;
  protected tickTimer: ReturnType<typeof setTimeout> | null = null;
  /** The tick clock's reference point: `ticksCounted` ticks were due at `tickAnchorAt`. */
  protected tickAnchorAt = 0;
  protected ticksCounted = 0;
  /** Ticks due but not yet applied (they run after queued actions). */
  protected pendingTicks = 0;
  /** A lossy-JSON warning was already reported this session. */
  private reportedLossyState = false;
  /** The tick failure already reported (cleared by a successful tick). */
  protected reportedTickProblem: string | null = null;

  constructor(options: NovaStateEngineOptions) {
    this.host = options.host;
    this.executor = options.executor;
    this.selfMemberId = options.selfMemberId;
    this.now = options.now ?? (() => Date.now());
    this.executorTimeoutMs = options.executorTimeoutMs ?? actionTimeoutMs;
    this.historyLimit = options.historyLimit ?? STATE_HISTORY_LIMIT;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? authorityHeartbeatIntervalMs;
    this.gracePeriodMs = options.gracePeriodMs ?? authorityGracePeriodMs;
    this.electionWindowMs = options.electionWindowMs ?? 500;
    this.restoreWindowMs = options.restoreWindowMs ?? 500;
    this.playerLeaveGraceMs = options.playerLeaveGraceMs ?? playerLeaveGraceMs;
    this.stateHashImpl = options.stateHash ?? stateHashOf;
  }

  /**
   * Swap the executor (the session wires game handlers registered after the
   * engine was constructed). No-op once the game began.
   */
  setExecutor(executor: NovaStateExecutor): void {
    if (this.started) return;
    this.executor = executor;
  }

  /** False while this shell's action window has a known gap (see state.resync). */
  isHistoryComplete(): boolean {
    return this.historyComplete;
  }

  /** True once the game began (session.start / observed start). */
  isStarted(): boolean {
    return this.started;
  }

  /** True once the game ended. */
  isEnded(): boolean {
    return this.ended;
  }

  /** The current authority's member id, or null when none is known. */
  getAuthorityMemberId(): string | null {
    return this.authorityMemberId;
  }

  /** The current authority term (monotonic). */
  getTerm(): number {
    return this.term;
  }

  /** True when this session is the authority for the current term. */
  isAuthorityElect(): boolean {
    return this.authorityElect === this.selfMemberId;
  }

  /** The canonical state revision this shell has committed/replicated. */
  getRevision(): number {
    return this.revision;
  }

  /** The replicated canonical state (migration; null before the first). */
  /** True when every frame's view is the canonical state (no selectView). */
  viewsAreState(): boolean {
    return this.viewIsState;
  }

  getCanonicalState(): unknown {
    return this.canonical;
  }

  /** The players the game's membership handlers were told about, or null when unknown. */
  getRoster(): readonly NovaPlayer[] | null {
    return this.roster;
  }

  /** The processed action ids shipped in snapshots (bounded, oldest first). */
  processedActionIds(): readonly string[] {
    return [...this.history.keys()];
  }

  actionHistory(
    ids = this.processedActionIds(),
  ): Pick<StateSnapshotEnvelope, "processedActionIds" | "actionRejections"> {
    // Most actions succeed. Only carry extra data for rejections, and keep
    // game-authored error text on the original targeted acknowledgement.
    const actionRejections: StateActionRejection[] = [];
    for (const actionId of ids) {
      const record = this.history.get(actionId);
      if (record === undefined || record.status === "accepted") continue;
      const { status, errorCode } = record;
      actionRejections.push({
        actionId,
        status,
        ...(errorCode && errorCode.length <= 64 ? { errorCode } : {}),
      });
    }
    return {
      processedActionIds: ids,
      ...(actionRejections.length > 0 ? { actionRejections } : {}),
    };
  }

  /** Host-side diagnostics (host/arena visible). */
  getDiagnostics(): NovaStateDiagnostics {
    return {
      revision: this.revision,
      stateSizeBytes: this.canonical === null ? 0 : serializedBytesSync(this.canonical),
      stateHash: this.stateHash,
      authorityMemberId: this.authorityMemberId,
      term: this.term,
      electionInProgress: this.election !== null,
      lastHeartbeatAt: this.lastHeartbeatAt,
      appliedCount: this.stats.applied,
      rejectedCount: this.stats.rejected,
      pendingActionCount: this.queue.length,
      processedActionCount: this.history.size,
      actionRatePerSecond: this.actionRate(),
      lastCommitAt: this.lastCommitAt,
      historyComplete: this.historyComplete,
    };
  }

  /**
   * Mark the game as begun; the lowest connected eligible member becomes the
   * deterministic initial authority. A session that already saw
   * the authority (late joiner) defers to the announced member; the initial
   * authority is never derived from a late joiner's own view.
   */
  beginGame(): void {
    if (this.started) return;
    this.started = true;
    this.authorityElect = this.authorityMemberId ?? this.lowestEligibleMemberId();
  }

  /**
   * Read-only: true when beginGame() would elect this member. The election
   * is only fixed by beginGame(), so a session that has not started yet asks
   * this instead of isAuthorityElect(). Mirrors beginGame's rule exactly.
   */
  wouldElectSelf(): boolean {
    return (
      !this.started &&
      this.authorityMemberId === null &&
      this.lowestEligibleMemberId() === this.selfMemberId
    );
  }

  /** Mark the game as ended (late actions are rejected, timers stop). */
  endGame(): void {
    this.ended = true;
    this.election = null;
    this.clearTimers();
  }

  /** Tear down timers/state (session dispose). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimers();
    this.election = null;
    this.queue.length = 0;
  }

  protected lowestEligibleMemberId(): string | null {
    const ids = this.host.eligibleMemberIds();
    if (ids.length === 0) return null;
    return ids.reduce((lowest, id) => (id < lowest ? id : lowest));
  }

  /**
   * The state exactly as other players will receive it (JSON). NaN and
   * Infinity become null and a Map or Set becomes {}; keeping the original
   * here would leave the authority's game different from everyone else's.
   * The first such value is reported once, since it is almost always a bug
   * (a division by zero, a Map in the state).
   */
  protected asReplicated(state: unknown): unknown {
    let lossy: string | null = null;
    const json = JSON.stringify(state, (key, value: unknown) => {
      if (lossy === null) {
        const where = key === "" ? "The state" : `State key "${key}"`;
        if (typeof value === "number" && !Number.isFinite(value)) {
          lossy = `${where} is ${value}, which other players receive as null. Check for a division by zero.`;
        } else if (value instanceof Map || value instanceof Set) {
          lossy = `${where} is a ${value instanceof Map ? "Map" : "Set"}, which other players receive as {}. Use a plain object or an array.`;
        }
      }
      return value;
    });
    if (lossy !== null && !this.reportedLossyState) {
      this.reportedLossyState = true;
      this.host.emit({ type: "stateError", code: "invalid_state", message: lossy });
    }
    return lossy === null ? state : (JSON.parse(json) as unknown);
  }

  /** Why a handler's result cannot become the canonical state, or null. */
  protected stateProblem(state: unknown, source: string): { code: string; message: string } | null {
    try {
      assertStructuredCloneSafe(state, `${source} result state`);
    } catch (error) {
      return {
        code: "invalid_state",
        message: `The ${source} handler produced state that is not plain data: ${describeError(error)}`,
      };
    }
    const size = serializedBytesSync(state);
    if (size > stateSnapshotBytes) {
      return {
        code: "state_too_large",
        message: `The ${source} handler produced a ${size}-byte state; the hard limit is ${stateSnapshotBytes} bytes.`,
      };
    }
    return null;
  }

  /** Store one history record, evicting the oldest beyond the bound. */
  protected storeHistory(actionId: string, record: ProcessedActionRecord): void {
    this.history.set(actionId, record);
    while (this.history.size > this.historyLimit) {
      const oldest = this.history.keys().next().value;
      if (oldest === undefined) break;
      this.history.delete(oldest);
    }
  }

  /**
   * Handlers may run on any device, so the context never names the device
   * running them, and `players` is sorted by id: the same order everywhere,
   * before and after a migration.
   */
  protected contextFor(revision: number, actor?: NovaPlayer): NovaGameContext {
    return {
      players: [...this.host.players()].sort(compareById),
      revision,
      now: this.now(),
      ...(actor !== undefined ? { actor } : {}),
      leaderId: this.host.leaderId(),
    };
  }

  protected playerOf(memberId: string): NovaPlayer {
    return (
      this.host.players().find((player) => player.id === memberId) ?? {
        id: memberId,
        name: memberId,
      }
    );
  }

  protected viewers(): readonly NovaPlayer[] {
    return this.host.players();
  }

  protected noteProcessed(): void {
    const now = this.now();
    this.stats.timestamps.push(now);
    const cutoff = now - RATE_WINDOW_MS;
    while (this.stats.timestamps.length > 0 && (this.stats.timestamps[0] ?? 0) < cutoff) {
      this.stats.timestamps.shift();
    }
  }

  protected actionRate(): number {
    const cutoff = this.now() - RATE_WINDOW_MS;
    while (this.stats.timestamps.length > 0 && (this.stats.timestamps[0] ?? 0) < cutoff) {
      this.stats.timestamps.shift();
    }
    return this.stats.timestamps.length / (RATE_WINDOW_MS / 1000);
  }

  protected withExecutorTimeout<T>(promise: Promise<T>): Promise<T> {
    if (this.executorTimeoutMs <= 0) return promise;
    return new Promise<T>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({
          ok: false,
          code: "execution_timeout",
          message: "The authority runtime did not answer in time.",
        } as T);
      }, this.executorTimeoutMs);
      promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            ok: false,
            code: "execution_failed",
            message: error instanceof Error ? error.message : String(error),
          } as T);
        },
      );
    });
  }

  protected abstract clearTimers(): void;
}
