import { stateHistoryLimit, stateResyncMinIntervalMs } from "@rocketcrab/protocol";
import { applyJsonPatch, deltaFor, type JsonDeltaOp } from "./json-delta";
import type { NovaPlayer } from "./types";
import {
  type StateSnapshotEnvelope,
  describeError,
  type InboundSnapshot,
  serializedBytesSync,
} from "./state-engine-shared";
import { StateEngineLifecycle } from "./state-engine-lifecycle";

/** Replicate canonical state through full snapshots, deltas, and repair requests. */
export abstract class StateEngineSnapshots extends StateEngineLifecycle {
  /**
   * A `state.snapshot` arrived: replicate the canonical state (term-gated,
   * same-revision conflicts reconciled deterministically, and a
   * deposed/split authority's stale-term state is never adopted).
   */
  handleSnapshot(message: InboundSnapshot): void {
    if (this.disposed) return;
    if (message.stateMode === "delta") {
      this.beginDeltaSnapshot(message);
      return;
    }
    this.applySnapshot(message);
  }

  /**
   * A delta is applied only on top of the exact state it names (revision and
   * base hash). The result is hashed and checked against the sender's hash
   * before anything is adopted. A mismatch, a missing base or an apply error is
   * a gap: the window is marked incomplete and the existing resync path runs.
   */
  private beginDeltaSnapshot(message: InboundSnapshot): void {
    if (message.term < this.term) return;
    if (message.revision <= this.revision) {
      // Stale, or a same-revision state we cannot read as a delta: ask for the
      // full state when it differs from ours.
      if (message.revision === this.revision && message.stateHash !== this.stateHash) {
        this.requestRepair();
      }
      return;
    }
    const base = this.stateHash;
    if (
      message.revision !== this.revision + 1 ||
      message.ops === undefined ||
      (message.baseStateHash ?? null) !== base ||
      this.canonical === null
    ) {
      this.requestRepair();
      return;
    }
    let next: unknown;
    try {
      next = applyJsonPatch(this.canonical, message.ops);
    } catch {
      this.requestRepair();
      return;
    }
    const baseRevision = this.revision;
    this.deltaPending = true;
    let pending: Promise<string>;
    try {
      pending = this.stateHashImpl(next);
    } catch {
      // A synchronous failure must not leave deltaPending set (that would hold all traffic).
      this.deltaPending = false;
      this.requestRepair();
      this.host.emit({ type: "deltaSettled" });
      return;
    }
    pending.then(
      (hash) => {
        this.deltaPending = false;
        if (!this.disposed) {
          if (hash !== message.stateHash) {
            this.requestRepair();
          } else if (this.revision === baseRevision && this.stateHash === base) {
            this.applySnapshot({ ...message, state: next, stateMode: "full" });
          }
        }
        this.host.emit({ type: "deltaSettled" });
      },
      () => {
        this.deltaPending = false;
        this.requestRepair();
        this.host.emit({ type: "deltaSettled" });
      },
    );
  }

  /** True while a delta is being verified; the host holds other inbound traffic until it settles. */
  isDeltaPending(): boolean {
    return this.deltaPending;
  }

  /** A gap that a delta cannot repair: our window and state are behind. Ask for a full snapshot. */
  private requestRepair(): void {
    this.historyComplete = false;
    this.historyRequestAnswered = false;
    this.requestResync();
  }

