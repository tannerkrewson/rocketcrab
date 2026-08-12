/**
 * The S2/S3 state-mode engine: Nova's authority-side state machine.
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
 * - state-size and action-rate diagnostics;
 * - automatic authority election and migration (S3, ADR-0007).
 *
 * ## S3: authority election and migration
 *
 * Game code never knows which peer executes authoritative transitions. The
 * engine implements the ADR-0007 protocol over the term + revision + hash
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
 *   collects candidates for `electionWindowMs`. Every connected eligible
 *   member is a candidate (a higher-term campaign makes followers join and a
 *   sitting authority step down), so the deterministic winner — the lowest
 *   connected eligible member id — is the same for every peer that sees the
 *   same membership. Conflicting same-term announcements reconcile by
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
 * - **Conflict reconciliation** (ADR-0007): state envelopes carry revision,
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
import {
  actionTimeoutMs,
  actionPayloadBytes,
  authorityGracePeriodMs,
  authorityHeartbeatIntervalMs,
  stateSnapshotBytes,
} from "@rocketcrab/protocol";
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

/** How many revisions of state-hash votes the conflict tracker retains. */
const REVISION_VOTES_LIMIT = 64;

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

/** An authority heartbeat (S3 liveness for the current term). */
export interface AuthorityHeartbeatEnvelope {
  readonly term: number;
  readonly authorityMemberId: string;
  readonly stateRevision: number;
  readonly heartbeatSeq: number;
}

/** One member's observed replicated state (election observations). */
export interface ObservedStateEnvelope {
  readonly memberId: string;
  readonly revision: number;
  readonly stateHash: string | null;
}

/** An authority election campaign (S3). */
export interface AuthorityElectionEnvelope {
  readonly term: number;
  readonly candidateMemberId: string;
  readonly observed: readonly ObservedStateEnvelope[];
}

/** The transport-facing half the session implements for the engine. */
export interface StateEngineHost {
  /** Every connected player, self first, then peers in join order. */
  players(): readonly NovaPlayer[];
  /** True when a member is currently connected. */
  isConnected(memberId: string): boolean;
  /** True when this transport is currently connected (campaigns need it). */
  selfConnected(): boolean;
  /** Member ids of every connected member eligible for authority. */
  eligibleMemberIds(): readonly string[];
  /** Send one action ack to a member (targeted). */
  sendAck(targetMemberId: string, ack: NovaActionAck): void;
  /** Broadcast a state snapshot, or target one member. */
  sendSnapshot(snapshot: StateSnapshotEnvelope, targetMemberId?: string): void;
  /** Send one player's selected view (targeted). */
  sendView(targetMemberId: string, view: StateViewEnvelope): void;
  /** Announce this session as the authority. */
  sendAnnounce(announcement: AuthorityAnnounceEnvelope): void;
  /** Broadcast an authority heartbeat (S3). */
  sendHeartbeat(heartbeat: AuthorityHeartbeatEnvelope): void;
  /** Broadcast an authority election campaign (S3). */
  sendElection(election: AuthorityElectionEnvelope): void;
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
  | { type: "stateError"; code: string; message: string }
  /** The authority for the current term changed (session flushes buffers). */
  | { type: "authorityChanged"; authorityMemberId: string | null; term: number }
  /** A suspicion started an election (host/arena diagnostics). */
  | { type: "electionStarted"; term: number };

/** Options for {@link NovaStateEngine}. */
export interface NovaStateEngineOptions {
  readonly host: StateEngineHost;
  readonly executor: NovaStateExecutor;
  readonly selfMemberId: string;
  /**
   * True when the session runs a simulation-mode game (A1). The election
   * machinery is mode-agnostic, but simulation mode has no canonical state:
   * the initial authority announces without creating one, and an elected
   * authority never reports `no_replicated_state` (the simulation engine
   * restores the replicated simulation snapshot itself).
   */
  simulation?: boolean;
  /** Epoch-ms clock (tests inject a fake). */
  now?: () => number;
  /** How long the authority waits for the executor before rejecting. */
  executorTimeoutMs?: number;
  /** Bounded action-history retention. */
  historyLimit?: number;
  /** Authority heartbeat interval (S3; configurable for tests). */
  heartbeatIntervalMs?: number;
  /** Missing-heartbeat grace period before suspicion (S3). */
  gracePeriodMs?: number;
  /** How long an election collects candidates before finalizing (S3). */
  electionWindowMs?: number;
  /** How long the winner collects state pushes before restoring (S3). */
  restoreWindowMs?: number;
}

interface ActionStats {
  applied: number;
  rejected: number;
  timestamps: number[];
}

interface ElectionState {
  readonly term: number;
  readonly candidates: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

interface RestoreBackup {
  readonly canonical: unknown;
  readonly revision: number;
  readonly stateHash: string | null;
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
 * Deterministic announcement reconciliation (ADR-0007): at the same term the
 * announcement with the higher state revision wins; equal revisions fall to
 * the lower member id. Both sides compute the same result, so a partition
 * merge converges on exactly one authority.
 */
function announcementWins(
  incoming: { readonly memberId: string; readonly revision: number },
  current: { readonly memberId: string; readonly revision: number },
): boolean {
  if (incoming.revision !== current.revision) {
    return incoming.revision > current.revision;
  }
  return incoming.memberId < current.memberId;
}

/**
 * The state-mode engine. One instance per session; only the authority's
 * instance applies actions, every instance keeps the replicated canonical
 * state for migration (ADR-0007) and tracks the authority and its term.
 */
export class NovaStateEngine {
  private readonly host: StateEngineHost;
  private executor: NovaStateExecutor;
  private readonly selfMemberId: string;
  private readonly simulation: boolean;
  private readonly now: () => number;
  private readonly executorTimeoutMs: number;
  private readonly historyLimit: number;
  private readonly heartbeatIntervalMs: number;
  private readonly gracePeriodMs: number;
  private readonly electionWindowMs: number;
  private readonly restoreWindowMs: number;

