/**
 * The A1 simulation-mode engine: Nova's half of a simulation game.
 *
 * Simulation mode (ADR-0006) trades state-mode guarantees for speed: the
 * game owns the simulation rules and runs a local copy on every frame; Nova
 * owns everything else — ordered input delivery, the shared simulation
 * clock (the tick), authority selection (reusing S3's election machinery),
 * periodic authoritative snapshots, snapshot replication, restore after
 * authority migration, input/snapshot rate bounds, and latency/drift
 * reporting. Rollback netcode and deterministic third-party physics are
 * explicitly NOT provided (initial limitations; the game corrects drift from
 * authoritative snapshots).
 *
 * The engine lives inside the host-side {@link NovaSession} and never talks
 * to the transport directly: the session provides a
 * {@link SimulationEngineHost} for sending snapshots and emitting events,
 * and a {@link NovaSimulationExecutor} that asks the authority's game to
 * serialize its simulation state (the game's `serializeState` callback).
 *
 * ## Flow
 *
 * - Every session runs a **local clock** at `tickMs`; each tick is emitted
 *   as a `tick` event and the game advances one fixed time step. Inputs are
 *   delivered as they arrive (per-sender Nova-assigned order); the game
 *   applies them during its next step (local prediction).
 * - The **authority** additionally runs a snapshot cadence at
 *   `snapshotIntervalMs`: it asks the frame for the serialized state,
 *   verifies the size bound, hashes it, and broadcasts
 *   `simulation.snapshot` (tick, term, authority, hash, state). Every
 *   session retains the latest snapshot for migration.
 * - **Authority migration** (S3): when the state engine reports a new
 *   authority, followers push their retained snapshot to it; the new
 *   authority collects pushes for `restoreWindowMs`, adopts the highest
 *   valid snapshot (hash-checked), re-broadcasts it as a correction, and
 *   resumes the cadence. Every frame (including the new authority's) sees
 *   the correction through `onSnapshot` and restores.
 * - **Latency and drift**: input latency is measured from the message
 *   envelope's `sentAt`; drift is the local clock vs. the authority's
 *   snapshot clock (snapshot tick + transit time). High latency and drift
 *   are reported through {@link NovaSimulationDiagnostics}, and the local
 *   clock resyncs to the authority when drift exceeds a tick or two.
 *
 * All timings are configurable (bounded by the protocol limits) so tests
 * use fake timers and deterministic runs.
 */
import {
  simulationHighLatencyMs,
  simulationInputRatePerSecond,
  simulationSnapshotBytes,
  simulationSnapshotIntervalMs,
  simulationSnapshotMaxIntervalMs,
  simulationSnapshotMinIntervalMs,
  simulationTickMaxMs,
  simulationTickMinMs,
  simulationTickMs,
} from "@rocketcrab/protocol";
import { stateHashOf } from "./state-engine";
import type { NovaPlayer, NovaSimulationDiagnostics } from "./types";

/** Length of the input-rate and latency sliding windows. */
const RATE_WINDOW_MS = 10_000;

/** One authoritative simulation snapshot as the engine replicates it. */
export interface SimulationSnapshotEnvelope {
  readonly tick: number;
  readonly state: unknown;
  readonly stateHash: string | null;
  readonly term: number;
  readonly authorityMemberId: string;
}

/** One retained snapshot (the replicated copy used for migration). */
export interface RetainedSimulationSnapshot {
  readonly tick: number;
  readonly state: unknown;
  readonly stateHash: string | null;
}

/** The transport-facing half the session implements for the engine. */
export interface SimulationEngineHost {
  /** Every connected player, self first, then peers in join order. */
  players(): readonly NovaPlayer[];
  /** Broadcast a simulation snapshot, or target one member. */
  sendSnapshot(snapshot: SimulationSnapshotEnvelope, targetMemberId?: string): void;
  /** Emit a host-side engine event. */
  emit(event: SimulationEngineEvent): void;
}

/** Host-side engine events (the session maps them to session events). */
export type SimulationEngineEvent =
  | { type: "tick"; tick: number }
  | { type: "error"; code: string; message: string };

/**
 * The serialized-state executor seam (A1): the single place the simulation
 * engine asks the authority's game to serialize its simulation state. The
 * in-process {@link LocalSimulationExecutor} calls the `serializeState`
 * handler the game registered through `nova.simulation.register`; the arena
 * injects a frame executor that forwards the request into the authority's
 * game frame over the runtime bridge. Results are plain data only.
 */
