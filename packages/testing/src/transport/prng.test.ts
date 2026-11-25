import { describe, expect, it } from "vitest";
import {
  chance,
  hashString,
  mulberry32,
  normalizeSeed,
  randomInt,
  randomRange,
  rngHex,
  type Rng,
} from "./prng";

describe("mulberry32", () => {
  it("is deterministic for the same seed", () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    const seqA = Array.from({ length: 100 }, () => a());
    const seqB = Array.from({ length: 100 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("stays in [0, 1) across a long run", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 10_000; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("seed helpers", () => {
  it("normalizes strings stably (FNV-1a)", () => {
    expect(normalizeSeed("arena")).toBe(hashString("arena"));
    expect(normalizeSeed("arena")).toBe(normalizeSeed("arena"));
  });

  it("normalizes numbers through as 32-bit", () => {
    expect(normalizeSeed(42)).toBe(42);
    expect(normalizeSeed(0x1_0000_0000 + 7)).toBe(7);
  });
});

describe("derived helpers", () => {
  it("draws from the same rng stream in a fixed order", () => {
    const base = mulberry32(99);
    const control = mulberry32(99);
    const rng: Rng = base;
    const int = randomInt(rng, 10);
    const range = randomRange(rng, 5, 10);
    const hit = chance(rng, 0.5);
    const hex = rngHex(rng);
    expect(int).toBe(Math.floor(control() * 10));
    expect(range).toBe(5 + control() * 5);
    expect(hit).toBe(control() < 0.5);
    expect(hex).toBe((Math.floor(control() * 0x100000000) >>> 0).toString(16).padStart(8, "0"));
  });

  it("chance never draws when the probability is zero", () => {
    const rng = mulberry32(5);
    expect(chance(rng, 0)).toBe(false);
    expect(chance(rng, 0)).toBe(false);
    // The stream is untouched: the next value equals a fresh rng's first value.
    expect(rng()).toBe(mulberry32(5)());
  });

  it("produces valid hex ids", () => {
    const rng = mulberry32(11);
    expect(rngHex(rng)).toMatch(/^[0-9a-f]{8}$/);
    expect(rngHex(rng, 4)).toMatch(/^[0-9a-f]{4}$/);
  });
});
