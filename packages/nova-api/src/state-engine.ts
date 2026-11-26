/**
 * Nova's authority-side state machine.
 *
 * The engine lives inside the host-side NovaSession and owns the action
 * protocol independently of game code:
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
 * - state-size and action-rate diagnostics;
 * - automatic authority election and migration.
 *
 * ## Authority election and migration
 *
 * Game code never knows which peer executes authoritative transitions. The
 * engine implements authority election and replication over the term + revision + hash
 * model (no quorum; trusted-friend scale):
 *
 * - **Member identity** comes from the session (stable member id, connection
 *   id, display name, authority eligibility, connectivity) and the engine
 *   observes connectivity through the host.
 * - **Initial election** is deterministic: the lowest connected eligible
 *   member at `beginGame` announces at term 1.
 * - **Heartbeats**: the authority broadcasts one every
 *   `heartbeatIntervalMs`; a follower that hears nothing for
 *   `gracePeriodMs` (from the last heartbeat/announcement/snapshot) suspects
 *   the authority and starts an election.
 * - **Elections**: a suspecting peer increments its known term, broadcasts
 *   an `authority.election` message carrying its state observations, and
 *   waits `electionWindowMs` before choosing the lowest member eligible
 *   at the start and end of the election. A higher-term campaign makes
 *   followers join and a sitting authority step down. Conflicting same-term
 *   announcements reconcile by
 *   (stateRevision, member id): higher revision wins, then the lower member
 *   id — on partition merge exactly one authority survives.
 * - **Restore**: the winner waits `restoreWindowMs` while peers whose state
 *   is higher (or conflicts at the same revision) push their snapshot to it;
 *   it adopts the highest **valid** replicated state (hash-checked at the
 *   end of the window, reverting to the previous replicated state on
 *   mismatch) before processing any buffered actions.
 * - **Actions buffer during election**: dispatchers hold actions until an
 *   authority is known; the new authority queues actions received before its
 *   restore completed and deduplicates against the restored processed-action
 *   history and its own queue, so no action commits twice after migration.
 * - **Conflict reconciliation**: state envelopes carry revision,
 *   term, authority member id, state hash, and recent processed action ids.
 *   At the same revision with conflicting hashes the engine prefers the
 *   majority-matching hash (vote counts from snapshots, announcements, and
 *   election observations), then a stable tie-breaker (the hash reported by
 *   the lowest member id).
 *
 * The engine never touches the transport directly: the session provides a
 * {@link StateEngineHost} for sending protocol messages and observing host
 * events, and a {@link NovaStateExecutor} that runs the game's functions.
 * All timings (heartbeat, grace, election window, restore window) are
 * configurable so tests use fake timers and deterministic fast runs.
 */
import { actionPayloadBytes } from "@rocketcrab/protocol";
import type { NovaActionAck, NovaActionStatus, NovaPlayer } from "./types";
import {
  type PendingAction,
  type ProcessedActionRecord,
  compareById,
  serializedBytesSync,
} from "./state-engine-shared";
import { StateEngineTicks } from "./state-engine-ticks";

export { STATE_HISTORY_LIMIT, serializedBytes, stateHashOf } from "./state-engine-shared";
export type {
  ProcessedActionRecord,
  StateSnapshotEnvelope,
  StateResyncEnvelope,
  InboundSnapshot,
  StateViewEnvelope,
  AuthorityAnnounceEnvelope,
  AuthorityHeartbeatEnvelope,
  ObservedStateEnvelope,
  AuthorityElectionEnvelope,
  StateEngineHost,
  StateEngineEvent,
  NovaStateEngineOptions,
} from "./state-engine-shared";

/** Applies ordered actions and commits authoritative state. */
export class NovaStateEngine extends StateEngineTicks {
  /** Authority side: when each told-about player was first seen gone. */
  private readonly absentSince = new Map<string, number>();
  private rosterTimer: ReturnType<typeof setTimeout> | null = null;
  private membershipSeq = 0;