export interface NovaSimulationExecutor {
  /** Ask the game (authority frame) for its current serialized state. */
  serializeState(): Promise<
    | { readonly ok: true; readonly state: unknown }
    | { readonly ok: false; readonly code: string; readonly message: string }
  >;
}

/** Wrap a throwing handler call into a rejected result with a stable code. */
function simulationFailure(
  code: string,
  error: unknown,
): { ok: false; code: string; message: string } {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  return { ok: false, code, message: message.slice(0, 256) };
}

/**
 * The in-process simulation executor: calls the handlers the game
 * registered through `nova.simulation.register` directly (the contract
 * suite and any host that keeps handlers in-process).
 */
export class LocalSimulationExecutor implements NovaSimulationExecutor {
  constructor(
    private readonly handlers: {
      readonly serializeState?: () => unknown;
    } | null,
  ) {}

  async serializeState(): Promise<
    | { readonly ok: true; readonly state: unknown }
    | { readonly ok: false; readonly code: string; readonly message: string }
  > {
    try {
      const handler = this.handlers?.serializeState;
      if (typeof handler !== "function") {
        return {
          ok: false,
          code: "no_snapshot_handler",
          message:
            "The game did not register a serializeState handler; Nova cannot produce authoritative snapshots without it.",
        };
      }
      const state = await handler();
      return { ok: true, state };
    } catch (error) {
      return simulationFailure("snapshot_error", error);
    }
  }
}

/** Options for {@link NovaSimulationEngine}. */
export interface NovaSimulationEngineOptions {
  readonly host: SimulationEngineHost;
  readonly executor: NovaSimulationExecutor;
  readonly selfMemberId: string;
  /** Simulation time step in ms (bounded by the protocol limits). */
  tickMs?: number;
  /** Snapshot cadence in ms (bounded by the protocol limits). */
  snapshotIntervalMs?: number;
  /** How long a newly elected authority collects snapshot pushes. */
  restoreWindowMs?: number;
  /** Epoch-ms clock (tests inject a fake; default Date.now). */
  now?: () => number;
}

/** Clamp a configured value into [min, max] (Nova limits are authoritative). */
function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** One latency sample (send → local receive of an input). */
interface LatencySample {
  readonly at: number;
  readonly latency: number;
}

/**
 * The simulation engine. One instance per session; the session drives it
 * from lifecycle events (start/end), inbound `simulation.input` and
 * `simulation.snapshot` messages, and the S3 authority-change events.
 */
export class NovaSimulationEngine {
  private readonly host: SimulationEngineHost;
  private executor: NovaSimulationExecutor;
  private readonly selfMemberId: string;
  private readonly tickMs: number;
  private readonly snapshotIntervalMs: number;
  private readonly restoreWindowMs: number;
  private readonly now: () => number;

  private tick = 0;
  private term = 1;
  private authorityMemberId: string | null = null;
  private isAuthority = false;
  /** True once this session finished restoring as the current authority. */
  private restored = true;
  private started = false;
  private ended = false;
  private disposed = false;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private restoreBackup: RetainedSimulationSnapshot | null = null;

  /** The latest replicated snapshot (migration copy; highest tick wins). */
  private latest: RetainedSimulationSnapshot | null = null;
  private latestReceivedAt: number | null = null;
  private snapshotsReceived = 0;
  private lastSnapshotAt: number | null = null;
  private snapshotSizeBytes: number | null = null;

  private inputsSent = 0;
  private inputsReceived = 0;
  private rateLimitRejections = 0;
  private readonly sendTimestamps: number[] = [];
  private readonly receivedTimestamps: number[] = [];
  private readonly latencySamples: LatencySample[] = [];
  private driftTicks = 0;

  constructor(options: NovaSimulationEngineOptions) {
    this.host = options.host;
    this.executor = options.executor;
    this.selfMemberId = options.selfMemberId;
    this.tickMs = clamp(options.tickMs, simulationTickMs, simulationTickMinMs, simulationTickMaxMs);
    this.snapshotIntervalMs = clamp(
      options.snapshotIntervalMs,
      simulationSnapshotIntervalMs,
      simulationSnapshotMinIntervalMs,
      simulationSnapshotMaxIntervalMs,
    );
    this.restoreWindowMs = options.restoreWindowMs ?? 150;
    this.now = options.now ?? (() => Date.now());
  }

