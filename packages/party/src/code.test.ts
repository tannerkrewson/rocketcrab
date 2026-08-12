import { describe, expect, it } from "vitest";
import {
  PARTY_CODE_ALPHABET,
  PARTY_CODE_LENGTH,
  generatePartyCode,
  isValidPartyCode,
  normalizePartyCode,
} from "./code";

describe("party code generation (ADR-0004)", () => {
  it("uses a human-readable alphabetic alphabet that omits I, O, and L", () => {
    expect(PARTY_CODE_ALPHABET).toHaveLength(23);
    expect(PARTY_CODE_ALPHABET).toMatch(/^[A-Z]+$/u);
    expect(PARTY_CODE_ALPHABET).not.toMatch(/[IO]/u);
    expect(PARTY_CODE_ALPHABET).not.toContain("L");
    // Still covers the rest of the alphabet: A-Z minus I/O/L exactly.
    const rest = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".replace(/[IOL]/gu, "");
    expect([...PARTY_CODE_ALPHABET].sort().join("")).toBe([...rest].sort().join(""));
  });

  it("generates exactly four letters from the alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generatePartyCode();
      expect(code).toMatch(new RegExp(`^[${PARTY_CODE_ALPHABET}]{${PARTY_CODE_LENGTH}}$`, "u"));
      expect(isValidPartyCode(code)).toBe(true);
    }
  });

  it("is deterministic with an injected rng", () => {
    const code = generatePartyCode(() => 0);
    expect(code).toBe("AAAA");
    const last = generatePartyCode(() => PARTY_CODE_ALPHABET.length ** PARTY_CODE_LENGTH - 1);
    expect(last).toBe(PARTY_CODE_ALPHABET.charAt(PARTY_CODE_ALPHABET.length - 1).repeat(4));
  });

  it("normalizes typed input (trim + uppercase)", () => {
    expect(normalizePartyCode("  abcd ")).toBe("ABCD");
    expect(normalizePartyCode("wxyz")).toBe("WXYZ");
  });

  it("validates exactly four uppercase letters", () => {
    expect(isValidPartyCode("ABCD")).toBe(true);
    expect(isValidPartyCode("ab12")).toBe(false);
    expect(isValidPartyCode("ABC")).toBe(false);
    expect(isValidPartyCode("ABCDE")).toBe(false);
    expect(isValidPartyCode("ABC1")).toBe(false);
    expect(isValidPartyCode("")).toBe(false);
  });

  it("covers a healthy code space (23^4)", () => {
    expect(PARTY_CODE_ALPHABET.length ** PARTY_CODE_LENGTH).toBe(23 ** 4);
  });
});
