import { chance, randomRange, type Rng } from "./prng";

/**
 * Fault profile for one simulated link (the sending transport's conditions).
 * Every knob is optional; unset values fall back to the hub default or the
 * zero values below (a perfect link).
 */
export interface FaultProfile {
  /** Base one-way latency in ms applied to every message. */
  latencyMs?: number;
  /** Uniform jitter: latency varies by ±jitterMs around the base. */
  jitterMs?: number;
  /**
   * Probability in [0, 1) that a message is dropped. Only applies to
   * unreliable sends; reliable channels never lose messages.
   */
  lossRate?: number;
  /** Probability in [0, 1) that a message is duplicated. */
  duplicateChance?: number;
  /** Maximum extra copies produced when duplication fires (>= 1). */
  duplicateMax?: number;
  /** Probability in [0, 1) that a message is delayed (arrives out of order). */
  reorderRate?: number;
  /** Extra delay in ms applied when reordering fires. */
  reorderMaxDelayMs?: number;
  /** Delay before a join completes (simulated discovery latency, F3/F5). */
  joinDelayMs?: number;
  /** Delay before a reconnect completes (simulated rejoin, F11). */
  rejoinDelayMs?: number;
  /** Drop incoming messages while suspended instead of buffering them. */
  dropWhileSuspended?: boolean;
}

export interface RequiredFaultProfile {
  latencyMs: number;
  jitterMs: number;
  lossRate: number;
  duplicateChance: number;
  duplicateMax: number;
  reorderRate: number;
  reorderMaxDelayMs: number;
  joinDelayMs: number;
  rejoinDelayMs: number;
  dropWhileSuspended: boolean;
}

/** A perfect link: no latency, no faults. */
export const PERFECT_LINK: RequiredFaultProfile = {
  latencyMs: 0,
  jitterMs: 0,
  lossRate: 0,
  duplicateChance: 0,
  duplicateMax: 1,
  reorderRate: 0,
  reorderMaxDelayMs: 0,
  joinDelayMs: 0,
  rejoinDelayMs: 0,
  dropWhileSuspended: false,
};

/** Fill every unset profile field with its default. */
export function normalizeProfile(profile: FaultProfile | undefined): RequiredFaultProfile {
  if (profile === undefined) {
    return { ...PERFECT_LINK };
  }
  return {
    latencyMs: profile.latencyMs ?? PERFECT_LINK.latencyMs,
    jitterMs: profile.jitterMs ?? PERFECT_LINK.jitterMs,
    lossRate: profile.lossRate ?? PERFECT_LINK.lossRate,
    duplicateChance: profile.duplicateChance ?? PERFECT_LINK.duplicateChance,
    duplicateMax: profile.duplicateMax ?? PERFECT_LINK.duplicateMax,
    reorderRate: profile.reorderRate ?? PERFECT_LINK.reorderRate,
    reorderMaxDelayMs: profile.reorderMaxDelayMs ?? PERFECT_LINK.reorderMaxDelayMs,
    joinDelayMs: profile.joinDelayMs ?? PERFECT_LINK.joinDelayMs,
    rejoinDelayMs: profile.rejoinDelayMs ?? PERFECT_LINK.rejoinDelayMs,
    dropWhileSuspended: profile.dropWhileSuspended ?? PERFECT_LINK.dropWhileSuspended,
  };
}

/** The outcome of rolling a message through the fault profile. */
export interface FaultRoll {
  /** Effective one-way delay in ms (>= 0). */
  readonly delayMs: number;
  /** True when the message (or chunk) is dropped. */
  readonly lost: boolean;
  /** Extra duplicate copies to deliver (0 = deliver exactly once). */
  readonly duplicateCount: number;
}

/**
 * Roll one delivery through the profile. Draw order is fixed so seeded runs
 * are reproducible: jitter, reorder chance + delay, loss, duplication.
 * Reliable messages are never lost (retransmission is implied), matching
 * reliable data channels in a real transport.
 */
export function rollFaults(rng: Rng, profile: RequiredFaultProfile, reliable: boolean): FaultRoll {
  let delayMs = profile.latencyMs;

  // 1. Jitter around the base latency.
  if (profile.jitterMs > 0) {
    delayMs += randomRange(rng, -profile.jitterMs, profile.jitterMs);
  }

  // 2. Reordering: add a late-arrival delay.
  if (profile.reorderRate > 0 && chance(rng, profile.reorderRate)) {
    delayMs += randomRange(rng, 0, profile.reorderMaxDelayMs);
  }

  // 3. Loss — never for reliable channels.
  const lost = !reliable && profile.lossRate > 0 && chance(rng, profile.lossRate);

  // 4. Duplication: 1..duplicateMax extra copies.
  let duplicateCount = 0;
  if (profile.duplicateChance > 0 && chance(rng, profile.duplicateChance)) {
    duplicateCount = 1 + Math.floor(rng() * profile.duplicateMax);
  }

  return { delayMs: Math.max(0, delayMs), lost, duplicateCount };
}