  /** Swap the executor (the session wires game handlers registered later). */
  setExecutor(executor: NovaSimulationExecutor): void {
    this.executor = executor;
  }

  // ------------------------------------------------------------------
  // Lifecycle (session-driven)
  // ------------------------------------------------------------------

  /** Start the local simulation clock (at game start, on every session). */
  begin(): void {
    if (this.started || this.ended || this.disposed) return;
    this.started = true;
    this.tickTimer = setInterval(() => {
      if (this.ended || this.disposed) return;
      this.tick += 1;
      this.host.emit({ type: "tick", tick: this.tick });
    }, this.tickMs);
  }

  /** Stop the clock and the snapshot cadence (game end). */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.clearTimers();
  }

  /** Tear down timers/state (session dispose). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimers();
    this.latest = null;
    this.latestReceivedAt = null;
    this.restoreBackup = null;
    this.sendTimestamps.length = 0;
    this.receivedTimestamps.length = 0;
    this.latencySamples.length = 0;
  }

  /**
   * The authority changed (S3): the session reports the state engine's
   * authority decisions. Becoming the authority starts the restore window
   * (collecting peer snapshot pushes) and then the snapshot cadence;
   * becoming a follower pushes the retained snapshot to the new authority
   * (restore after migration) and stops the cadence.
   */
  onAuthorityChanged(authorityMemberId: string | null, term: number): void {
    if (this.disposed || this.ended) return;
    if (term < this.term) return; // stale term can never win
    const changed = authorityMemberId !== this.authorityMemberId || term !== this.term;
    this.term = Math.max(this.term, term);
    this.authorityMemberId = authorityMemberId;
    this.isAuthority = authorityMemberId === this.selfMemberId;
    if (!this.isAuthority) {
      this.stopCadence();
      this.stopRestoreTimer();
      this.restored = true;
      if (changed && this.latest !== null) {
        // A follower pushes its replicated snapshot to the elected winner
        // (the winner restores the highest valid snapshot).
        this.host.sendSnapshot(this.envelope(), authorityMemberId ?? undefined);
      }
      return;
    }
    if (!changed) return; // re-announcement of the same authority
    if (this.latest === null) {
      // Fresh authority (the initial authority): nothing to restore;
      // produce snapshots from the frame's state right away.
      this.restored = true;
      this.startCadence();
      return;
    }
    // An elected authority with a replicated snapshot: collect peer pushes
    // for the restore window, then adopt the highest valid snapshot and
    // re-broadcast it (correction) before producing new ones.
    this.restored = false;
    this.restoreBackup = this.latest;
    this.stopRestoreTimer();
    this.restoreTimer = setTimeout(() => {
      this.restoreTimer = null;
      void this.finishRestore();
    }, this.restoreWindowMs);
  }

  // ------------------------------------------------------------------
  // Inbound traffic (session-driven)
  // ------------------------------------------------------------------

  /**
   * One `simulation.input` arrived: record latency (envelope `sentAt`) and
   * the receive rate for diagnostics. Inputs themselves are delivered to
   * the game by the session immediately (per-sender ordered).
   */
  handleInputReceived(sentAt: number): void {
    if (this.disposed) return;
    this.inputsReceived += 1;
    const now = this.now();
    this.receivedTimestamps.push(now);
    this.prune(this.receivedTimestamps, now);
    if (sentAt > 0) {
      this.latencySamples.push({ at: now, latency: Math.max(0, now - sentAt) });
      this.pruneLatency(now);
    }
  }

  /**
   * One authoritative `simulation.snapshot` arrived: retain the replicated
   * copy (highest tick wins; stale terms are dropped), resync the local
   * clock to the authority's clock, and return the snapshot so the session
   * can deliver it to the game frame (correction / late join / restore).
   * Returns null when the snapshot was dropped (stale term).
   */
  handleSnapshot(message: {
    tick: number;
    term: number;
    authorityMemberId: string;
    stateHash: string | null;
    state: unknown;
    /** Envelope send timestamp (drift measurement). */
    sentAt?: number;
  }): RetainedSimulationSnapshot | null {
    if (this.disposed) return null;
    if (message.term < this.term) return null; // a stale term can never win
    if (message.term > this.term || this.authorityMemberId === null) {
      this.term = message.term;
      this.authorityMemberId = message.authorityMemberId;
      this.isAuthority = message.authorityMemberId === this.selfMemberId;
    }
    const retained: RetainedSimulationSnapshot = {
      tick: message.tick,
      state: message.state,
      stateHash: message.stateHash,
    };
    if (this.latest === null || message.tick >= this.latest.tick) {
      this.latest = retained;
    }
    const receivedAt = this.now();
    this.latestReceivedAt = receivedAt;
    this.snapshotsReceived += 1;
    this.lastSnapshotAt = receivedAt;
    this.snapshotSizeBytes = serializedBytesSync(message.state);
    // Drift: how far the local clock is from the authority's clock at the
    // moment this snapshot arrived (transit time estimated from sentAt).
    if (message.sentAt !== undefined && message.sentAt > 0 && this.started) {
      const authorityTickNow = message.tick + (receivedAt - message.sentAt) / this.tickMs;
      const drift = this.tick - authorityTickNow;
      if (Math.abs(drift) >= 2) {
        // Resync the local clock to the authority (the game restores from
        // the snapshot and continues from the authoritative clock).
        this.tick = Math.max(0, Math.round(authorityTickNow));
        this.driftTicks = 0; // the clock was realigned
      } else {
        this.driftTicks = Math.round(drift);
      }
    }
    return retained;
  }

  // ------------------------------------------------------------------
  // Input send accounting (session-driven; the session rejects over-limit)
  // ------------------------------------------------------------------

  /**
   * Record one outbound input against the per-second rate bound. Returns
   * false (and counts a rejection) when the bound is exceeded, so the
   * session can reject the send with a clear error.
   */
  recordInputSent(): boolean {
    if (this.disposed) return false;
    const now = this.now();
    this.prune(this.sendTimestamps, now);
    const capacity = Math.floor((simulationInputRatePerSecond * RATE_WINDOW_MS) / 1000);
    if (this.sendTimestamps.length >= capacity) {
      this.rateLimitRejections += 1;
      return false;
    }
    this.sendTimestamps.push(now);
    this.inputsSent += 1;
    return true;
  }

  // ------------------------------------------------------------------
  // Read accessors (session + host)
  // ------------------------------------------------------------------

  /** The current local simulation tick (interpolation hook). */
  getTick(): number {
    return this.tick;
  }

  /** The latest replicated snapshot, or null before the first. */
  getLatestSnapshot(): RetainedSimulationSnapshot | null {
    return this.latest;
  }

  /** The current authority's member id (host-side; never game-facing). */
  getAuthorityMemberId(): string | null {
    return this.authorityMemberId;
  }

  /** True while this session is the authority for the current term. */
  isAuthorityElect(): boolean {
    return this.isAuthority;
  }

  /** Host-side diagnostics (A1 acceptance: latency and drift are visible). */
  getDiagnostics(): NovaSimulationDiagnostics {
    const now = this.now();
    const avgLatency = this.averageLatency(now);
    return {
      tick: this.tick,
      tickMs: this.tickMs,
      snapshotIntervalMs: this.snapshotIntervalMs,
      authorityTick: this.latest?.tick ?? null,
      authorityMemberId: this.authorityMemberId,
      term: this.term,
      lastSnapshotAt: this.lastSnapshotAt,
      snapshotAgeMs:
        this.latestReceivedAt === null ? null : Math.max(0, now - this.latestReceivedAt),
      inputsSent: this.inputsSent,
      inputsReceived: this.inputsReceived,
      rateLimitRejections: this.rateLimitRejections,
      inputRatePerSecond: this.receivedRate(now),
      inputLatencyMs: avgLatency,
      highLatency: avgLatency !== null && avgLatency > simulationHighLatencyMs,
      driftTicks: this.driftTicks,
      snapshotsReceived: this.snapshotsReceived,
      snapshotSizeBytes: this.snapshotSizeBytes,
    };
  }

  // ------------------------------------------------------------------
  // Snapshot production (authority side)
  // ------------------------------------------------------------------

  /** Start the periodic snapshot cadence (authority only). */
  private startCadence(): void {
    this.stopCadence();
    if (this.disposed || this.ended || !this.isAuthority || !this.restored) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      if (this.disposed || this.ended || !this.isAuthority || !this.restored) return;
      void this.produceSnapshot();
      this.startCadence();
    }, this.snapshotIntervalMs);
  }

  private stopCadence(): void {
    if (this.snapshotTimer !== null) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  /**
   * Ask the authority's game for its serialized state, verify the size
   * bound, hash it, retain it, and broadcast it. Failures surface as engine
   * errors (games see `nova.onError`) and the cadence continues.
   */
  private async produceSnapshot(): Promise<void> {
    if (this.disposed || this.ended || !this.isAuthority || !this.restored) return;
    let result: Awaited<ReturnType<NovaSimulationExecutor["serializeState"]>>;
    try {
      result = await this.executor.serializeState();
    } catch (error) {
      // An executor must never take the engine down (frame crashes, game
      // handler throws): surface a stable error and keep the cadence going.
      this.host.emit({
        type: "error",
        code: "snapshot_error",
        message: error instanceof Error ? error.message.slice(0, 256) : String(error),
      });
      return;
    }
    if (this.disposed || this.ended || !this.isAuthority || !this.restored) return;
    if (!result.ok) {
      this.host.emit({ type: "error", code: result.code, message: result.message });
      return;
    }
    const size = serializedBytesSync(result.state);
    if (size > simulationSnapshotBytes) {
      this.host.emit({
        type: "error",
        code: "state_too_large",
        message: `The simulation snapshot is ${size} bytes; the hard limit is ${simulationSnapshotBytes} bytes.`,
      });
      return;
    }
    const stateHash = await stateHashOf(result.state);
    if (this.disposed || this.ended || !this.isAuthority || !this.restored) return;
    const snapshot: RetainedSimulationSnapshot = {
      tick: this.tick,
      state: result.state,
      stateHash,
    };
    this.latest = snapshot;
    const now = this.now();
    this.latestReceivedAt = now;
    this.lastSnapshotAt = now;
    this.snapshotSizeBytes = size;
    this.host.sendSnapshot(this.envelope());
  }

  /**
   * Restore completed: verify the adopted snapshot's hash (reverting to the
   * previous valid snapshot on mismatch), re-broadcast it as a correction
   * (every frame — including the new authority's own frame — restores from
   * it), and resume the cadence.
   */
  private async finishRestore(): Promise<void> {
    if (this.disposed || this.ended) return;
    if (!this.isAuthority) return; // deposed mid-restore
    this.restored = true;
    const candidate = this.latest;
    if (candidate !== null && candidate.stateHash !== null) {
      const actual = await stateHashOf(candidate.state);
      if (this.disposed) return;
      if (actual !== candidate.stateHash) {
        if (this.restoreBackup !== null) {
          this.latest = this.restoreBackup;
        }
        this.host.emit({
          type: "error",
          code: "invalid_snapshot",
          message:
            "The restored simulation snapshot failed its hash check; the previous replicated snapshot was kept.",
        });
      }
    }
    this.restoreBackup = null;
    if (this.latest !== null) {
      this.host.sendSnapshot(this.envelope());
    }
    this.startCadence();
  }

  /** The snapshot envelope for this shell's current replicated state. */
  private envelope(): SimulationSnapshotEnvelope {
    return {
      tick: this.latest?.tick ?? this.tick,
      state: this.latest?.state,
      stateHash: this.latest?.stateHash ?? null,
      term: this.term,
      authorityMemberId: this.authorityMemberId ?? this.selfMemberId,
    };
  }

  // ------------------------------------------------------------------
  // Rate/latency helpers
  // ------------------------------------------------------------------

  private receivedRate(now: number): number {
    this.prune(this.receivedTimestamps, now);
    return this.receivedTimestamps.length / (RATE_WINDOW_MS / 1000);
  }

  private averageLatency(now: number): number | null {
    this.pruneLatency(now);
    if (this.latencySamples.length === 0) return null;
    let total = 0;
    for (const sample of this.latencySamples) {
      total += sample.latency;
    }
    return total / this.latencySamples.length;
  }

  private prune(timestamps: number[], now: number): void {
    const cutoff = now - RATE_WINDOW_MS;
    while (timestamps.length > 0 && (timestamps[0] ?? 0) < cutoff) {
      timestamps.shift();
    }
  }

  private pruneLatency(now: number): void {
    const cutoff = now - RATE_WINDOW_MS;
    while (this.latencySamples.length > 0 && (this.latencySamples[0]?.at ?? 0) < cutoff) {
      this.latencySamples.shift();
    }
  }

  private stopRestoreTimer(): void {
    if (this.restoreTimer !== null) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
  }

  private clearTimers(): void {
    this.stopCadence();
    this.stopRestoreTimer();
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }
}

function serializedBytesSync(value: unknown): number {
  const json = JSON.stringify(value);
  return new TextEncoder().encode(json).length;
}