  private canonical: unknown | null = null;
  private revision = 0;
  private stateHash: string | null = null;
  private term = 1;
  private authorityMemberId: string | null = null;
  private authorityElect: string | null = null;
  /** Last revision the current authority claimed (announces/heartbeats). */
  private authorityStateRevision = 0;
  private lastHeartbeatAt: number | null = null;
  private heartbeatSeq = 0;
  private started = false;
  private ended = false;
  private disposed = false;
  /** True once the elected authority finished restoring its state. */
  private restoreDone = true;
  private restoreBackup: RestoreBackup | null = null;
  private election: ElectionState | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private winnerWaitTimer: ReturnType<typeof setTimeout> | null = null;
  /** revision -> (stateHash -> reporting member ids) for reconciliation. */
  private readonly revisionVotes = new Map<number, Map<string, Set<string>>>();
  private readonly history = new Map<string, ProcessedActionRecord>();
  private readonly queue: PendingAction[] = [];
  private processing: Promise<void> | null = null;
  private readonly lastSeqByActor = new Map<string, number>();
  private readonly stats: ActionStats = { applied: 0, rejected: 0, timestamps: [] };
  private lastCommitAt: number | null = null;

  constructor(options: NovaStateEngineOptions) {
    this.host = options.host;
    this.executor = options.executor;
    this.selfMemberId = options.selfMemberId;
    this.simulation = options.simulation ?? false;
    this.now = options.now ?? (() => Date.now());
    this.executorTimeoutMs = options.executorTimeoutMs ?? actionTimeoutMs;
    this.historyLimit = options.historyLimit ?? STATE_HISTORY_LIMIT;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? authorityHeartbeatIntervalMs;
    this.gracePeriodMs = options.gracePeriodMs ?? authorityGracePeriodMs;
    this.electionWindowMs = options.electionWindowMs ?? 500;
    this.restoreWindowMs = options.restoreWindowMs ?? 500;
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

  /** The current authority's member id, or null when none is known. */
  getAuthorityMemberId(): string | null {
    return this.authorityMemberId;
  }

  /** The current authority term (monotonic; S3). */
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
  getCanonicalState(): unknown {
    return this.canonical;
  }

  /** The processed action ids shipped in snapshots (bounded, oldest first). */
  processedActionIds(): readonly string[] {
    return [...this.history.keys()];
  }

  /** Host-side diagnostics (S2/S3 acceptance: election state is visible). */
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
    };
  }

