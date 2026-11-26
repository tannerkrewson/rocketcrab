import {
  REVISION_VOTES_LIMIT,
  type ObservedStateEnvelope,
  type ElectionState,
  announcementWins,
} from "./state-engine-shared";
import { StateEngineSnapshots } from "./state-engine-snapshots";

/** Authority terms, handoff, restore, and heartbeat scheduling. */
export abstract class StateEngineElection extends StateEngineSnapshots {
  /** Re-announce after this session's transport reconnected (authority). */
  announce(): void {
    if (this.disposed || this.ended) return;
    if (!this.isAuthorityElect()) return;
    this.syncTickClock();
    this.authorityMemberId = this.selfMemberId;
    this.authorityStateRevision = this.revision;
    this.host.sendAnnounce({
      term: this.term,
      authorityMemberId: this.selfMemberId,
      stateRevision: this.revision,
      stateHash: this.stateHash,
      eligibleMemberIds: this.host.eligibleMemberIds(),
    });
  }

  /**
   * An `authority.announce` arrived (term-gated with deterministic
   * reconciliation of conflicting same-term claims).
   */
  handleAnnounce(message: {
    term: number;
    authorityMemberId: string;
    stateRevision: number;
    stateHash?: string;
    eligibleMemberIds?: readonly string[];
  }): void {
    if (!this.acceptsAuthorityClaim(message.term, message.authorityMemberId)) return;
    this.recordObservation(
      message.authorityMemberId,
      message.stateRevision,
      message.stateHash ?? null,
    );
    if (this.adoptHigherTerm(message.term, message.authorityMemberId, message.stateRevision)) {
    } else if (message.authorityMemberId === this.authorityMemberId) {
      // The current authority re-announced (reconnect / revision bump).
      this.authorityStateRevision = Math.max(this.authorityStateRevision, message.stateRevision);
      if (message.authorityMemberId !== this.selfMemberId) {
        this.armGraceTimer();
      }
    } else if (this.authorityMemberId === null) {
      this.adoptTerm(message.term, message.authorityMemberId);
      this.authorityStateRevision = Math.max(this.authorityStateRevision, message.stateRevision);
    } else {
      // Same term, conflicting authorities: deterministic reconciliation.
      const current = { memberId: this.authorityMemberId, revision: this.authorityStateRevision };
      const incoming = { memberId: message.authorityMemberId, revision: message.stateRevision };
      if (announcementWins(incoming, current)) {
        this.adoptTerm(message.term, message.authorityMemberId);
        this.authorityStateRevision = Math.max(this.authorityStateRevision, message.stateRevision);
      }
    }
    this.maybePushTo(message.authorityMemberId, message.stateRevision, message.stateHash ?? null);
  }

  /**
   * An `authority.heartbeat` arrived: refreshes liveness of the current
   * term's authority; a strictly higher term adopts the new authority.
   */
  handleHeartbeat(message: {
    term: number;
    authorityMemberId: string;
    stateRevision: number;
    heartbeatSeq: number;
  }): void {
    if (!this.acceptsAuthorityClaim(message.term, message.authorityMemberId)) return;
    if (this.adoptHigherTerm(message.term, message.authorityMemberId, message.stateRevision)) {
      this.lastHeartbeatAt = this.now();
    } else if (
      this.authorityMemberId === null &&
      this.election === null &&
      message.authorityMemberId !== this.selfMemberId
    ) {
      // A shell that has not seen this term's authority (a session created
      // after the game started, such as a player joining or reloading
      // mid-game) adopts it here and catches up below.
      this.adoptTerm(message.term, message.authorityMemberId);
      this.authorityStateRevision = Math.max(this.authorityStateRevision, message.stateRevision);
      this.lastHeartbeatAt = this.now();
    } else if (message.authorityMemberId === this.authorityMemberId) {
      this.authorityStateRevision = Math.max(this.authorityStateRevision, message.stateRevision);
      this.lastHeartbeatAt = this.now();
      this.armGraceTimer();
    }
    // Same term from a different member: the announcement reconciliation
    // decides the authority; the heartbeat is ignored.
    if (
      message.authorityMemberId !== this.selfMemberId &&
      message.authorityMemberId === this.authorityMemberId &&
      ((!this.historyComplete && !this.historyRequestAnswered) ||
        message.stateRevision > this.revision)
    ) {
      // Heartbeats say how far the authority has got. A follower that is
      // behind asks again. A gapped follower asks again only while its request
      // is unanswered (an expired window is the retry after a lost reply), so
      // a request the authority answered is not repeated every second.
      this.requestResync();
    }
  }