  private applySnapshot(message: InboundSnapshot): void {
    if (this.disposed) return;
    if (message.state === undefined) {
      // A full snapshot without its state is malformed: ask for a repair.
      this.requestRepair();
      return;
    }
    if (message.term < this.term) return;
    let adoptedAuthority = false;
    if (message.term > this.term) {
      this.adoptTerm(message.term, message.authorityMemberId);
      adoptedAuthority = true;
    } else if (this.authorityMemberId === null) {
      // Mid-election/waiting: the snapshot's authority claim is evidence of
      // who won (announcements travel on the same ordered channel first).
      this.adoptTerm(message.term, message.authorityMemberId);
      adoptedAuthority = true;
    }
    // Same term from a different authority: the announcement reconciliation
    // decides the authority; the state is still reconciled below. The state
    // report is attributed to the transport sender (pushes come from the
    // shell holding the state), falling back to the envelope's authority.
    this.recordObservation(
      message.senderMemberId ?? message.authorityMemberId,
      message.revision,
      message.stateHash,
    );
    if (message.revision < this.revision) {
      if (adoptedAuthority) {
        this.maybePushTo(message.authorityMemberId, message.revision, message.stateHash);
      }
      return;
    }
    if (message.historyMode === "full") {
      // A full snapshot from the authority answers an outstanding resync,
      // even when we keep our own state below (a same-revision conflict).
      this.resyncOutstandingUntil = 0;
      this.historyRequestAnswered = true;
    }
    if (
      message.revision === this.revision &&
      message.stateHash !== null &&
      message.stateHash !== this.stateHash
    ) {
      // Same revision, conflicting states: deterministic resolution —
      // majority-matching hash when available, then the stable tie-breaker.
      const winnerHash = this.resolveRevisionConflict(this.revision);
      if (winnerHash !== message.stateHash) {
        // We keep our state. If we are the authority, pull the sender toward
        // ours so both sides converge on the same resolution.
        if (
          this.authorityMemberId === this.selfMemberId &&
          message.senderMemberId !== undefined &&
          message.senderMemberId !== this.selfMemberId &&
          this.canonical !== null
        ) {
          this.host.sendSnapshot(this.snapshotEnvelope("full"), message.senderMemberId);
        }
        return;
      }
    }
    const incremental = message.historyMode === "increment";
    if (incremental && message.revision === this.revision && message.stateHash === this.stateHash) {
      return; // a duplicate of the state we hold; its IDs are already recorded
    }
    // An increment continues from the state it was built on: the next
    // revision, on the same lineage (its base hash is our hash). Anything
    // else means commits were missed or we are on another lineage, so their
    // dedup IDs are absent and a full snapshot must be requested.
    // A same-revision increment that reached this point is on another lineage
    // (an equal hash returned above), so it is a gap too.
    const gap =
      incremental &&
      (message.revision !== this.revision + 1 ||
        (message.baseStateHash ?? null) !== this.stateHash);
    // A shell with no state yet has no complete window of its own to keep.
    const freshJoiner = this.canonical === null;
    this.canonical = message.state;
    this.revision = message.revision;
    this.stateHash = message.stateHash;
    this.viewIsState = message.viewIsState === true;
    if (this.viewIsState && message.authorityMemberId !== this.selfMemberId) {
      this.host.emit({ type: "viewFromState", state: this.canonical });
    }
    if (message.authorityMemberId === this.authorityMemberId || adoptedAuthority) {
      this.authorityStateRevision = Math.max(this.authorityStateRevision, message.revision);
    }
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
    let repairNeeded = false;
    if (!incremental && message.historyComplete !== false) {
      // A complete full snapshot carries the sender's whole window: it
      // replaces ours, so an ID the sender does not hold is not acknowledged
      // as accepted here. An incomplete one is merged below, and our own
      // completeness flag stays as it was, so a complete window is never shrunk.
      this.history.clear();
      this.historyComplete = true;
    } else if (!incremental && freshJoiner) {
      // A joiner that merges an incomplete window into nothing holds a gapped
      // window: it must ask for a repair rather than treat the window as complete.
      this.historyComplete = false;
      repairNeeded = true;
    }
    const rejections = new Map(
      message.actionRejections?.map((result) => [result.actionId, result]),
    );
    for (const actionId of message.processedActionIds) {
      if (!this.history.has(actionId)) {
        this.storeHistory(actionId, {
          actionId,
          ...(rejections.get(actionId) ?? { status: "accepted", revision: message.revision }),
          processedAt: this.now(),
        });
      }
    }
    if (gap) {
      this.historyComplete = false;
      this.historyRequestAnswered = false;
      this.requestResync();
    } else if (repairNeeded) {
      this.requestResync();
    }
    if (this.authorityMemberId === this.selfMemberId && this.restoreDone) {
      // The authority adopted a peer's higher state (a restore push that
      // arrived after the window): replicate and re-announce so every shell
      // converges on the adopted state.
      this.broadcastSnapshot(false);
      this.announce();
    }
  }