  // ------------------------------------------------------------------
  // Lifecycle (session-driven)
  // ------------------------------------------------------------------

  /**
   * Mark the game as begun; the lowest connected eligible member becomes the
   * deterministic initial authority (ADR-0007). A session that already saw
   * the authority (late joiner) defers to the announced member; the initial
   * authority is never derived from a late joiner's own view.
   */
  beginGame(): void {
    if (this.started) return;
    this.started = true;
    this.authorityElect = this.authorityMemberId ?? this.lowestEligibleMemberId();
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

  // ------------------------------------------------------------------
  // Authority start (session calls on the initial authority)
  // ------------------------------------------------------------------

  /**
   * Initialize as the authority: create the initial canonical state,
   * commit revision 1, distribute views, announce, and start heartbeats.
   * Resolves false when the initial state failed (the game must not start).
   */
  async initializeAsAuthority(): Promise<boolean> {
    if (this.disposed || this.ended) return false;
    if (!this.isAuthorityElect()) return false;
    if (this.authorityMemberId !== null && this.authorityMemberId !== this.selfMemberId) {
      // Another member already claimed authority (reconciliation decides).
      return false;
    }
    this.authorityMemberId = this.selfMemberId;
    this.authorityStateRevision = this.revision;
    if (this.simulation) {
      // A1: simulation mode has no canonical state. The initial authority
      // announces and starts heartbeats (the S3 election machinery runs
      // unchanged); the simulation engine produces its own snapshots.
      this.announce();
      this.startHeartbeats();
      return true;
    }
    if (this.canonical !== null) {
      this.announce();
      this.startHeartbeats();
      return true;
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
    this.startHeartbeats();
    return true;
  }

  /** Re-announce after this session's transport reconnected (authority). */
  announce(): void {
    if (this.disposed || this.ended) return;
    if (!this.isAuthorityElect()) return;
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

  // ------------------------------------------------------------------
  // Inbound protocol traffic (session-driven)
  // ------------------------------------------------------------------

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
      return; // only the current authority applies actions
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
      return; // already queued
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
   * A `state.snapshot` arrived: replicate the canonical state (S3: term
   * gated, same-revision conflicts reconciled deterministically, and a
   * deposed/split authority's stale-term state is never adopted).
   */
  handleSnapshot(message: {
    revision: number;
    stateHash: string | null;
    term: number;
    authorityMemberId: string;
    processedActionIds: readonly string[];
    state: unknown;
    /** The transport sender (for targeted convergence re-sends). */
    senderMemberId?: string;
  }): void {
    if (this.disposed) return;
    if (message.term < this.term) return; // a stale term can never win
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
      return; // stale delivery
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
          this.host.sendSnapshot(this.snapshotEnvelope(), message.senderMemberId);
        }
        return;
      }
    }
    this.canonical = message.state;
    this.revision = message.revision;
    this.stateHash = message.stateHash;
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
    if (this.authorityMemberId === this.selfMemberId && this.restoreDone) {
      // The authority adopted a peer's higher state (a restore push that
      // arrived after the window): replicate and re-announce so every shell
      // converges on the adopted state.
      this.host.sendSnapshot(this.snapshotEnvelope());
      this.announce();
    }
  }

  /**
   * An `authority.announce` arrived (S3: term-gated with deterministic
   * reconciliation of conflicting same-term claims).
   */
  handleAnnounce(message: {
    term: number;
    authorityMemberId: string;
    stateRevision: number;
    stateHash?: string;
    eligibleMemberIds?: readonly string[];
  }): void {
    if (this.disposed) return;
    if (
      message.authorityMemberId !== this.selfMemberId &&
      !this.host.isConnected(message.authorityMemberId)
    ) {
      return; // stale announcement from a member that is no longer connected
    }
    if (message.term < this.term) return; // stale term
    this.recordObservation(
      message.authorityMemberId,
      message.stateRevision,
      message.stateHash ?? null,
    );
    if (message.term > this.term) {
      this.adoptTerm(message.term, message.authorityMemberId);
      this.authorityStateRevision = Math.max(this.authorityStateRevision, message.stateRevision);
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
   * An `authority.heartbeat` arrived (S3): refreshes liveness of the current
   * term's authority; a strictly higher term adopts the new authority.
   */
  handleHeartbeat(message: {
    term: number;
    authorityMemberId: string;
    stateRevision: number;
    heartbeatSeq: number;
  }): void {
    if (this.disposed) return;
    if (message.term < this.term) return; // stale term
    if (
      message.authorityMemberId !== this.selfMemberId &&
      !this.host.isConnected(message.authorityMemberId)
    ) {
      return;
    }
    if (message.term > this.term) {
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
  }

  /**
   * An `authority.election` arrived (S3): a strictly higher term makes every
   * connected member (including a sitting authority) join the campaign; the
   * deterministic winner is the lowest connected eligible member id.
   */
  handleElection(message: {
    term: number;
    candidateMemberId: string;
    observed: readonly { memberId: string; revision: number; stateHash?: string }[];
  }): void {
    if (this.disposed) return;
    if (message.term < this.term) return; // stale term
    if (
      message.candidateMemberId !== this.selfMemberId &&
      !this.host.isConnected(message.candidateMemberId)
    ) {
      return; // stale campaign from a member that is no longer connected
    }
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
  // S3 election machinery
  // ------------------------------------------------------------------

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
    this.restoreBackup =
      this.canonical === null
        ? null
        : { canonical: this.canonical, revision: this.revision, stateHash: this.stateHash };
    this.host.emit({
      type: "authorityChanged",
      authorityMemberId: this.selfMemberId,
      term: this.term,
    });
    this.announce();
    this.startHeartbeats();
    if (this.restoreBackup === null) {
      if (this.simulation) {
        // A1: simulation mode has no canonical state to restore; the
        // simulation engine restores the replicated simulation snapshot on
        // its own authority-change notification (same restore window).
        this.restoreDone = true;
        return;
      }
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
    this.restoreDone = true;
    if (this.stateHash !== null && this.canonical !== null && this.restoreBackup !== null) {
      const actual = await stateHashOf(this.canonical);
      if (this.disposed) return;
      if (actual !== this.stateHash) {
        const backup = this.restoreBackup;
        this.canonical = backup.canonical;
        this.revision = backup.revision;
        this.stateHash = backup.stateHash;
        this.host.emit({
          type: "stateError",
          code: "invalid_snapshot",
          message:
            "The restored replicated state failed its hash check; the previous replicated state was kept.",
        });
      }
    }
    this.restoreBackup = null;
    this.announce();
    if (this.canonical !== null) {
      this.host.sendSnapshot(this.snapshotEnvelope());
    }
    void this.processQueue();
  }

  /** Adopt `authorityMemberId` as the authority for `term` (monotonic). */
  private adoptTerm(term: number, authorityMemberId: string): void {
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
    if (this.election !== null) return; // already campaigning
    if (this.authorityMemberId === this.selfMemberId) return;
    this.startElection();
  }

  /**
   * Wait for an elected winner's announcement; re-elect when it never
   * materializes (the winner may have missed the campaigns while it was
   * reconnecting, or a partition hid it — ADR-0007: no stalled party).
   */
  private armWinnerWaitTimer(): void {
    this.clearWinnerWaitTimer();
    if (this.disposed || !this.started || this.ended) return;
    this.winnerWaitTimer = setTimeout(() => {
      this.winnerWaitTimer = null;
      if (this.disposed || !this.started || this.ended) return;
      if (!this.host.selfConnected()) return;
      if (this.election !== null) return; // a new campaign is underway
      if (this.authorityMemberId === null) {
        this.startElection(); // the winner never announced: elect again
      }
    }, this.gracePeriodMs);
  }

  private startHeartbeats(): void {
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

  /**
   * Push our replicated state to `authorityMemberId` when it is strictly
   * higher (or conflicts at the same revision): the elected authority
   * restores the highest valid replicated state (ADR-0007).
   */
  private maybePushTo(
    authorityMemberId: string,
    authorityRevision: number,
    authorityHash: string | null,
  ): void {
    if (this.disposed || !this.started || this.ended) return;
    if (authorityMemberId === this.selfMemberId) return; // we are the authority
    if (this.canonical === null) return;
    if (this.revision > authorityRevision) {
      this.host.sendSnapshot(this.snapshotEnvelope(), authorityMemberId);
      return;
    }
    if (
      this.revision === authorityRevision &&
      authorityHash !== null &&
      this.stateHash !== null &&
      this.stateHash !== authorityHash
    ) {
      this.host.sendSnapshot(this.snapshotEnvelope(), authorityMemberId);
    }
  }

  /** The state envelope for this shell's current replicated state. */
  private snapshotEnvelope(): StateSnapshotEnvelope {
    return {
      revision: this.revision,
      stateHash: this.stateHash,
      term: this.term,
      authorityMemberId: this.authorityMemberId ?? this.selfMemberId,
      processedActionIds: this.processedActionIds(),
      state: this.canonical,
    };
  }

  private lowestEligibleMemberId(): string | null {
    const ids = this.host.eligibleMemberIds();
    if (ids.length === 0) return null;
    return ids.reduce((lowest, id) => (id < lowest ? id : lowest));
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
  private recordObservation(memberId: string, revision: number, stateHash: string | null): void {
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
   * Deterministic same-revision conflict resolution (ADR-0007): the
   * majority-matching hash wins; a tie falls to the hash reported by the
   * lowest member id. Returns the winning hash, or our own hash when there
   * are no observations (stable default: keep the current state).
   */
  private resolveRevisionConflict(revision: number): string | null {
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

  // ------------------------------------------------------------------
  // Sequential application
  // ------------------------------------------------------------------

  /**
   * Kick the sequential executor loop (one run drains the whole queue).
   * Gated on restore: actions received before the elected authority
   * restored its state are buffered and applied afterwards.
   */
  private processQueue(): void {
    if (!this.restoreDone) return;
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
    if (!(await this.commit(result.state, result.views, item.actionId))) {
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

  /**
   * Commit a new canonical state: revision, hash, snapshot, views. The
   * committed action (when given) is recorded in the history BEFORE the
   * snapshot is published, so the replicated `processedActionIds` are
   * complete and a re-sent action is deduplicated after migration (ADR-0007:
   * no action commits twice).
   */
  private async commit(
    state: unknown,
    views: Record<string, unknown>,
    actionId?: string,
  ): Promise<boolean> {
    if (this.disposed) return false;
    if (this.authorityMemberId !== this.selfMemberId || !this.restoreDone) return false;
    // Hash BEFORE mutating revision/canonical: a catch-up snapshot read
    // mid-commit must never observe the new revision with the old hash
    // (ADR-0007: state envelopes carry consistent revision + hash).
    const stateHash = await stateHashOf(state);
    if (this.disposed) return false;
    if (this.authorityMemberId !== this.selfMemberId || !this.restoreDone) return false;
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
    this.stats.applied += 1;
    this.noteProcessed();
    this.authorityStateRevision = this.revision;
    this.host.sendSnapshot(this.snapshotEnvelope());
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

  private clearTimers(): void {
    this.clearGraceTimer();
    this.clearHeartbeatTimer();
    this.clearRestoreTimer();
    this.clearElectionTimer();
    this.clearWinnerWaitTimer();
  }
}

function serializedBytesSync(value: unknown): number {
  const json = JSON.stringify(value);
  return new TextEncoder().encode(json).length;
}
