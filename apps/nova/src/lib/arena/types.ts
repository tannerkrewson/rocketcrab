/**
 * U6 test-arena types (apps/nova host side).
 *
 * The arena runs several real runtime frames (U3), each wired to its own
 * NovaSession (S1) over the InMemoryTransport (U5). These types describe the
 * host-side view the arena UI renders: per-player run + connection state,
 * per-player logs, the shared network settings, and the test-result summary.
 */
import type { NovaConnectionStatus } from "@rocketcrab/nova-api";
import type { GameMode } from "@rocketcrab/protocol";

/** Per-player run lifecycle inside one arena run. */
export type ArenaPlayerRunState =
  | "pending" // added; the UI hasn't mounted its frame container yet
  | "loading" // runtime iframe bootstrapping
  | "running" // runtime ready; waiting for the game to register
  | "registered" // game registered; the session joined the transport
  | "started" // game.start was delivered to this player
  | "failed"; // fatal runtime error or startup failure

/** One entry in a player's log panel. */
export interface ArenaLogEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly level: "log" | "warn" | "error" | "info";
  readonly message: string;
  readonly details?: string;
}

/** Registration info the game declared (game.registration). */
export interface ArenaRegistration {
  readonly title: string;
  readonly gameMode: GameMode;
}

/** Host-side view of one simulated player. */
export interface ArenaPlayer {
  /** Arena-local id, stable for the whole arena session ("player-1"). */
  readonly id: string;
  /** Display name the creator can rename. */
  readonly name: string;
  /** Distinct protocol member identity ("member-1"). */
  readonly memberId: string;
  /** Raw transport connection state (disconnect/suspend/rejoin visible). */
  readonly connectionState: "idle" | "joining" | "connected" | "suspended" | "disconnected";
  /** Session-level status the game-facing API reports (nova.connectionStatus). */
  readonly sessionStatus: NovaConnectionStatus;
  readonly runState: ArenaPlayerRunState;
  readonly registered: ArenaRegistration | null;
  readonly runtimeInstanceId: string | null;
  readonly logs: ArenaLogEntry[];
  /** Message of the last fatal runtime error (null when none). */
  readonly lastError: string | null;
  /** Message of a startup/bootstrap failure (null when none). */
  readonly loadError: string | null;
}

/** Test-result summary for the arena toolbar. */
export interface ArenaSummary {
  readonly total: number;
  readonly registered: number;
  readonly started: number;
  readonly failed: number;
  /** True when every player registered, started, and no player failed. */
  readonly success: boolean;
}

/** Snapshot of the whole arena, re-emitted after every change. */
export interface ArenaState {
  /** Arena-wide lifecycle. */
  readonly status: "starting" | "running" | "stopped" | "failed";
  readonly players: ArenaPlayer[];
  /** The player currently treated as the simulated authority (S1 proxy). */
  readonly authorityPlayerId: string | null;
  /** Shared artificial one-way latency in ms (0 = none). */
  readonly latencyMs: number;
  /** Shared message-drop toggle (applies to unreliable sends). */
  readonly dropMessages: boolean;
  /** Epoch ms when the arena started the game, or null before start. */
  readonly startedAt: number | null;
  readonly summary: ArenaSummary;
  /** The session id labeling every message of this run. */
  readonly sessionId: string;
  /** Increments on every restart/replace; identifies one run. */
  readonly runId: number;
}

/** Outcome callback fired when a full run reaches a clean success. */
export interface ArenaRunOutcome {
  readonly runId: number;
  readonly source: string;
}
