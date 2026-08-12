/**
 * The S2 state-mode engine: Nova's authority-side state machine.
 *
 * The engine lives inside the host-side NovaSession and owns everything the
 * issue's action protocol requires, without any game code:
 *
 * - sequential authority execution (a FIFO queue; one apply in flight);
 * - schema and size checks (action payloads at intake, committed states at
 *   the snapshot bound);
 * - duplicate prevention (bounded action-id history with ack replay);
 * - stale-action handling (base revision must equal the current revision);
 * - action timeouts (expiresAtMs from the dispatcher, re-checked at apply);
 * - useful rejection errors (stable `errorCode` + message in every ack);
 * - bounded action-history retention (evicts oldest, mirrors the
 *   `processedActionIds` shipped in snapshots for migration);
 * - revision + hash per snapshot (sha256 of the serialized canonical state)
 *   and replication of the canonical state to every party shell;
 * - per-player views (only the player's selected view reaches its frame);
 * - state-size and action-rate diagnostics.
 *
 * The engine never touches the transport directly: the session provides a
 * {@link StateEngineHost} for sending protocol messages and observing host
 * events, and a {@link NovaStateExecutor} that runs the game's functions.
 * Authority selection for S2 is the deterministic initial authority of
 * ADR-0007 (the lowest connected eligible member at start, fixed for the
 * game; election terms, heartbeats, buffering during election, and
 * migration are S3). If the authority leaves, dispatches are rejected with
 * `no_authority` and every shell keeps the last committed state.
 */
import { actionTimeoutMs, actionPayloadBytes, stateSnapshotBytes } from "@rocketcrab/protocol";
import type { NovaStateExecutor } from "./state-executor";
import { assertStructuredCloneSafe } from "./validation";
import type {
  NovaActionAck,
  NovaActionStatus,
  NovaGameContext,
  NovaPlayer,
  NovaStateDiagnostics,
} from "./types";

/** How many processed action records the engine retains (bounded history). */
export const STATE_HISTORY_LIMIT = 256;

/** Length of the action-rate sliding window. */
const RATE_WINDOW_MS = 10_000;

/** One action queued for sequential application (authority side). */
interface PendingAction {
  readonly actionId: string;
  readonly senderMemberId: string;
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
  readonly baseRevision: number;
  readonly sentAt: number;
  readonly expiresAtMs?: number;
}

/** One processed-action record (dedup + ack replay, bounded). */
export interface ProcessedActionRecord extends NovaActionAck {
  readonly processedAt: number;
}

/** The state envelope data the engine asks the host to send. */
export interface StateSnapshotEnvelope {
  readonly revision: number;
  readonly stateHash: string | null;
  readonly term: number;
  readonly authorityMemberId: string;
  readonly processedActionIds: readonly string[];
  readonly state: unknown;
}

/** One player's view envelope. */
export interface StateViewEnvelope {
  readonly revision: number;
  readonly stateHash: string | null;
  readonly forMemberId: string;
  readonly view: unknown;
}

/** An authority announcement. */
export interface AuthorityAnnounceEnvelope {
  readonly term: number;
  readonly authorityMemberId: string;
  readonly stateRevision: number;
  readonly stateHash: string | null;
  readonly eligibleMemberIds: readonly string[];
}

/** The transport-facing half the session implements for the engine. */
export interface StateEngineHost {
  /** Every connected player, self first, then peers in join order. */
  players(): readonly NovaPlayer[];
  /** True when a member is currently connected. */
  isConnected(memberId: string): boolean;
  /** Send one action ack to a member (targeted). */
  sendAck(targetMemberId: string, ack: NovaActionAck): void;
  /** Broadcast a state snapshot, or target one member. */
  sendSnapshot(snapshot: StateSnapshotEnvelope, targetMemberId?: string): void;
  /** Send one player's selected view (targeted). */
  sendView(targetMemberId: string, view: StateViewEnvelope): void;
  /** Announce this session as the authority. */
  sendAnnounce(announcement: AuthorityAnnounceEnvelope): void;
  /** Emit a host-side engine event. */
  emit(event: StateEngineEvent): void;
}

/** Host-side engine events (the session maps them to session events). */
export type StateEngineEvent =
  | {
      type: "stateCommitted";
      revision: number;
      stateHash: string | null;
      stateSizeBytes: number;
      appliedCount: number;
      rejectedCount: number;
      actionRatePerSecond: number;
    }
  | { type: "actionRejected"; actionId: string; code: string; message: string }
  | { type: "stateError"; code: string; message: string };

