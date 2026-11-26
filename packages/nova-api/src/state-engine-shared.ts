import { stateHistoryLimit, type StateActionRejection } from "@rocketcrab/protocol";
import type { NovaStateExecutor } from "./state-executor";
import { canonicalJson, type JsonDeltaOp } from "./json-delta";
import type { NovaActionAck, NovaPlayer } from "./types";

/** How many processed action records the engine retains (bounded history). */
export const STATE_HISTORY_LIMIT = stateHistoryLimit;

/** Length of the action-rate sliding window. */
export const RATE_WINDOW_MS = 10_000;

/** How many revisions of state-hash votes the conflict tracker retains. */
export const REVISION_VOTES_LIMIT = 64;

/** One action queued for sequential application (authority side). */
export interface PendingAction {
  readonly actionId: string;
  readonly senderMemberId: string;
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
  readonly baseRevision: number;
  readonly sentAt: number;
  readonly expiresAtMs?: number;
  /** Set for a player joining or leaving: runs the game's membership handler, not an action. */
  readonly membership?: { readonly kind: "joined" | "left"; readonly player: NovaPlayer };
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
  /** `full`: the whole dedup window. `increment`: only IDs added since revision - 1. */
  readonly historyMode: "full" | "increment";
  /** For increments and deltas: the state hash they apply on top of (null for full). */
  readonly baseStateHash: string | null;
  /** `full`: `state` is the whole canonical state. `delta`: `ops` transform the base state. */
  readonly stateMode: "full" | "delta";
  /** For deltas: the operations on the base state. Null for full. */
  readonly ops: readonly JsonDeltaOp[] | null;
  /** The sender's window is complete (a full snapshot with false is merged, not replaced). */
  readonly historyComplete: boolean;
  readonly processedActionIds: readonly string[];
  readonly actionRejections?: readonly StateActionRejection[];
  readonly state: unknown;
  readonly viewIsState: boolean;
  /** The players the game has been told about; null when unknown. */
  readonly roster: readonly NovaPlayer[] | null;
}

/** A request for a full snapshot after a gap in the authority's stream (state.resync). */
export interface StateResyncEnvelope {
  readonly knownRevision: number;
}