  /**
   * Initialize as the authority: create the initial canonical state,
   * commit revision 1, distribute views, announce, and start heartbeats.
   * Resolves false when the initial state failed (the game must not start).
   */
  async initializeAsAuthority(): Promise<boolean> {
    if (this.disposed || this.ended) return false;
    if (!this.isAuthorityElect()) return false;
    if (this.authorityMemberId !== null && this.authorityMemberId !== this.selfMemberId) {
      return false;
    }
    this.authorityMemberId = this.selfMemberId;
    this.authorityStateRevision = this.revision;
    if (this.canonical !== null) {
      this.announce();
      this.startHeartbeats();
      return true;
    }
    const context = this.contextFor(this.revision, undefined);
    const result = await this.withExecutorTimeout(
      this.executor.createInitialState({ context, viewers: this.viewers() }),
    );
    // The players in createInitialState's context are the ones the game knows.
    this.roster = context.players;
    if (!result.ok) {
      this.host.emit({ type: "stateError", code: result.code, message: result.message });
      return false;
    }
    const committed = await this.commit(result);
    if (committed !== true) {
      this.host.emit({
        type: "stateError",
        ...(committed || {
          code: "invalid_state",
          message: "The initial state failed validation and was not committed.",
        }),
      });
      return false;
    }
    this.announce();
    this.startHeartbeats();
    this.reconcileRoster();
    return true;
  }

  /**
   * Authority side: queue the game's playerJoined/playerLeft for every
   * difference between the connected players and the roster the game was
   * told about. A leave waits `playerLeaveGraceMs` from when this authority
   * first saw the player gone, and a return within it cancels the leave. The
   * session calls this whenever players connect or disconnect.
   */
  reconcileRoster(): void {
    this.clearRosterTimer();
    if (
      this.disposed ||
      !this.started ||
      this.ended ||
      this.authorityMemberId !== this.selfMemberId ||
      !this.restoreDone ||
      this.canonical === null
    ) {
      this.absentSince.clear();
      return;
    }
    const connected = new Map(this.host.players().map((player) => [player.id, player]));
    if (this.roster === null) {
      // An older authority kept no roster: take the current players as told.
      this.roster = [...connected.values()].sort(compareById);
      this.absentSince.clear();
      return;
    }
    const queued = new Set(this.queue.flatMap((item) => item.membership?.player.id ?? []));
    const told = new Set(this.roster.map((player) => player.id));
    const now = this.now();
    let nextLeaveAt = Infinity;
    let added = false;
    for (const [id, player] of connected) {
      this.absentSince.delete(id);
      if (!told.has(id) && !queued.has(id)) {
        this.queueMembership("joined", player);
        added = true;
      }
    }
    for (const player of this.roster) {
      if (connected.has(player.id) || queued.has(player.id)) continue;
      const since = this.absentSince.get(player.id) ?? now;
      this.absentSince.set(player.id, since);
      const leaveAt = since + this.playerLeaveGraceMs;
      if (leaveAt <= now) {
        this.queueMembership("left", player);
        added = true;
      } else {
        nextLeaveAt = Math.min(nextLeaveAt, leaveAt);
      }
    }
    for (const id of this.absentSince.keys()) {
      if (!told.has(id)) this.absentSince.delete(id);
    }
    if (nextLeaveAt !== Infinity) {
      this.rosterTimer = setTimeout(() => {
        this.rosterTimer = null;
        this.reconcileRoster();
      }, nextLeaveAt - now);
    }
    if (added) this.processQueue();
  }

  protected clearRosterTimer(): void {
    if (this.rosterTimer !== null) {
      clearTimeout(this.rosterTimer);
      this.rosterTimer = null;
    }
  }

  private queueMembership(kind: "joined" | "left", player: NovaPlayer): void {
    this.membershipSeq += 1;
    this.queue.push({
      actionId: `nova-membership-${this.membershipSeq}`,
      senderMemberId: this.selfMemberId,
      seq: 0,
      type: kind,
      payload: null,
      baseRevision: this.revision,
      sentAt: this.now(),
      membership: { kind, player },
    });
  }