  /**
   * An `authority.election` arrived: a strictly higher term makes every
   * connected member (including a sitting authority) join the campaign; the
   * deterministic winner is the lowest connected eligible member id.
   */
  handleElection(message: {
    term: number;
    candidateMemberId: string;
    observed: readonly { memberId: string; revision: number; stateHash?: string }[];
  }): void {
    if (!this.acceptsAuthorityClaim(message.term, message.candidateMemberId)) return;
    for (const observation of message.observed) {
      this.recordObservation(
        observation.memberId,
        observation.revision,
        observation.stateHash ?? null,
      );
    }
    if (message.term > this.term) {
      this.startElectionAt(message.term);
    } else if (this.election !== null && this.election.term === message.term) {
      this.election.candidates.add(message.candidateMemberId);
    }
  }

  /**
   * The authority left (its connection dropped): suspicion is immediate —
   * the grace period only covers silent loss. An election begins at the next
   * term.
   */
  notifyAuthorityLeft(): void {
    if (this.disposed || !this.started || this.ended) return;
    if (this.authorityMemberId === null || this.authorityMemberId === this.selfMemberId) return;
    this.authorityMemberId = null;
    this.clearGraceTimer();
    this.startElection();
  }

  /**
   * Hand authority to another player now (this page is being hidden, and a
   * phone may suspend it). The session marks this player ineligible first,
   * so the election it starts picks someone else; resigning is skipped when
   * nobody else could take over, so the party never ends up leaderless.
   */
  stepDown(): void {
    if (this.disposed || !this.started || this.ended) return;
    if (this.authorityMemberId !== this.selfMemberId || this.election !== null) return;
    if (this.lowestEligibleMemberId() === null) return;
    this.startElection();
  }

  /**
   * This transport reconnected (fresh connection id): a sitting authority
   * re-announces and resumes heartbeats; a follower restarts its authority
   * watch (the catch-up snapshot materializes the current authority, and the
   * grace timer campaigns if nothing does).
   */
  onSelfReconnected(): void {
    if (this.disposed || !this.started || this.ended) return;
    if (this.authorityMemberId === this.selfMemberId) {
      this.announce();
      this.startHeartbeats();
      return;
    }
    this.armGraceTimer();
  }

  /** Start an election at the next monotonic term. */
  private startElection(): void {
    this.startElectionAt(this.term + 1);
  }

  /**
   * Campaign at `term` (joining an observed higher-term election is
   * idempotent per term). A sitting authority steps down: its stale term can
   * never win, and its in-flight actions are re-sent once the new term's
   * authority is announced.
   */
  private startElectionAt(term: number): void {
    if (this.disposed || !this.started || this.ended) return;
    if (!this.host.selfConnected()) return; // campaigns need a live link
    if (this.election !== null && this.election.term >= term) {
      this.election.candidates.add(this.selfMemberId);
      return;
    }
    this.term = Math.max(this.term, term);
    this.clearGraceTimer();
    this.clearRestoreTimer();
    this.clearElectionTimer();
    this.clearWinnerWaitTimer();
    this.stopHeartbeats();
    this.restoreDone = true;
    this.restoreBackup = null;
    this.queue.length = 0; // stale-term actions; dispatchers re-send
    this.authorityMemberId = null;
    this.authorityElect = null;
    const election: ElectionState = {
      term: this.term,
      candidates: new Set([this.selfMemberId]),
      timer: null,
    };
    this.election = election;
    this.host.emit({ type: "electionStarted", term: this.term });
    this.host.sendElection({
      term: this.term,
      candidateMemberId: this.selfMemberId,
      observed: this.observedStates(),
    });
    election.timer = setTimeout(() => {
      if (this.election !== election) return; // superseded or settled
      this.election = null;
      this.finalizeElection(election.term);
    }, this.electionWindowMs);
  }

