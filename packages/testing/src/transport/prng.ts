/**
 * Deterministic seeded PRNG for the in-memory transport.
 *
 * All randomness in the transport (jitter, loss, duplication, reordering,
 * generated IDs) flows from one PRNG so a run is fully reproducible given its
 * seed — fast-check friendly: property tests can pin a seed, run a script,
 * and re-run bit-for-bit identical traces.
 *
 * `mulberry32` is a small, well-understood 32-bit PRNG with good statistical
 * behavior for simulation workloads; it is deterministic across platforms
 * because every operation stays inside 32-bit integer math.
 */

/** Uniform PRNG: each call returns a float in [0, 1). */
export type Rng = () => number;

/** Mulberry32: deterministic 32-bit seeded PRNG (D. Jones). */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash of a string (same primitive as the F5 spike). */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Normalize a seed to a 32-bit integer. Numbers pass through; strings are
 * hashed (stable across runs); `undefined` derives a seed from wall time so
 * unseeded hubs still produce varying but internally consistent runs.
 */
export function normalizeSeed(seed: number | string | undefined): number {
  if (seed === undefined) {
    const time = Date.now() & 0xffffffff;
    const random = Math.floor(Math.random() * 0x100000000) >>> 0;
    return (Math.imul(time, 0x01000193) ^ random) >>> 0;
  }
  if (typeof seed === "string") {
    return hashString(seed);
  }
  return seed >>> 0;
}

/** Uniform integer in [0, maxExclusive). */
export function randomInt(rng: Rng, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

/** Uniform float in [min, max]. */
export function randomRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** True with the given probability (0 <= probability <= 1). */
export function chance(rng: Rng, probability: number): boolean {
  return probability > 0 && rng() < probability;
}

/**
 * Deterministic id fragment from the PRNG stream: exactly one draw producing
 * up to 8 lowercase hex characters. Fixed draw count keeps the RNG stream
 * position reproducible.
 */
export function rngHex(rng: Rng, digits = 8): string {
  const value = Math.floor(rng() * 0x100000000) >>> 0;
  return value.toString(16).padStart(8, "0").slice(0, digits);
}