  /**
   * A `state.resync` request arrived. Only the sitting authority answers, with
   * the same full snapshot a late joiner gets (state plus full history, and
   * the requester's view). Repeats from one member inside the rate-limit
   * window are ignored, so resync traffic per member is bounded.
   */
  handleResync(request: { requesterMemberId: string; knownRevision: number }): void {
    if (this.disposed || this.ended) return;
    if (this.authorityMemberId !== this.selfMemberId || !this.restoreDone) return;
    if (this.canonical === null) return;
    const requester = request.requesterMemberId;
    if (requester === this.selfMemberId || !this.host.isConnected(requester)) return;
    if (request.knownRevision > this.revision) return;
    const now = this.now();
    // Forget requesters whose window has passed, so the map stays bounded.
    for (const [member, at] of this.resyncServedAt) {
      if (now - at >= stateResyncMinIntervalMs) this.resyncServedAt.delete(member);
    }
    const servedAt = this.resyncServedAt.get(requester);
    if (servedAt !== undefined && now - servedAt < stateResyncMinIntervalMs) return;
    this.resyncServedAt.set(requester, now);
    this.host.sendSnapshot(this.snapshotEnvelope("full"), requester);
    const viewer = this.host.players().find((player) => player.id === requester);
    if (viewer !== undefined) {
      void this.computeViewFor(viewer);
    }
  }

  /**
   * Receiver side: ask the authority for a full snapshot. At most one request
   * is outstanding per `stateResyncMinIntervalMs`; a full snapshot clears it.
   */
  protected requestResync(): void {
    if (this.disposed || this.ended) return;
    const now = this.now();
    if (this.resyncOutstandingUntil > now) return;
    const authority = this.authorityMemberId;
    if (authority === null || authority === this.selfMemberId) return;
    this.resyncOutstandingUntil = now + stateResyncMinIntervalMs;
    this.historyRequestAnswered = false;
    this.host.sendResync(authority, { knownRevision: this.revision });
  }