/** Text for an error caught in a broadcast, for a diagnostic. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One inbound state snapshot, as the session hands it to the engine. */
export interface InboundSnapshot {
  readonly revision: number;
  readonly stateHash: string | null;
  readonly term: number;
  readonly authorityMemberId: string;
  readonly historyMode: "full" | "increment";
  readonly baseStateHash?: string | null;
  /** Absent from older senders, which always sent complete windows. */
  readonly historyComplete?: boolean;
  /** Absent from older senders, which always sent full states. */
  readonly stateMode?: "full" | "delta";
  readonly ops?: readonly JsonDeltaOp[];
  readonly processedActionIds: readonly string[];
  readonly actionRejections?: readonly StateActionRejection[];
  /** Present on full snapshots; absent on deltas. */
  readonly state?: unknown;
  /** Every frame's view is the canonical state (the game has no selectView). */
  readonly viewIsState?: boolean;
  /** The players the game has been told about. Absent from older senders. */
  readonly roster?: readonly NovaPlayer[];
  /** The transport sender (for targeted convergence re-sends). */
  readonly senderMemberId?: string;
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

/** An authority heartbeat (liveness for the current term). */
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

/** An authority election campaign. */
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
  /** The party leader's member id, or null when not known. */
  leaderId(): string | null;
  /** Each connected player's latest controls (a ticking game's input). */
  controls(): Readonly<Record<string, unknown>>;
  /** Send one action ack to a member (targeted). */
  sendAck(targetMemberId: string, ack: NovaActionAck): void;
  /** Broadcast a state snapshot, or target one member. */
  sendSnapshot(snapshot: StateSnapshotEnvelope, targetMemberId?: string): void;
  /** Send one player's selected view (targeted). */
  sendView(targetMemberId: string, view: StateViewEnvelope): void;
  /** Ask the current authority (targeted) for a full snapshot after a gap. */
  sendResync(targetMemberId: string, request: StateResyncEnvelope): void;
  /** Announce this session as the authority. */
  sendAnnounce(announcement: AuthorityAnnounceEnvelope): void;
  /** Broadcast an authority heartbeat. */
  sendHeartbeat(heartbeat: AuthorityHeartbeatEnvelope): void;
  /** Broadcast an authority election campaign. */
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
      /** True for a tick's commit (hosts skip per-commit logging). */
      tick: boolean;
    }
  | { type: "actionRejected"; actionId: string; code: string; message: string }
  /** This shell's frame should show `state` (a game without selectView). */
  | { type: "viewFromState"; state: unknown }
  | { type: "stateError"; code: string; message: string }
  /** The authority for the current term changed (session flushes buffers). */
  | { type: "authorityChanged"; authorityMemberId: string | null; term: number }
  /** A suspicion started an election (host/arena diagnostics). */
  | { type: "electionStarted"; term: number }
  /** A received delta finished verification (applied or rejected). Host-side: release held traffic. */
  | { type: "deltaSettled" }
  /**
   * A broadcast could not be sent as a delta and fell back to the full state, or
   * could not be sent at all. Host-side diagnostic only.
   */
  | { type: "snapshotFallback"; reason: string }
  /**
   * This node became authority with a gapped window. Host-side diagnostic
   * only: the game is not affected, and the window repairs on the next full
   * broadcast from a complete shell.
   */
  | { type: "historyIncomplete"; authorityMemberId: string; term: number };

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
  /** Authority heartbeat interval (configurable for tests). */
  heartbeatIntervalMs?: number;
  /** Missing-heartbeat grace period before suspicion. */
  gracePeriodMs?: number;
  /** How long an election collects candidates before finalizing. */
  electionWindowMs?: number;
  /** How long the winner collects state pushes before restoring. */
  restoreWindowMs?: number;
  /** How long a player stays gone before the game's playerLeft runs. */
  playerLeaveGraceMs?: number;
  /**
   * SHA-256 state digest (tests inject a deferred implementation to race
   * authority loss against the commit window deterministically). Defaults
   * to {@link stateHashOf}.
   */
  stateHash?: (value: unknown) => Promise<string>;
}

export interface ActionStats {
  applied: number;
  rejected: number;
  timestamps: number[];
}

export interface ElectionState {
  readonly term: number;
  readonly eligibleAtStart: ReadonlySet<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface RestoreBackup {
  readonly canonical: unknown;
  readonly revision: number;
  readonly stateHash: string | null;
  readonly history: ReadonlyMap<string, ProcessedActionRecord>;
  readonly roster: readonly NovaPlayer[] | null;
}

/** Serialize a value and measure its size in bytes (UTF-8). */
export async function serializedBytes(value: unknown): Promise<number> {
  const json = JSON.stringify(value);
  return new TextEncoder().encode(json).length;
}

/** SHA-256 hex digest of a value's JSON serialization. */
export async function stateHashOf(value: unknown): Promise<string> {
  // Canonical encoding: a state rebuilt by patching hashes like the original.
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Deterministic announcement reconciliation: at the same term the
 * announcement with the higher state revision wins; equal revisions fall to
 * the lower member id. Both sides compute the same result, so a partition
 * merge converges on exactly one authority.
 */
export function announcementWins(
  incoming: { readonly memberId: string; readonly revision: number },
  current: { readonly memberId: string; readonly revision: number },
): boolean {
  if (incoming.revision !== current.revision) {
    return incoming.revision > current.revision;
  }
  return incoming.memberId < current.memberId;
}

export function serializedBytesSync(value: unknown): number {
  const json = JSON.stringify(value);
  return new TextEncoder().encode(json).length;
}

/** Code-unit order by id, identical on every device (no locale rules). */
export function compareById(a: NovaPlayer, b: NovaPlayer): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
