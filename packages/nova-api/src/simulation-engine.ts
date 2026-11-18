/**
 * The simulation-mode engine: Nova's half of a simulation game.
 *
 * Simulation mode (ADR-0006) trades state-mode guarantees for speed: the
 * game owns the simulation rules and runs a local copy on every frame; Nova
 * owns everything else — ordered input delivery, the shared simulation
 * clock (the tick), authority selection (reusing the state engine's election machinery),
 * periodic authoritative snapshots, snapshot replication, restore after
 * authority migration, input/snapshot rate bounds, and latency/drift
 * reporting. Rollback netcode and deterministic third-party physics are
 * explicitly NOT provided (the game corrects drift from authoritative snapshots).
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
 *   as a `tick` event and the game advances one fixed time step. The clock
 *   follows elapsed time, not timer callbacks: a late or throttled timer
 *   (a busy main thread, a background tab) emits the missed ticks in one
 *   burst, up to {@link MAX_CATCH_UP_MS}; a longer gap (a suspended tab, a
 *   clock change) is skipped rather than replayed. Every device therefore
 *   runs the game at the same speed. Inputs are delivered as they arrive
 *   (per-sender Nova-assigned order); the game applies them during its next
 *   step (local prediction).
 * - The **authority** takes a snapshot every `snapshotIntervalMs` worth of
 *   ticks, right after the tick it describes: it asks the frame for the
 *   serialized state, checks that it is plain JSON within the size bound,
 *   hashes it, and broadcasts `simulation.snapshot` (tick, term, authority,
 *   hash, state). At most one request is in flight, and a failure is
 *   reported once until a snapshot succeeds again. Every session retains
 *   the latest snapshot for migration.
 * - **Tick and state agree.** Accepting a snapshot sets the local tick to
 *   the snapshot's tick, so after `onSnapshot` the next `onTick` steps the
 *   restored state forward from exactly that tick. Device clocks are never
 *   compared (phones disagree by hundreds of ms); a follower simply runs
 *   about one transit time behind the authority.
 * - **Authority migration**: when the state engine reports a new
 *   authority, followers push their retained snapshot to it; the new
 *   authority collects pushes for `restoreWindowMs`, adopts the highest
 *   valid snapshot (hash-checked), re-broadcasts it as a correction, and
 *   resumes the cadence. Every frame (including the new authority's) sees
 *   the correction through `onSnapshot` and restores.
 * - **Diagnostics**: input latency is measured from the message envelope's
 *   `sentAt` (sender clock, so only indicative); drift is how far the local
 *   tick had run from the authoritative snapshot when it arrived. Both are
 *   reported through {@link NovaSimulationDiagnostics}.
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

/**
 * The most simulated time one clock wake-up replays. Background tabs run
 * timers about once a second, so two seconds keeps a throttled authority at
 * full speed; anything longer (a suspended phone) is skipped, and the next
 * snapshot corrects the state.
 */
export const MAX_CATCH_UP_MS = 2_000;

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
  | { type: "restored"; snapshot: RetainedSimulationSnapshot }
  | { type: "error"; code: string; message: string };

/**
 * The serialized-state executor seam: the single place the simulation
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
  return { ok: false, code, message: errorText(error) };
}

function errorText(error: unknown): string {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  return message.slice(0, 256);
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

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
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
 * `simulation.snapshot` messages, and authority-change events.
 */
export class NovaSimulationEngine {
  private readonly host: SimulationEngineHost;
  private executor: NovaSimulationExecutor;
  private readonly selfMemberId: string;
  private readonly tickMs: number;
  private readonly snapshotIntervalMs: number;
  /** Snapshot cadence in ticks (snapshots are taken right after a tick). */
  private readonly snapshotEveryTicks: number;
  private readonly maxCatchUpTicks: number;
  private readonly restoreWindowMs: number;
  private readonly now: () => number;

  private tick = 0;
  /** The clock's reference point: `tick` was `anchorTick` at `anchorAt`. */
  private anchorTick = 0;
  private anchorAt = 0;
  private term = 1;
  private authorityMemberId: string | null = null;
  private isAuthority = false;
  /** True once this session finished restoring as the current authority. */
  private restored = true;
  private started = false;
  private ended = false;
  private disposed = false;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private restoreCandidate: RetainedSimulationSnapshot | null = null;
  /** The tick of the last snapshot this authority produced or restored. */
  private lastSnapshotTick: number | null = null;
  /** True while a serializeState request is outstanding. */
  private serializing = false;
  /** The snapshot problem already reported (cleared by a clean snapshot). */
  private reportedProblem: string | null = null;