  /** Finalize a campaign: the lowest connected eligible member wins. */
  private finalizeElection(term: number): void {
    if (this.disposed || !this.started || this.ended) return;
    if (!this.host.selfConnected()) return; // wait for reconnect, then re-arm
    const winner = this.lowestEligibleMemberId();
    if (winner === null) return;
    if (winner === this.selfMemberId) {
      this.becomeAuthority(term);
      return;
    }
    // The winner announces on its own schedule. If it never materializes
    // (it may have missed our campaigns — e.g. it was reconnecting while we
    // campaigned, or a silent partition hid it), re-elect at the next term
    // so the party cannot stall forever waiting for an announcement.
    this.armWinnerWaitTimer();
  }

  /** Become the elected authority for `term`: announce, then restore. */
  private becomeAuthority(term: number): void {
    if (this.disposed || !this.started || this.ended) return;
    if (this.term < term) this.term = term;
    this.authorityMemberId = this.selfMemberId;
    this.authorityElect = this.selfMemberId;
    this.authorityStateRevision = this.revision;
    this.clearGraceTimer();
    this.restoreDone = false;
    // The first broadcast as authority is full: this engine's cursor from an
    // earlier term says nothing about what the current shells hold.
    this.lastBroadcastRevision = null;
    this.lastBroadcastCanonical = null;
    this.pendingHistoryIds = new Set();
    this.pendingHistoryOverflow = false;
    if (!this.historyComplete) {
      // The elected authority's window has a gap. It still serves: its full
      // broadcast is merged by complete shells, so their windows are not
      // shrunk. Diagnostic only; the game is not affected.
      this.host.emit({
        type: "historyIncomplete",
        authorityMemberId: this.selfMemberId,
        term: this.term,
      });
    }
    this.restoreBackup =
      this.canonical === null
        ? null
        : {
            canonical: this.canonical,
            revision: this.revision,
            stateHash: this.stateHash,
            history: new Map(this.history),
            roster: this.roster,
          };
    this.host.emit({
      type: "authorityChanged",
      authorityMemberId: this.selfMemberId,
      term: this.term,
    });
    this.announce();
    this.startHeartbeats();
    if (this.restoreBackup === null) {
      // A shell that missed every snapshot has nothing to restore; it keeps
      // waiting for a peer push and cannot process actions (state error).
      this.restoreDone = true;
      this.host.emit({
        type: "stateError",
        code: "no_replicated_state",
        message:
          "The elected authority has no replicated state to restore; buffered actions wait for a peer snapshot.",
      });
      return;
    }
    const restoreTimer = setTimeout(() => {
      this.restoreTimer = null;
      void this.finishRestore();
    }, this.restoreWindowMs);
    this.restoreTimer = restoreTimer;
  }

  /**
   * Restore completed: verify the adopted state's hash (reverting to the
   * previous replicated state on mismatch), re-announce + replicate so every
   * shell converges, then drain the buffered-action queue.
   */
  private async finishRestore(): Promise<void> {
    if (this.disposed || !this.started || this.ended) return;
    if (this.authorityMemberId !== this.selfMemberId) return; // deposed mid-restore
    // Actions stay gated until the restored state is verified and the first
    // (full) broadcast has gone out, so no commit can precede that broadcast.
    if (this.stateHash !== null && this.canonical !== null && this.restoreBackup !== null) {
      const verifiedState = this.canonical;
      const expectedHash = this.stateHash;
      const actual = await this.stateHashImpl(verifiedState);
      if (this.disposed) return;
      if (this.authorityMemberId !== this.selfMemberId) return; // deposed during the hash
      // A newer snapshot replaced the state during the hash: it wins, so the
      // revert is skipped. Restore still completes below, so queued actions
      // are processed and the authority broadcasts its first full snapshot.
      if (this.canonical === verifiedState && actual !== expectedHash) {
        const backup = this.restoreBackup;
        this.canonical = backup.canonical;
        this.revision = backup.revision;
        this.stateHash = backup.stateHash;
        this.roster = backup.roster;
        this.history.clear();
        for (const [actionId, record] of backup.history) {
          this.history.set(actionId, record);
        }
        this.host.emit({
          type: "stateError",
          code: "invalid_snapshot",
          message:
            "The restored replicated state failed its hash check; the previous replicated state was kept.",
        });
      }
    }
    this.restoreDone = true;
    this.restoreBackup = null;
    this.announce();
    if (this.canonical !== null) {
      this.broadcastSnapshot(false);
    }
    this.reconcileRoster();
    void this.processQueue();
  }

