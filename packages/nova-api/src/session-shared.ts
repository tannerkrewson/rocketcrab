import type { NovaTransport, TransportConnectionState } from "@rocketcrab/core";
import { actionTimeoutMs, type PeerMessage } from "@rocketcrab/protocol";
import type { PeerMessageBase } from "./messages";
import type { NovaStateExecutor } from "./state-executor";
import type { NovaConnectionStatus, NovaPlayer } from "./types";

/** Options for {@link NovaSession}. */
export interface NovaSessionOptions {
  /** The transport-neutral connection this session drives. */
  readonly transport: NovaTransport;

  readonly room: string;
  /** Party session id that labels every message this session sends. */
  readonly sessionId: string;
  /** This player's identity. */
  readonly player: { readonly memberId: string; readonly displayName?: string };
  /** The game being played (from the host bootstrap). */
  readonly game: {
    readonly gameId: string;
    readonly title?: string;
    readonly version?: string;
  };
  /**
   * The state executor. The arena injects a frame executor that
   * runs the game's handlers inside the authority's runtime frame; when
   * omitted, handlers registered through `nova.defineGame` run in-process
   * (contract suite / tests) with the real immer package.
   */
  readonly stateExecutor?: NovaStateExecutor;
  /**
   * Decides whether a `game.start` request from another member starts the
   * game. The elected authority asks it for each request; a request it
   * rejects is ignored and reported as a session error. Omitted means every
   * admitted member's request is accepted (the arena and tests). The party
   * engine accepts only the host, once every member has the game source.
   */
  readonly acceptStartRequest?: (memberId: string) => boolean;
  /**
   * The party host: it may end the game even when another member owns
   * state, and games see it as `leaderId`. Call `refreshLeader()` when the
   * answer changes for reasons other than a player joining or leaving.
   */
  readonly isHost?: (memberId: string) => boolean;
  /**
   * Authority election timings. Defaults follow the protocol
   * limits; tests inject small deterministic values with fake timers.
   */
  readonly authority?: {
    /** Authority heartbeat interval. */
    readonly heartbeatIntervalMs?: number;
    /** Missing-heartbeat grace period before suspicion. */
    readonly gracePeriodMs?: number;
    /** How long an election collects candidates before finalizing. */
    readonly electionWindowMs?: number;
    /** How long the winner collects state pushes before restoring. */
    readonly restoreWindowMs?: number;
    /** How long a player stays gone before the game's playerLeft runs. */
    readonly playerLeaveGraceMs?: number;
    /** Epoch-ms clock (tests inject a fake). */
    readonly now?: () => number;
  };
}

/** One connected player as tracked by the session (host-side view). */
export interface NovaSessionPlayer extends NovaPlayer {
  readonly connectionId: string;
  readonly ready: boolean;
  readonly joinedAt: number;
  /** Authority eligibility (all players are eligible). */
  readonly authorityEligible: boolean;
}

/** Internal mutable player record (the host-side view is a snapshot). */
export interface PlayerRecord {
  id: string;
  name: string;
  connectionId: string;
  ready: boolean;
  joinedAt: number;
  authorityEligible: boolean;
}

export function mapConnectionState(state: TransportConnectionState): NovaConnectionStatus {
  switch (state) {
    case "idle":
      return "disconnected";
    case "joining":
      return "connecting";
    case "connected":
      return "connected";
    case "suspended":
      return "suspended";
    case "disconnected":
      return "disconnected";
  }
}

export interface OutboxEntry {
  build: (base: PeerMessageBase) => PeerMessage;
  targetMemberId?: string;
  seq?: number;
}

/** One action dispatch held or in flight (election buffering). */
export interface BufferedDispatch {
  readonly actionId: string;
  readonly type: string;
  readonly payload: unknown;
  readonly baseRevision: number;
  /**
   * When this dispatch stops being valid, fixed at first dispatch. Every send
   * carries this same expiry (never a fresh one), so a late copy cannot commit
   * an action the game was already told timed out.
   */
  readonly deadlineMs: number;
}

/** Interval between re-sends of an unacknowledged dispatch (half its lifetime). */
export const dispatchRetryIntervalMs = actionTimeoutMs / 2;

/**
 * Hard cap on dispatches held while no authority is known. The byte budget
 * alone does not bound this (many tiny dispatches fit inside it), and an
 * overflow is refused at once rather than queued.
 */
export const MAX_BUFFERED_DISPATCHES = 256;

export function toNovaPlayer(player: PlayerRecord): NovaPlayer {
  return { id: player.id, name: player.name };
}