  /**
   * Tell the game one player joined or left. The roster records the change
   * even when the game has no handler or the handler throws, so it is told
   * once; it commits only when the handler produced a valid state.
   */
  private async applyMembership(
    item: PendingAction & { membership: NonNullable<PendingAction["membership"]> },
  ): Promise<void> {
    const { kind, player } = item.membership;
    const roster = this.roster ?? [];
    const connected = this.host.players().some((other) => other.id === player.id);
    const told = roster.some((other) => other.id === player.id);
    // The player came back (or left again) while this waited in the queue.
    if (kind === "joined" ? !connected || told : connected || !told) return;
    const nextRoster =
      kind === "joined"
        ? [...roster, player].sort(compareById)
        : roster.filter((other) => other.id !== player.id);
    const apply = this.executor.applyMembership?.bind(this.executor);
    const termAtStart = this.term;
    const result =
      apply === undefined
        ? { ok: false as const, code: "unknown_action", message: "" }
        : await this.withExecutorTimeout(
            apply({
              kind,
              player,
              state: this.canonical,
              context: this.contextFor(this.revision),
              viewers: this.viewers(),
            }),
          );
    if (this.disposed) return;
    if (
      this.authorityMemberId !== this.selfMemberId ||
      this.term !== termAtStart ||
      !this.restoreDone
    ) {
      return; // the next authority reports this change from its own roster
    }
    const problem = !result.ok
      ? result.code === "unknown_action"
        ? null
        : { code: result.code, message: result.message }
      : this.stateProblem(result.state, kind === "joined" ? "playerJoined" : "playerLeft");
    this.roster = nextRoster;
    if (problem !== null) {
      this.host.emit({ type: "stateError", ...problem });
      return;
    }
    if (result.ok) {
      const committed = await this.commit(result);
      if (typeof committed === "object") this.host.emit({ type: "stateError", ...committed });
    }
  }