  /** Adopt `authorityMemberId` as the authority for `term` (monotonic). */
  /**
   * Shared gate for term/authority claims (announce, heartbeat, election):
   * stale terms are ignored, and a claim from a currently disconnected member
   * that is not this shell is not evidence (a reconnect re-announces).
   */
  private acceptsAuthorityClaim(term: number, memberId: string): boolean {
    if (this.disposed || term < this.term) return false;
    return memberId === this.selfMemberId || this.host.isConnected(memberId);
  }

  /** Adopt a strictly higher term (single place that bumps the observed revision). */
  private adoptHigherTerm(term: number, memberId: string, stateRevision: number): boolean {
    if (term <= this.term) return false;
    this.adoptTerm(term, memberId);
    this.authorityStateRevision = Math.max(this.authorityStateRevision, stateRevision);
    return true;
  }

  protected adoptTerm(term: number, authorityMemberId: string): void {
    if (term < this.term) return;
    const wasAuthority = this.authorityMemberId === this.selfMemberId;
    const changed = term !== this.term || authorityMemberId !== this.authorityMemberId;
    this.term = term;
    this.authorityMemberId = authorityMemberId;
    this.authorityElect = authorityMemberId;
    this.clearGraceTimer();
    this.clearRestoreTimer();
    this.clearElectionTimer();
    this.clearWinnerWaitTimer();
    this.election = null;
    this.restoreDone = true;
    this.restoreBackup = null;
    if (wasAuthority && authorityMemberId !== this.selfMemberId) {
      this.stopHeartbeats();
      this.queue.length = 0; // stale-term actions; dispatchers re-send
    }
    if (authorityMemberId !== this.selfMemberId) {
      this.armGraceTimer();
    }
    if (changed) {
      this.host.emit({ type: "authorityChanged", authorityMemberId, term });
    }
  }