  /**
   * Compute one player's view (late joiners) and hand it to the host to
   * deliver. Runs on the authority; failures surface as state errors.
   */
  async computeViewFor(viewer: NovaPlayer): Promise<void> {
    if (this.disposed || this.canonical === null) return;
    if (this.authorityMemberId !== this.selfMemberId) return;
    const result = await this.withExecutorTimeout(
      this.executor.computeView({
        state: this.canonical,
        viewer,
        context: this.contextFor(this.revision),
      }),
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

  /**
   * Push our replicated state to `authorityMemberId` when it is strictly
   * higher (or conflicts at the same revision): the elected authority
   * restores the highest valid replicated state (ADR-0007).
   */
  protected maybePushTo(
    authorityMemberId: string,
    authorityRevision: number,
    authorityHash: string | null,
  ): void {
    if (this.disposed || !this.started || this.ended) return;
    if (authorityMemberId === this.selfMemberId) return;
    if (this.canonical === null) return;
    if (this.revision > authorityRevision) {
      this.host.sendSnapshot(this.snapshotEnvelope("full"), authorityMemberId);
      return;
    }
    if (
      this.revision === authorityRevision &&
      authorityHash !== null &&
      this.stateHash !== null &&
      this.stateHash !== authorityHash
    ) {
      this.host.sendSnapshot(this.snapshotEnvelope("full"), authorityMemberId);
    }
  }

  /**
   * Send one broadcast. A delta that cannot be sent falls back to the full state,
   * and a failure to send is reported as a diagnostic: a snapshot must never
   * fail the commit that produced it.
   */
  private sendBroadcast(
    historyMode: "full" | "increment",
    ops: readonly JsonDeltaOp[] | null,
  ): void {
    if (ops !== null) {
      try {
        this.host.sendSnapshot(this.snapshotEnvelope(historyMode, ops));
        return;
      } catch (error) {
        this.host.emit({ type: "snapshotFallback", reason: describeError(error) });
      }
    }
    try {
      this.host.sendSnapshot(this.snapshotEnvelope(historyMode, null));
    } catch (error) {
      this.host.emit({ type: "snapshotFallback", reason: describeError(error) });
    }
  }

  /**
   * The delta from the previous broadcast to the current state, or null when it
   * cannot be sent or is not smaller than the full state. Never throws: a delta
   * that fails to compute falls back to the full state, like a failed send.
   */
  private smallerDeltaOrNull(previous: unknown, next: unknown): JsonDeltaOp[] | null {
    try {
      const candidate = deltaFor(previous, next);
      return candidate !== null && serializedBytesSync(candidate) < serializedBytesSync(next)
        ? candidate
        : null;
    } catch (error) {
      this.host.emit({ type: "snapshotFallback", reason: describeError(error) });
      return null;
    }
  }

  /** The state envelope for this shell's current replicated state. */
  private snapshotEnvelope(
    historyMode: "full" | "increment",
    ops: readonly JsonDeltaOp[] | null = null,
  ): StateSnapshotEnvelope {
    const delta = ops !== null;
    return {
      revision: this.revision,
      stateHash: this.stateHash,
      term: this.term,
      authorityMemberId: this.authorityMemberId ?? this.selfMemberId,
      historyMode,
      baseStateHash: historyMode === "increment" || delta ? this.lastBroadcastStateHash : null,
      stateMode: delta ? "delta" : "full",
      ops,
      historyComplete: this.historyComplete,
      ...this.actionHistory(historyMode === "increment" ? [...this.pendingHistoryIds] : undefined),
      // A delta has no state: the key is absent on the wire, not null.
      state: delta ? undefined : this.canonical,
      viewIsState: this.viewIsState,
    };
  }

  /**
   * Broadcast the replicated state to every shell. An increment is used only
   * when it is continuous with this engine's previous broadcast; otherwise
   * the full history goes out. Either way the pending IDs are drained.
   */
  protected broadcastSnapshot(allowIncrement: boolean): void {
    const continuous = allowIncrement && this.lastBroadcastRevision === this.revision - 1;
    const increment =
      continuous &&
      !this.pendingHistoryOverflow &&
      this.pendingHistoryIds.size <= Math.min(this.historyLimit, stateHistoryLimit);
    // A delta is sent only when this broadcast continues the previous one and
    // the diff is smaller than the full state; otherwise the full state goes out.
    const ops =
      continuous && this.lastBroadcastCanonical !== null && this.canonical !== null
        ? this.smallerDeltaOrNull(this.lastBroadcastCanonical, this.canonical)
        : null;
    this.sendBroadcast(increment ? "increment" : "full", ops);
    this.lastBroadcastRevision = this.revision;
    this.lastBroadcastStateHash = this.stateHash;
    this.lastBroadcastCanonical = this.canonical;
    this.pendingHistoryIds.clear();
    this.pendingHistoryOverflow = false;
  }

  protected abstract adoptTerm(term: number, authorityMemberId: string): void;
  protected abstract recordObservation(
    memberId: string,
    revision: number,
    stateHash: string | null,
  ): void;
  protected abstract resolveRevisionConflict(revision: number): string | null;
  abstract announce(): void;
}
