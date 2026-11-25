import type { NovaConnectionStatus } from "@rocketcrab/nova-api";

export type ArenaPlayerRunState =
  | "pending" // added; the UI hasn't mounted its frame container yet
  | "loading" // runtime iframe bootstrapping
  | "running" // runtime ready; waiting for the game to register
  | "registered" // game registered; the session joined the transport
  | "started" // game.start was delivered to this player
  | "failed"; // fatal runtime error or startup failure

export interface ArenaLogEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly level: "log" | "warn" | "error" | "info";
  readonly message: string;
  readonly details?: string;
}

export interface ArenaRegistration {
  readonly title: string;
}

export interface ArenaPlayer {
  /** Arena-local id, stable for the whole arena session ("player-1"). */
  readonly id: string;
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
  readonly lastError: string | null;
  readonly loadError: string | null;
}

export interface ArenaSummary {
  readonly total: number;
  readonly registered: number;
  readonly started: number;
  readonly failed: number;
  /** True when every player registered, started, and no player failed. */
  readonly success: boolean;
}

export interface ArenaStateDiagnostics {
  readonly revision: number;
  readonly stateHash: string | null;
  readonly stateSizeBytes: number;
  readonly appliedCount: number;
  readonly rejectedCount: number;
  readonly actionRatePerSecond: number;
}

/** Snapshot of the whole arena, re-emitted after every change. */
export interface ArenaState {
  readonly status: "starting" | "running" | "stopped" | "failed";
  readonly players: ArenaPlayer[];
  /** Player whose connected session holds authority. */
  readonly authorityPlayerId: string | null;
  /** Shared artificial one-way latency in ms (0 = none). */
  readonly latencyMs: number;
  /** Epoch ms when the arena started the game, or null before start. */
  readonly startedAt: number | null;
  /** Last committed state diagnostics, or null before the first commit. */
  readonly stateDiagnostics: ArenaStateDiagnostics | null;
  readonly summary: ArenaSummary;
  /** The session id labeling every message of this run. */
  readonly sessionId: string;
  /** Increments on every restart/replace; identifies one run. */
  readonly runId: number;
}

export interface ArenaRunOutcome {
  readonly runId: number;
  readonly source: string;
}