  /**
   * An `action.dispatch` arrived. Only the current authority applies; other
   * shells drop dispatches (the dispatcher re-sends once a new authority is
   * announced, and the authority's history/queue deduplicate). During the
   * restore window the designated authority queues actions with deferred
   * base-revision checks, then applies them against the restored state.
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
    if (this.authorityMemberId !== this.selfMemberId) {
      return;
    }
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
    if (this.queue.some((pending) => pending.actionId === message.actionId)) {
      return; // already queued (a re-delivery); one apply, one ack
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
    const payloadBytes = serializedBytesSync(message.payload);
    if (payloadBytes > actionPayloadBytes) {
      this.rejectAction(
        message,
        "payload_too_large",
        `The action payload is ${payloadBytes} bytes; the hard limit is ${actionPayloadBytes} bytes.`,
      );
      return;
    }
    if (this.restoreDone && message.baseRevision !== this.revision) {
      // Deferred during restore: the base revision is checked at apply time
      // against the restored state.
      this.rejectAction(
        message,
        "stale_revision",
        `The action was based on revision ${message.baseRevision}; the current revision is ${this.revision}.`,
        "superseded",
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
    if (this.authorityMemberId !== this.selfMemberId) {
      return; // the session buffers local dispatches until we are the authority
    }
    if (this.ended) {
      this.rejectLocal(message, "game_ended", "The game has ended; this action is late.");
      return;
    }
    const recorded = this.history.get(message.actionId);
    if (recorded !== undefined) {
      this.replayAck(this.selfMemberId, recorded);
      return;
    }
    if (this.queue.some((pending) => pending.actionId === message.actionId)) {
      return;
    }
    const seq = (this.lastSeqByActor.get(this.selfMemberId) ?? 0) + 1;
    this.lastSeqByActor.set(this.selfMemberId, seq);
    const now = this.now();
    if (this.restoreDone && message.baseRevision !== this.revision) {
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

  /**
   * Kick the sequential executor loop (one run drains the whole queue).
   * Gated on restore: actions received before the elected authority
   * restored its state are buffered and applied afterwards.
   */
  protected processQueue(): void {
    this.syncTickClock();
    if (!this.restoreDone) return;
    if (this.processing !== null) return;
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
    while (this.canonical !== null && (this.queue.length > 0 || this.pendingTicks > 0)) {
      const item = this.queue[0];
      if (item === undefined) {
        // Actions go first; the due ticks then step the state they produced.
        const steps = this.pendingTicks;
        this.pendingTicks = 0;
        await this.applyTick(steps);
        continue;
      }
      if (item.membership !== undefined) {
        await this.applyMembership({ ...item, membership: item.membership });
        if (this.queue[0] === item) this.queue.shift();
        continue;
      }
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
    const termAtStart = this.term;
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
    if (
      this.authorityMemberId !== this.selfMemberId ||
      this.term !== termAtStart ||
      !this.restoreDone
    ) {
      // We lost authority (or the term moved) while the handler ran: drop the
      // result — the dispatcher re-sends once the new authority is announced
      // and deduplication guarantees the action never commits twice.
      return true;
    }
    if (!result.ok) {
      this.settleRejected(item, result.code, result.message);
      return true;
    }
    const problem = this.stateProblem(result.state, "action");
    if (problem !== null) {
      this.settleRejected(item, problem.code, problem.message);
      return true;
    }
    const committed = await this.commit(result, item.actionId);
    if (typeof committed === "object") {
      this.settleRejected(item, committed.code, committed.message);
      this.host.emit({ type: "stateError", ...committed });
      return true;
    }
    if (!committed) {
      // The authority changed (or the engine disposed) during the async
      // state-hash digest: drop the result silently, exactly like the
      // post-handler check above. The dispatcher re-sends once the new
      // authority is announced and deduplication applies the action
      // exactly once. The action was never invalid, so it must
      // not be acked as invalid_state.
      return true;
    }
    this.ack(item.senderMemberId, {
      actionId: item.actionId,
      status: "accepted",
      revision: this.revision,
    });
    return true;
  }

  /**
   * Commit a new canonical state: revision, hash, snapshot, views. The
   * committed action (when given) is recorded in the history BEFORE the
   * snapshot is published, so the replicated `processedActionIds` are
   * complete and a re-sent action is deduplicated after migration (
   * no action commits twice).
   */
  protected async commit(
    result: { state: unknown; views: Record<string, unknown>; viewIsState?: true },
    actionId?: string,
    tick = false,
  ): Promise<boolean | { code: string; message: string }> {
    const { views } = result;
    const files = this.host.files;
    const refs = files === undefined ? undefined : new Set<string>();
    const state = this.asReplicated(result.state, refs);
    if (this.disposed || this.ended) return false;
    if (this.authorityMemberId !== this.selfMemberId || !this.restoreDone) return false;
    // Hash BEFORE mutating revision/canonical: a catch-up snapshot read
    // mid-commit must never observe the new revision with the old hash
    // (state envelopes carry consistent revision + hash).
    const stateHash = await this.stateHashImpl(state);
    if (this.disposed || this.ended) return false;
    if (this.authorityMemberId !== this.selfMemberId || !this.restoreDone) return false;
    // A tick that changed nothing (a paused game) sends nothing, and one that
    // finished hashing after the tick stopped (leave, end) is dropped.
    if (tick && (stateHash === this.stateHash || !this.shouldTick())) return true;
    if (files !== undefined && refs !== undefined) {
      if (!files.canCommit(refs))
        return {
          code: "invalid_state",
          message:
            "The state references a shared file the authority does not have. Upload the file before committing its ref.",
        };
      files.updateRefs(refs);
    }
    this.revision += 1;
    this.canonical = state;
    this.stateHash = stateHash;
    if (actionId !== undefined) {
      this.remember(actionId, {
        actionId,
        status: "accepted",
        revision: this.revision,
        processedAt: this.now(),
      });
    }
    this.lastCommitAt = this.now();
    if (!tick) {
      this.stats.applied += 1;
      this.noteProcessed();
    }
    this.authorityStateRevision = this.revision;
    this.viewIsState = result.viewIsState === true;
    this.broadcastSnapshot(true);
    const envelope = {
      revision: this.revision,
      stateHash: this.stateHash,
    };
    if (this.viewIsState) {
      // Every shell already holds the state from the broadcast; only this frame needs it.
      this.host.sendView(this.selfMemberId, {
        ...envelope,
        forMemberId: this.selfMemberId,
        view: state,
      });
    }
    for (const player of this.viewIsState ? [] : this.host.players()) {
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
      tick,
    });
    return true;
  }

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
    // The commit already recorded this action as pending; the ack only
    // refreshes its record.
    this.storeHistory(ack.actionId, { ...ack, processedAt: this.now() });
    this.host.sendAck(targetMemberId, ack);
  }

  /** Record an action decided locally: it joins the next broadcast's history. */
  private remember(actionId: string, record: ProcessedActionRecord): void {
    if (!this.pendingHistoryOverflow) {
      this.pendingHistoryIds.add(actionId);
      if (this.pendingHistoryIds.size > this.historyLimit) {
        // Too many local decisions to ship as an increment: the next broadcast is full.
        this.pendingHistoryIds.clear();
        this.pendingHistoryOverflow = true;
      }
    }
    this.storeHistory(actionId, record);
  }
}
