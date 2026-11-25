import { describe, expect, it } from "vitest";
import { mulberry32 } from "./prng";
import { PERFECT_LINK, normalizeProfile, rollFaults, type RequiredFaultProfile } from "./faults";

const ZERO: RequiredFaultProfile = { ...PERFECT_LINK };

describe("normalizeProfile", () => {
  it("defaults to a perfect link", () => {
    expect(normalizeProfile(undefined)).toEqual(PERFECT_LINK);
  });

  it("fills only the fields provided", () => {
    const profile = normalizeProfile({ latencyMs: 10, lossRate: 0.5 });
    expect(profile.latencyMs).toBe(10);
    expect(profile.lossRate).toBe(0.5);
    expect(profile.jitterMs).toBe(0);
    expect(profile.dropWhileSuspended).toBe(false);
  });
});

describe("rollFaults", () => {
  it("is deterministic for a fixed rng stream", () => {
    const a = rollFaults(mulberry32(5), ZERO, true);
    const b = rollFaults(mulberry32(5), ZERO, true);
    expect(a).toEqual(b);
  });

  it("applies base latency without jitter", () => {
    const roll = rollFaults(mulberry32(1), { ...ZERO, latencyMs: 50 }, true);
    expect(roll.delayMs).toBe(50);
  });

  it("jitters around the base latency within bounds", () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 200; i += 1) {
      const roll = rollFaults(rng, { ...ZERO, latencyMs: 100, jitterMs: 20 }, true);
      expect(roll.delayMs).toBeGreaterThanOrEqual(80);
      expect(roll.delayMs).toBeLessThanOrEqual(120);
    }
  });

  it("never clamps a perfect link below zero", () => {
    const roll = rollFaults(mulberry32(9), { ...ZERO, latencyMs: 0, jitterMs: 50 }, true);
    expect(roll.delayMs).toBeGreaterThanOrEqual(0);
  });

  it("never loses messages on reliable channels", () => {
    const rng = mulberry32(8);
    for (let i = 0; i < 500; i += 1) {
      const roll = rollFaults(rng, { ...ZERO, lossRate: 1 }, true);
      expect(roll.lost).toBe(false);
    }
  });

  it("drops messages on unreliable channels when loss fires", () => {
    const rng = mulberry32(8);
    let lost = 0;
    for (let i = 0; i < 500; i += 1) {
      if (rollFaults(rng, { ...ZERO, lossRate: 1 }, false).lost) {
        lost += 1;
      }
    }
    expect(lost).toBe(500);
  });

  it("produces 1..duplicateMax extra copies when duplication fires", () => {
    const rng = mulberry32(13);
    for (let i = 0; i < 100; i += 1) {
      const roll = rollFaults(rng, { ...ZERO, duplicateChance: 1, duplicateMax: 3 }, true);
      expect(roll.duplicateCount).toBeGreaterThanOrEqual(1);
      expect(roll.duplicateCount).toBeLessThanOrEqual(3);
    }
  });

  it("adds reorder delay up to the maximum", () => {
    const rng = mulberry32(21);
    for (let i = 0; i < 100; i += 1) {
      const roll = rollFaults(rng, { ...ZERO, reorderRate: 1, reorderMaxDelayMs: 40 }, true);
      expect(roll.delayMs).toBeGreaterThanOrEqual(0);
      expect(roll.delayMs).toBeLessThanOrEqual(40);
    }
  });
});