  /** The latest replicated snapshot and the timeline it was delivered from. */
  private latestTimeline: { term: number; authorityMemberId: string } | null = null;
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
    this.snapshotEveryTicks = Math.max(1, Math.round(this.snapshotIntervalMs / this.tickMs));
    this.maxCatchUpTicks = Math.max(1, Math.floor(MAX_CATCH_UP_MS / this.tickMs));
    this.restoreWindowMs = options.restoreWindowMs ?? 150;
    this.now = options.now ?? (() => Date.now());
  }

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
    this.setTick(this.tick);
    this.scheduleTick();
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
    this.restoreCandidate = null;
    this.sendTimestamps.length = 0;
    this.receivedTimestamps.length = 0;
    this.latencySamples.length = 0;
  }

  /**
   * The authority changed: the session reports the state engine's
   * authority decisions. Becoming the authority starts the restore window
   * (collecting peer snapshot pushes) and then the snapshot cadence;
   * becoming a follower pushes the retained snapshot to the new authority
   * (restore after migration) and stops the cadence.
   */
  onAuthorityChanged(authorityMemberId: string | null, term: number): void {
    if (this.disposed || this.ended) return;
    if (term < this.term) return;
    const changed = authorityMemberId !== this.authorityMemberId || term !== this.term;
    this.term = Math.max(this.term, term);
    this.authorityMemberId = authorityMemberId;
    this.isAuthority = authorityMemberId === this.selfMemberId;
    if (!this.isAuthority) {
      this.stopRestoreTimer();
      this.restoreCandidate = null;
      this.restored = true;
      this.lastSnapshotTick = null;
      if (changed && authorityMemberId !== null && this.latest !== null) {
        // A follower pushes its replicated snapshot to the elected winner
        // (the winner restores the highest valid snapshot).
        this.host.sendSnapshot(this.envelope(), authorityMemberId);
      }
      return;
    }
    if (!changed) return;
    if (term === 1 && this.latest === null) {
      // The initial authority can start without a recovery snapshot.
      this.restored = true;
      this.lastSnapshotTick = this.tick;
      return;
    }
    // Collect peer snapshots even if the replacement host missed every update.
    this.restored = false;
    this.restoreCandidate = this.latest;
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
   * One `simulation.input` arrived: record the receive rate and, for a
   * peer's input, the latency from its envelope `sentAt` (diagnostics).
   * Omit `sentAt` for this player's own looped-back input. Inputs
   * themselves are delivered to the game by the session immediately
   * (per-sender ordered).
   */
  handleInputReceived(sentAt?: number): void {
    if (this.disposed) return;
    this.inputsReceived += 1;
    const now = this.now();
    this.receivedTimestamps.push(now);
    this.prune(this.receivedTimestamps, now);
    if (sentAt !== undefined && sentAt > 0) {
      this.latencySamples.push({ at: now, latency: Math.max(0, now - sentAt) });
      this.pruneLatency(now);
    }
  }

  /**
   * One authoritative `simulation.snapshot` arrived: retain the replicated
   * copy (highest tick wins; stale terms are dropped), move the local clock
   * to the snapshot's tick, and return the snapshot so the session can
   * deliver it to the game frame (correction / late join / restore).
   * Restore candidates remain internal until the replacement host validates one.
   */
  handleSnapshot(message: {
    tick: number;
    term: number;
    authorityMemberId: string;
    stateHash: string | null;
    state: unknown;
    senderMemberId?: string;
  }): RetainedSimulationSnapshot | null {
    if (this.disposed || this.ended || message.term < this.term) return null;
    const retained: RetainedSimulationSnapshot = {
      tick: message.tick,
      state: message.state,
      stateHash: message.stateHash,
    };
    if (
      this.isAuthority &&
      !this.restored &&
      message.term === this.term &&
      message.authorityMemberId === this.selfMemberId
    ) {
      if (this.restoreTimer !== null && message.tick > (this.restoreCandidate?.tick ?? -1)) {
        this.restoreCandidate = retained;
      }
      return null;
    }
    if (
      (message.senderMemberId !== undefined &&
        message.senderMemberId !== message.authorityMemberId) ||
      (message.term === this.term &&
        this.authorityMemberId !== null &&
        message.authorityMemberId !== this.authorityMemberId)
    )
      return null;
    if (
      this.latestTimeline?.term === message.term &&
      this.latestTimeline.authorityMemberId === message.authorityMemberId &&
      this.latest !== null &&
      message.tick <= this.latest.tick
    )
      return null;
    if (message.term > this.term || this.authorityMemberId === null) {
      this.term = message.term;
      this.authorityMemberId = message.authorityMemberId;
      this.isAuthority = message.authorityMemberId === this.selfMemberId;
    }
    this.latest = retained;
    this.latestTimeline = { term: message.term, authorityMemberId: message.authorityMemberId };
    const receivedAt = this.now();
    this.latestReceivedAt = receivedAt;
    this.snapshotsReceived += 1;
    this.lastSnapshotAt = receivedAt;
    this.snapshotSizeBytes = serializedBytes(message.state);
    // The game restores this state, so the clock continues from its tick.
    if (this.started) this.driftTicks = this.tick - message.tick;
    this.setTick(message.tick);
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

  getCatchUpSnapshot(): SimulationSnapshotEnvelope | null {
    return this.isAuthority && this.restored && this.latest !== null ? this.envelope() : null;
  }

  /** The current authority's member id (host-side; never game-facing). */
  getAuthorityMemberId(): string | null {
    return this.authorityMemberId;
  }

  /** True while this session is the authority for the current term. */
  isAuthorityElect(): boolean {
    return this.isAuthority;
  }

  /** Host-side latency, drift, and snapshot diagnostics. */
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
  // The clock
  // ------------------------------------------------------------------

  /** Jump the clock to `tick`, measuring the next steps from now. */
  private setTick(tick: number): void {
    this.tick = tick;
    this.anchorTick = tick;
    this.anchorAt = this.now();
  }

  /** Wake at the next tick boundary (self-correcting, never drifts). */
  private scheduleTick(): void {
    if (this.ended || this.disposed || !this.started) return;
    const next = this.anchorAt + (this.tick - this.anchorTick + 1) * this.tickMs;
    this.tickTimer = setTimeout(
      () => {
        this.tickTimer = null;
        this.runClock();
        this.scheduleTick();
      },
      Math.max(0, next - this.now()),
    );
  }

  /** Emit every tick that is due, then take a snapshot if one is due. */
  private runClock(): void {
    if (this.ended || this.disposed) return;
    if (this.isAuthority && !this.restored) {
      // The replacement host holds its clock until it has restored.
      this.setTick(this.tick);
      return;
    }
    const now = this.now();
    let due = this.anchorTick + Math.floor((now - this.anchorAt) / this.tickMs) - this.tick;
    if (now < this.anchorAt) {
      // The system clock moved backwards: measure from here.
      this.setTick(this.tick);
      due = 0;
    } else if (due > this.maxCatchUpTicks) {
      // A suspended tab: replay a bounded burst and skip the rest.
      due = this.maxCatchUpTicks;
      this.anchorTick = this.tick + due;
      this.anchorAt = now;
    }
    for (let step = 0; step < due; step += 1) {
      if (this.ended || this.disposed) return;
      this.tick += 1;
      this.host.emit({ type: "tick", tick: this.tick });
    }
    this.maybeProduceSnapshot();
  }

  // ------------------------------------------------------------------
  // Snapshot production (authority side)
  // ------------------------------------------------------------------

  /** Take a snapshot when this authority's cadence is due (after a tick). */
  private maybeProduceSnapshot(): void {
    if (this.disposed || this.ended || !this.isAuthority || !this.restored) return;
    if (this.serializing) return;
    if (this.lastSnapshotTick === null || this.lastSnapshotTick > this.tick) {
      this.lastSnapshotTick = this.tick;
    }
    if (this.tick - this.lastSnapshotTick < this.snapshotEveryTicks) return;
    this.lastSnapshotTick = this.tick;
    this.serializing = true;
    void this.produceSnapshot().finally(() => {
      this.serializing = false;
    });
  }

  /**
   * Ask the authority's game for its serialized state, check that it is
   * plain JSON within the size bound, hash it, retain it, and broadcast it.
   * Failures surface as engine errors (games see `nova.onError`), once per
   * kind of failure, and the cadence continues.
   */
  private async produceSnapshot(): Promise<void> {
    const { term, tick } = this;
    let result: Awaited<ReturnType<NovaSimulationExecutor["serializeState"]>>;
    try {
      result = await this.executor.serializeState();
    } catch (error) {
      // An executor must never take the engine down (frame crashes, game
      // handler throws): surface a stable error and keep the cadence going.
      result = simulationFailure("snapshot_error", error);
    }
    if (this.disposed || this.ended || !this.isAuthority || !this.restored) return;
    if (!result.ok) {
      this.reportProblem(result.code, result.message);
      return;
    }
    const encoded = encodeSnapshotState(result.state);
    if (!encoded.ok) {
      this.reportProblem("invalid_state", encoded.message);
      return;
    }
    const size = new TextEncoder().encode(encoded.json).length;
    if (size > simulationSnapshotBytes) {
      this.reportProblem(
        "state_too_large",
        `The simulation snapshot is ${size} bytes; the hard limit is ${simulationSnapshotBytes} bytes. Save only the state needed to resume play.`,
      );
      return;
    }
    // Replicate exactly what other players will receive (JSON), never a
    // live reference the game keeps mutating.
    const state: unknown = JSON.parse(encoded.json);
    const stateHash = await stateHashOf(state);
    if (
      this.disposed ||
      this.ended ||
      !this.isAuthority ||
      !this.restored ||
      this.term !== term ||
      (this.latestTimeline?.term === term &&
        this.latestTimeline.authorityMemberId === this.selfMemberId &&
        this.latest !== null &&
        tick <= this.latest.tick)
    )
      return;
    if (encoded.lossy === null) {
      this.reportedProblem = null;
    } else {
      this.reportProblem("invalid_state", encoded.lossy);
    }
    this.latest = { tick, state, stateHash };
    this.latestTimeline = { term, authorityMemberId: this.selfMemberId };
    const now = this.now();
    this.latestReceivedAt = now;
    this.lastSnapshotAt = now;
    this.snapshotSizeBytes = size;
    this.host.sendSnapshot(this.envelope());
  }

  /** Report a snapshot problem once, not at every cadence step. */
  private reportProblem(code: string, message: string): void {
    if (this.reportedProblem === code) return;
    this.reportedProblem = code;
    this.host.emit({ type: "error", code, message });
  }

  /**
   * Restore completed: verify the adopted snapshot's hash (reverting to the
   * previous valid snapshot on mismatch), re-broadcast it as a correction
   * (every frame — including the new authority's own frame — restores from
   * it), and resume the cadence.
   */
  private async finishRestore(): Promise<void> {
    if (this.disposed || this.ended) return;
    if (!this.isAuthority) return;
    const term = this.term;
    const candidate = this.restoreCandidate;
    if (candidate !== null) {
      const hash = candidate.stateHash === null ? null : await stateHashOf(candidate.state);
      if (this.disposed || this.ended || !this.isAuthority || this.term !== term) return;
      if (hash === candidate.stateHash) {
        this.latest = candidate;
      } else {
        this.host.emit({
          type: "error",
          code: "invalid_snapshot",
          message: "The recovery snapshot failed its hash check. Resuming from the previous copy.",
        });
      }
    }
    this.restoreCandidate = null;
    this.restored = true;
    if (this.latest !== null) {
      this.setTick(this.latest.tick);
      this.latestTimeline = { term, authorityMemberId: this.selfMemberId };
      this.host.emit({ type: "restored", snapshot: this.latest });
      this.host.sendSnapshot(this.envelope());
    } else {
      this.setTick(this.tick);
    }
    this.lastSnapshotTick = this.tick;
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
    this.stopRestoreTimer();
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }
}

/**
 * Encode a game's serialized state as the JSON other players receive.
 * Fails when nothing would arrive (undefined, a function) or JSON cannot
 * encode it (a cycle, a BigInt). `lossy` names the first value JSON
 * silently changes — NaN/Infinity arrive as null, a Map or Set as `{}` —
 * the usual cause of a game that works for the host and breaks for
 * everyone else.
 */
export function encodeSnapshotState(
  state: unknown,
): { ok: true; json: string; lossy: string | null } | { ok: false; message: string } {
  let lossy: string | null = null;
  let json: string | undefined;
  try {
    json = JSON.stringify(state, (key, value: unknown) => {
      if (lossy === null) {
        const where = key === "" ? "The snapshot" : `Snapshot key "${key}"`;
        if (typeof value === "number" && !Number.isFinite(value)) {
          lossy = `${where} is ${value}, which other players receive as null. Check for a division by zero.`;
        } else if (value instanceof Map || value instanceof Set) {
          lossy = `${where} is a ${value instanceof Map ? "Map" : "Set"}, which other players receive as {}. Use a plain object or an array.`;
        }
      }
      return value;
    });
  } catch (error) {
    return {
      ok: false,
      message: `serializeState must return plain JSON data: ${errorText(error)}`,
    };
  }
  if (json === undefined) {
    return {
      ok: false,
      message:
        "serializeState returned nothing. Return your simulation state as a plain object, for example { players, ball, score }.",
    };
  }
  return { ok: true, json, lossy };
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
}