  /** (Re)arm the follower's authority watch (grace period). */
  private armGraceTimer(): void {
    this.clearGraceTimer();
    if (this.disposed || !this.started || this.ended) return;
    if (this.authorityMemberId === this.selfMemberId) return;
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      this.onGraceExpired();
    }, this.gracePeriodMs);
  }

  /** Missing heartbeats: suspect the authority and start an election. */
  private onGraceExpired(): void {
    if (this.disposed || !this.started || this.ended) return;
    if (!this.host.selfConnected()) return; // reconnect first (re-arms)
    if (this.election !== null) return;
    if (this.authorityMemberId === this.selfMemberId) return;
    this.startElection();
  }

  /**
   * Wait for an elected winner's announcement; re-elect when it never
   * materializes (the winner may have missed the campaigns while it was
   * reconnecting, or a partition hid it; a party must never stall).
   */
  private armWinnerWaitTimer(): void {
    this.clearWinnerWaitTimer();
    if (this.disposed || !this.started || this.ended) return;
    this.winnerWaitTimer = setTimeout(() => {
      this.winnerWaitTimer = null;
      if (this.disposed || !this.started || this.ended) return;
      if (!this.host.selfConnected()) return;
      if (this.election !== null) return;
      if (this.authorityMemberId === null) {
        this.startElection(); // the winner never announced: elect again
      }
    }, this.gracePeriodMs);
  }

  protected startHeartbeats(): void {
    this.clearHeartbeatTimer();
    if (this.disposed || !this.started || this.ended) return;
    if (this.authorityMemberId !== this.selfMemberId) return;
    this.heartbeatSeq = 0;
    this.heartbeatTimer = setInterval(() => {
      if (this.disposed || this.ended) return;
      if (this.authorityMemberId !== this.selfMemberId) {
        this.clearHeartbeatTimer();
        return;
      }
      this.heartbeatSeq += 1;
      this.host.sendHeartbeat({
        term: this.term,
        authorityMemberId: this.selfMemberId,
        stateRevision: this.revision,
        heartbeatSeq: this.heartbeatSeq,
      });
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeats(): void {
    this.clearHeartbeatTimer();
  }

  /** State observations carried in election campaigns (bounded). */
  private observedStates(): readonly ObservedStateEnvelope[] {
    const observed: ObservedStateEnvelope[] = [
      { memberId: this.selfMemberId, revision: this.revision, stateHash: this.stateHash },
    ];
    for (const [revision, byHash] of this.revisionVotes) {
      for (const [stateHash, reporters] of byHash) {
        for (const memberId of reporters) {
          if (memberId === this.selfMemberId) continue;
          if (!this.host.isConnected(memberId)) continue;
          observed.push({ memberId, revision, stateHash });
          if (observed.length >= 8) return observed;
        }
      }
    }
    return observed;
  }

  /** Record one member's state report for conflict reconciliation. */
  protected recordObservation(memberId: string, revision: number, stateHash: string | null): void {
    if (stateHash === null) return;
    let byHash = this.revisionVotes.get(revision);
    if (byHash === undefined) {
      byHash = new Map();
      this.revisionVotes.set(revision, byHash);
    }
    let reporters = byHash.get(stateHash);
    if (reporters === undefined) {
      reporters = new Set();
      byHash.set(stateHash, reporters);
    }
    reporters.add(memberId);
    while (this.revisionVotes.size > REVISION_VOTES_LIMIT) {
      let oldest: number | null = null;
      for (const revisionKey of this.revisionVotes.keys()) {
        if (oldest === null || revisionKey < oldest) oldest = revisionKey;
      }
      if (oldest === null) break;
      this.revisionVotes.delete(oldest);
    }
  }

  /**
   * Deterministic same-revision conflict resolution: the
   * majority-matching hash wins; a tie falls to the hash reported by the
   * lowest member id. Returns the winning hash, or our own hash when there
   * are no observations (stable default: keep the current state).
   */
  protected resolveRevisionConflict(revision: number): string | null {
    const byHash = this.revisionVotes.get(revision);
    if (byHash === undefined || byHash.size === 0) {
      return this.stateHash;
    }
    let winner: string | null = null;
    let bestVotes = 0;
    let bestReporter: string | null = null;
    for (const [hash, reporters] of byHash) {
      const votes = reporters.size;
      let lowestReporter: string | null = null;
      for (const memberId of reporters) {
        if (lowestReporter === null || memberId < lowestReporter) lowestReporter = memberId;
      }
      if (
        winner === null ||
        votes > bestVotes ||
        (votes === bestVotes &&
          (bestReporter === null || lowestReporter === null || lowestReporter < bestReporter))
      ) {
        winner = hash;
        bestVotes = votes;
        bestReporter = lowestReporter;
      }
    }
    return winner;
  }

  private clearGraceTimer(): void {
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearRestoreTimer(): void {
    if (this.restoreTimer !== null) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
  }

  private clearElectionTimer(): void {
    if (this.election !== null && this.election.timer !== null) {
      clearTimeout(this.election.timer);
      this.election.timer = null;
    }
  }

  private clearWinnerWaitTimer(): void {
    if (this.winnerWaitTimer !== null) {
      clearTimeout(this.winnerWaitTimer);
      this.winnerWaitTimer = null;
    }
  }

  protected clearTimers(): void {
    this.clearTickTimer();
    this.clearGraceTimer();
    this.clearHeartbeatTimer();
    this.clearRestoreTimer();
    this.clearElectionTimer();
    this.clearWinnerWaitTimer();
    this.clearRosterTimer();
  }

  protected abstract clearRosterTimer(): void;
  protected abstract syncTickClock(): void;
  protected abstract processQueue(): void;
  protected abstract clearTickTimer(): void;
}