/** Options for {@link NovaStateEngine}. */
export interface NovaStateEngineOptions {
  readonly host: StateEngineHost;
  readonly executor: NovaStateExecutor;
  readonly selfMemberId: string;
  /** Epoch-ms clock (tests inject a fake). */
  now?: () => number;
  /** How long the authority waits for the executor before rejecting. */
  executorTimeoutMs?: number;
  /** Bounded action-history retention. */
  historyLimit?: number;
}

interface ActionStats {
  applied: number;
  rejected: number;
  timestamps: number[];
}

/** Serialize a value and measure its size in bytes (UTF-8). */
export async function serializedBytes(value: unknown): Promise<number> {
  const json = JSON.stringify(value);
  return new TextEncoder().encode(json).length;
}

/** SHA-256 hex digest of a value's JSON serialization. */
export async function stateHashOf(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The state-mode engine. One instance per session; only the authority's
 * instance applies actions, every instance keeps the replicated canonical
 * state for migration (ADR-0007) and tracks the authority.
 */
export class NovaStateEngine {
  private readonly host: StateEngineHost;
  private executor: NovaStateExecutor;
  private readonly selfMemberId: string;
  private readonly now: () => number;
  private readonly executorTimeoutMs: number;
  private readonly historyLimit: number;

  private canonical: unknown | null = null;
  private revision = 0;
  private stateHash: string | null = null;
  private readonly term = 1; // S2: single term; S3 owns terms + reconciliation
  private authorityMemberId: string | null = null;
  private authorityElect: string | null = null;
  private started = false;
  private ended = false;
  private readonly history = new Map<string, ProcessedActionRecord>();
  private readonly queue: PendingAction[] = [];
  private processing: Promise<void> | null = null;
  private readonly lastSeqByActor = new Map<string, number>();
  private readonly stats: ActionStats = { applied: 0, rejected: 0, timestamps: [] };
  private lastCommitAt: number | null = null;
  private disposed = false;

  constructor(options: NovaStateEngineOptions) {
    this.host = options.host;
    this.executor = options.executor;
    this.selfMemberId = options.selfMemberId;
    this.now = options.now ?? (() => Date.now());
    this.executorTimeoutMs = options.executorTimeoutMs ?? actionTimeoutMs;
    this.historyLimit = options.historyLimit ?? STATE_HISTORY_LIMIT;
  }

  /**
   * Swap the executor (the session wires game handlers registered after the
   * engine was constructed). No-op once the game began.
   */
  setExecutor(executor: NovaStateExecutor): void {
    if (this.started) return;
    this.executor = executor;
  }

  // ------------------------------------------------------------------
  // Read accessors (session + host)
  // ------------------------------------------------------------------

  /** True once the game began (session.start / observed start). */
  isStarted(): boolean {
    return this.started;
  }

  /** True once the game ended. */
  isEnded(): boolean {
    return this.ended;
  }

  /** The current authority's member id, or null when unknown. */
  getAuthorityMemberId(): string | null {
    return this.authorityMemberId;
  }

  /** True when this session is the (fixed) initial authority. */
  isAuthorityElect(): boolean {
    return this.authorityElect === this.selfMemberId;
  }

  /** The canonical state revision this shell has committed/replicated. */
  getRevision(): number {
    return this.revision;
  }

  /** The replicated canonical state (migration; null before the first). */
  getCanonicalState(): unknown {
    return this.canonical;
  }

  /** The processed action ids shipped in snapshots (bounded, oldest first). */
  processedActionIds(): readonly string[] {
    return [...this.history.keys()];
  }

  /** Host-side diagnostics (S2 acceptance: size + rate are visible). */
  getDiagnostics(): NovaStateDiagnostics {
    return {
      revision: this.revision,
      stateSizeBytes: this.canonical === null ? 0 : serializedBytesSync(this.canonical),
      stateHash: this.stateHash,
      authorityMemberId: this.authorityMemberId,
      appliedCount: this.stats.applied,
      rejectedCount: this.stats.rejected,
      pendingActionCount: this.queue.length,
      processedActionCount: this.history.size,
      actionRatePerSecond: this.actionRate(),
      lastCommitAt: this.lastCommitAt,
    };
  }

  // ------------------------------------------------------------------
  // Lifecycle (session-driven)
  // ------------------------------------------------------------------

  /** Mark the game as begun; the lowest connected member becomes the fixed
   * initial authority (ADR-0007 deterministic initial selection). */
  beginGame(): void {
    if (this.started) return;
    this.started = true;
    // A session that already saw the authority (late joiner) defers to the
    // announced member; otherwise the lowest connected member is the fixed
    // initial authority. Never derived from a late joiner's own view.
    this.authorityElect = this.authorityMemberId ?? this.lowestConnectedMemberId();
  }

  /** Mark the game as ended (late actions are rejected). */
  endGame(): void {
    this.ended = true;
  }

  /** Tear down timers/state (session dispose). */
  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
  }

  // ------------------------------------------------------------------
  // Authority start (session calls on the fixed initial authority)
  // ------------------------------------------------------------------

  /**
   * Initialize as the authority: create the initial canonical state,
   * commit revision 1, distribute views, and announce. Resolves false when
   * the initial state failed (the game must not start).
   */
  async initializeAsAuthority(): Promise<boolean> {
    if (this.disposed || this.ended) return false;
    if (!this.isAuthorityElect()) return false;
    if (this.canonical !== null) {
      this.announce();
      return true;
    }
    if (this.authorityMemberId !== null && this.authorityMemberId !== this.selfMemberId) {
      // Another member already claimed authority (S2 conflict guard; S3 owns
      // term-based reconciliation). Stay a follower.
      return false;
    }
    const context = this.contextFor(this.revision, undefined);
    const result = await this.withExecutorTimeout(
      this.executor.createInitialState({ context, viewers: this.viewers() }),
    );
    if (!result.ok) {
      this.host.emit({ type: "stateError", code: result.code, message: result.message });
      return false;
    }
    if (!(await this.commit(result.state, result.views))) {
      this.host.emit({
        type: "stateError",
        code: "invalid_state",
        message: "The initial state failed validation and was not committed.",
      });
      return false;
    }
    this.announce();
    return true;
  }

  /** Re-announce after this session's transport reconnected (authority). */
  announce(): void {
    if (this.disposed || this.canonical === null) return;
    this.authorityMemberId = this.selfMemberId;
    this.host.sendAnnounce({
      term: this.term,
      authorityMemberId: this.selfMemberId,
      stateRevision: this.revision,
      stateHash: this.stateHash,
      eligibleMemberIds: this.host.players().map((player) => player.id),
    });
  }

  // ------------------------------------------------------------------
  // Inbound protocol traffic (session-driven)
  // ------------------------------------------------------------------

  /**
   * An `action.dispatch` arrived. Only the authority applies; other
   * sessions ignore dispatches (the authority publishes the result).
   */
  handleInboundAction(message: {
    actionId: string;
    seq: number;
    actionType: string;
    payload: unknown;
    baseRevision: number;
    sentAt: number;
    expiresAtMs?: number;
    senderMemberId: string;
  }): void {
    if (this.disposed) return;
    if (!this.started) {
      this.rejectAction(message, "not_started", "Actions are only accepted after the game starts.");
      return;
    }
    if (this.ended) {
      this.rejectAction(message, "game_ended", "The game has ended; this action is late.");
      return;
    }
    const recorded = this.history.get(message.actionId);
    if (recorded !== undefined) {
      this.replayAck(message.senderMemberId, recorded);
      return;
    }
    const lastSeq = this.lastSeqByActor.get(message.senderMemberId) ?? 0;
    if (message.seq <= lastSeq) {
      // Transport-level duplicate/reorder on an ordered family: drop.
      return;
    }
    this.lastSeqByActor.set(message.senderMemberId, message.seq);
    if (message.expiresAtMs !== undefined && message.expiresAtMs < this.now()) {
      this.rejectAction(
        message,
        "timed_out",
        "The action timed out before the authority applied it.",
      );
      return;
    }
    if (message.baseRevision !== this.revision) {
      this.rejectAction(
        message,
        "stale_revision",
        `The action was based on revision ${message.baseRevision}; the current revision is ${this.revision}.`,
        "superseded",
      );
      return;
    }
    const payloadBytes = serializedBytesSync(message.payload);
    if (payloadBytes > actionPayloadBytes) {
      this.rejectAction(
        message,
        "payload_too_large",
        `The action payload is ${payloadBytes} bytes; the hard limit is ${actionPayloadBytes} bytes.`,
      );
      return;
    }
    this.queue.push({
      actionId: message.actionId,
      senderMemberId: message.senderMemberId,
      seq: message.seq,
      type: message.actionType,
      payload: message.payload,
      baseRevision: message.baseRevision,
      sentAt: message.sentAt,
      ...(message.expiresAtMs !== undefined ? { expiresAtMs: message.expiresAtMs } : {}),
    });
    void this.processQueue();
  }

  /** A local dispatch on the authority session (no transport round trip). */
  handleLocalAction(message: {
    actionId: string;
    type: string;
    payload: unknown;
    baseRevision: number;
  }): void {
    if (this.disposed) return;
    if (this.ended) {
      this.rejectLocal(message, "game_ended", "The game has ended; this action is late.");
      return;
    }
    const recorded = this.history.get(message.actionId);
    if (recorded !== undefined) {
      this.replayAck(this.selfMemberId, recorded);
      return;
    }
    const seq = (this.lastSeqByActor.get(this.selfMemberId) ?? 0) + 1;
    this.lastSeqByActor.set(this.selfMemberId, seq);
    const now = this.now();
    if (message.baseRevision !== this.revision) {
      this.rejectLocal(
        message,
        "stale_revision",
        `The action was based on revision ${message.baseRevision}; the current revision is ${this.revision}.`,
        "superseded",
      );
      return;
    }
    const payloadBytes = serializedBytesSync(message.payload);
    if (payloadBytes > actionPayloadBytes) {
      this.rejectLocal(
        message,
        "payload_too_large",
        `The action payload is ${payloadBytes} bytes; the hard limit is ${actionPayloadBytes} bytes.`,
      );
      return;
    }
    this.queue.push({
      actionId: message.actionId,
      senderMemberId: this.selfMemberId,
      seq,
      type: message.type,
      payload: message.payload,
      baseRevision: message.baseRevision,
      sentAt: now,
      expiresAtMs: now + this.executorTimeoutMs,
    });
    void this.processQueue();
  }

  /** A `state.snapshot` arrived: replicate the canonical state. */
  handleSnapshot(message: {
    revision: number;
    stateHash: string | null;
    term: number;
    authorityMemberId: string;
    processedActionIds: readonly string[];
    state: unknown;
  }): void {
    if (this.disposed) return;
    if (message.revision < this.revision) return; // stale delivery
    this.canonical = message.state;
    this.revision = message.revision;
    this.stateHash = message.stateHash;
    this.authorityMemberId = message.authorityMemberId;
    // A snapshot is authoritative evidence of who the authority is: a
    // session that never committed anything of its own (a follower or a
    // late joiner whose start raced its catch-up) defers to it.
    if (
      this.stats.applied === 0 &&
      this.authorityElect === this.selfMemberId &&
      message.authorityMemberId !== this.selfMemberId
    ) {
      this.authorityElect = message.authorityMemberId;
    }
    for (const actionId of message.processedActionIds) {
      if (!this.history.has(actionId)) {
        this.remember(actionId, {
          actionId,
          status: "accepted",
          revision: message.revision,
          processedAt: this.now(),
        });
      }
    }
  }

  /** An `authority.announce` arrived: record the current authority. */
  handleAnnounce(message: { authorityMemberId: string; stateRevision: number }): void {
    if (this.disposed) return;
    if (
      !this.host.isConnected(message.authorityMemberId) &&
      message.authorityMemberId !== this.selfMemberId
    ) {
      return; // stale announcement from a member that is no longer connected
    }
    if (
      this.authorityMemberId === this.selfMemberId &&
      message.authorityMemberId !== this.selfMemberId
    ) {
      this.host.emit({
        type: "stateError",
        code: "authority_conflict",
        message: `Another member (${message.authorityMemberId}) announced authority while this session is the authority; S3 owns reconciliation.`,
      });
      return;
    }
    this.authorityMemberId = message.authorityMemberId;
  }

  /** The authority left: no authority until S3 election. */
  notifyAuthorityLeft(): void {
    this.authorityMemberId = null;
  }

  /**
   * Compute one player's view (late joiners) and hand it to the host to
   * deliver. Runs on the authority; failures surface as state errors.
   */
  async computeViewFor(viewer: NovaPlayer): Promise<void> {
    if (this.disposed || this.canonical === null) return;
    if (this.authorityMemberId !== this.selfMemberId) return;
    const result = await this.withExecutorTimeout(
      this.executor.computeView({ state: this.canonical, viewer }),
    );
    if (this.disposed) return;
    if (!result.ok) {
      this.host.emit({ type: "stateError", code: result.code, message: result.message });
      return;
    }
    this.host.sendView(viewer.id, {
      revision: this.revision,
      stateHash: this.stateHash,
      forMemberId: viewer.id,
      view: result.view,
    });
  }

  // ------------------------------------------------------------------
  // Sequential application
  // ------------------------------------------------------------------

  /**
   * Kick the sequential executor loop (one run drains the whole queue).
   * Returns nothing; {@link flushPending} awaits the run for tests.
   */
  private processQueue(): void {
    if (this.processing !== null) return; // the running loop drains new items
    this.processing = this.runQueue().finally(() => {
      this.processing = null;
    });
  }

  /** Test/observability seam: resolve once the queue is idle. */
  async flushPending(): Promise<void> {
    while (this.processing !== null) {
      await this.processing;
    }
    await Promise.resolve();
  }

  private async runQueue(): Promise<void> {
    while (this.canonical !== null && this.queue.length > 0) {
      const item = this.queue[0];
      if (item === undefined) break;
      const handled = await this.applyOne(item);
      if (handled) {
        this.queue.shift();
      } else {
        break; // the executor failed outside an action result: stop the queue
      }
    }
  }

  /** Apply one queued action; resolves true when it was settled. */
  private async applyOne(item: PendingAction): Promise<boolean> {
    if (item.expiresAtMs !== undefined && item.expiresAtMs < this.now()) {
      this.settleRejected(
        item,
        "timed_out",
        "The action timed out before the authority could apply it.",
      );
      return true;
    }
    if (item.baseRevision !== this.revision) {
      this.settleRejected(
        item,
        "stale_revision",
        `The action was based on revision ${item.baseRevision}; the current revision is ${this.revision}.`,
        "superseded",
      );
      return true;
    }
    const context = this.contextFor(this.revision, this.playerOf(item.senderMemberId));
    const result = await this.withExecutorTimeout(
      this.executor.applyAction({
        actionId: item.actionId,
        type: item.type,
        payload: item.payload,
        state: this.canonical,
        context,
        viewers: this.viewers(),
      }),
    );
    if (this.disposed) return true;
    if (!result.ok) {
      this.settleRejected(item, result.code, result.message);
      return true;
    }
    try {
      assertStructuredCloneSafe(result.state, "action result state");
    } catch (error) {
      this.settleRejected(
        item,
        "invalid_state",
        `The action handler produced state that is not plain data: ${error instanceof Error ? error.message : String(error)}`,
      );
      return true;
    }
    const size = serializedBytesSync(result.state);
    if (size > stateSnapshotBytes) {
      this.settleRejected(
        item,
        "state_too_large",
        `Applying the action produced a ${size}-byte state; the hard limit is ${stateSnapshotBytes} bytes.`,
      );
      return true;
    }
    if (!(await this.commit(result.state, result.views))) {
      this.settleRejected(item, "invalid_state", "The action result failed validation.");
      return true;
    }
    this.ack(item.senderMemberId, {
      actionId: item.actionId,
      status: "accepted",
      revision: this.revision,
    });
    return true;
  }

  /** Commit a new canonical state: revision, hash, snapshot, views. */
  private async commit(state: unknown, views: Record<string, unknown>): Promise<boolean> {
    if (this.disposed) return false;
    this.revision += 1;
    this.canonical = state;
    this.stateHash = await stateHashOf(state);
    if (this.disposed) return false;
    this.lastCommitAt = this.now();
    this.stats.applied += 1;
    this.noteProcessed();
    this.host.sendSnapshot({
      revision: this.revision,
      stateHash: this.stateHash,
      term: this.term,
      authorityMemberId: this.selfMemberId,
      processedActionIds: this.processedActionIds(),
      state,
    });
    const envelope = {
      revision: this.revision,
      stateHash: this.stateHash,
    };
    for (const player of this.host.players()) {
      const view = views[player.id];
      if (view === undefined) {
        this.host.emit({
          type: "stateError",
          code: "view_error",
          message: `No view was computed for player ${player.id}; it keeps its previous view.`,
        });
        continue;
      }
      this.host.sendView(player.id, { ...envelope, forMemberId: player.id, view });
    }
    this.host.emit({
      type: "stateCommitted",
      revision: this.revision,
      stateHash: this.stateHash,
      stateSizeBytes: serializedBytesSync(state),
      appliedCount: this.stats.applied,
      rejectedCount: this.stats.rejected,
      actionRatePerSecond: this.actionRate(),
    });
    return true;
  }

  // ------------------------------------------------------------------
  // Rejections, acks, and history
  // ------------------------------------------------------------------

  private rejectAction(
    message: { actionId: string; senderMemberId: string },
    code: string,
    detail: string,
    status: NovaActionStatus = "rejected",
  ): void {
    const ack: NovaActionAck = {
      actionId: message.actionId,
      status,
      errorCode: code,
      errorMessage: detail.slice(0, 256),
    };
    this.remember(message.actionId, {
      ...ack,
      processedAt: this.now(),
    });
    this.stats.rejected += 1;
    this.noteProcessed();
    this.host.sendAck(message.senderMemberId, ack);
    this.host.emit({
      type: "actionRejected",
      actionId: message.actionId,
      code,
      message: detail,
    });
  }

  private rejectLocal(
    message: { actionId: string },
    code: string,
    detail: string,
    status: NovaActionStatus = "rejected",
  ): void {
    this.rejectAction(
      { actionId: message.actionId, senderMemberId: this.selfMemberId },
      code,
      detail,
      status,
    );
  }

  private settleRejected(
    item: PendingAction,
    code: string,
    detail: string,
    status: NovaActionStatus = "rejected",
  ): void {
    const ack: NovaActionAck = {
      actionId: item.actionId,
      status,
      errorCode: code,
      errorMessage: detail.slice(0, 256),
    };
    this.remember(item.actionId, { ...ack, processedAt: this.now() });
    this.stats.rejected += 1;
    this.noteProcessed();
    this.host.sendAck(item.senderMemberId, ack);
    this.host.emit({
      type: "actionRejected",
      actionId: item.actionId,
      code,
      message: detail,
    });
  }

  /** Re-send the recorded ack for a duplicate action (exactly-once acks). */
  private replayAck(targetMemberId: string, recorded: ProcessedActionRecord): void {
    this.host.sendAck(targetMemberId, {
      actionId: recorded.actionId,
      status: recorded.status,
      ...(recorded.revision !== undefined ? { revision: recorded.revision } : {}),
      ...(recorded.errorCode !== undefined ? { errorCode: recorded.errorCode } : {}),
      ...(recorded.errorMessage !== undefined ? { errorMessage: recorded.errorMessage } : {}),
    });
  }

  private ack(targetMemberId: string, ack: NovaActionAck): void {
    this.remember(ack.actionId, { ...ack, processedAt: this.now() });
    this.host.sendAck(targetMemberId, ack);
  }

  private remember(actionId: string, record: ProcessedActionRecord): void {
    this.history.set(actionId, record);
    while (this.history.size > this.historyLimit) {
      const oldest = this.history.keys().next().value;
      if (oldest === undefined) break;
      this.history.delete(oldest);
    }
  }

  // ------------------------------------------------------------------
  // Context, helpers
  // ------------------------------------------------------------------

  private contextFor(revision: number, actor?: NovaPlayer): NovaGameContext {
    return {
      self: this.host.players()[0] ?? { id: this.selfMemberId, name: this.selfMemberId },
      players: this.host.players(),
      revision,
      now: this.now(),
      ...(actor !== undefined ? { actor } : {}),
    };
  }

  private playerOf(memberId: string): NovaPlayer {
    return (
      this.host.players().find((player) => player.id === memberId) ?? {
        id: memberId,
        name: memberId,
      }
    );
  }

  private viewers(): readonly NovaPlayer[] {
    return this.host.players();
  }

  private lowestConnectedMemberId(): string | null {
    const ids = this.host.players().map((player) => player.id);
    if (ids.length === 0) return null;
    return ids.reduce((lowest, id) => (id < lowest ? id : lowest));
  }

  private noteProcessed(): void {
    const now = this.now();
    this.stats.timestamps.push(now);
    const cutoff = now - RATE_WINDOW_MS;
    while (this.stats.timestamps.length > 0 && (this.stats.timestamps[0] ?? 0) < cutoff) {
      this.stats.timestamps.shift();
    }
  }

  private actionRate(): number {
    const cutoff = this.now() - RATE_WINDOW_MS;
    while (this.stats.timestamps.length > 0 && (this.stats.timestamps[0] ?? 0) < cutoff) {
      this.stats.timestamps.shift();
    }
    return this.stats.timestamps.length / (RATE_WINDOW_MS / 1000);
  }

  private withExecutorTimeout<T>(promise: Promise<T>): Promise<T> {
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
}

function serializedBytesSync(value: unknown): number {
  const json = JSON.stringify(value);
  return new TextEncoder().encode(json).length;
}
