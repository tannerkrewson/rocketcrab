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
    expect(PARTY_CODE_ALPHABET).toMatch(/^[a-z]+$/u);
    expect(PARTY_CODE_ALPHABET).not.toMatch(/[io]/u);
    expect(PARTY_CODE_ALPHABET).not.toContain("l");
    // Still covers the rest of the alphabet: a-z minus i/o/l exactly.
    const rest = "abcdefghijklmnopqrstuvwxyz".replace(/[iol]/gu, "");
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
    expect(code).toBe("aaaa");
    const last = generatePartyCode(() => PARTY_CODE_ALPHABET.length ** PARTY_CODE_LENGTH - 1);
    expect(last).toBe(PARTY_CODE_ALPHABET.charAt(PARTY_CODE_ALPHABET.length - 1).repeat(4));
  });

  it("normalizes typed input (trim + lowercase)", () => {
    expect(normalizePartyCode("  ABCD ")).toBe("abcd");
    expect(normalizePartyCode("WXYZ")).toBe("wxyz");
  });

  it("validates exactly four letters in either case", () => {
    expect(isValidPartyCode("ABCD")).toBe(true);
    expect(isValidPartyCode("abcd")).toBe(true);
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
