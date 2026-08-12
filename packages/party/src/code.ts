import type { PartyCode } from "@rocketcrab/protocol";

/**
 * Four-letter rendezvous code generation and normalization (ADR-0004).
 *
 * The four-letter code is a public rendezvous namespace — never a secret
 * (engineering rule 6). It only points late joiners at the rendezvous room
 * where a greeter explicitly admits them; the real party room is derived
 * from a CSPRNG session secret (see `secrets.ts`).
 *
 * Alphabet (P2 decision): `ABCDEFGHJKMNPQRSTVWXYZ` — 23 letters,
 * 279,841 codes. Letters I, O, and L are omitted because they are the ones
 * most easily confused when transcribed by hand or read aloud (I with 1/l,
 * O with 0, L with I/1); the alphabet stays strictly alphabetic and drops
 * no vowel except none (A–Z minus I/O/L), so codes remain pronounceable.
 * Digits are not part of codes at all: normalization uppercases input and
 * validation rejects anything that is not exactly four letters, so a
 * mistyped "0"/"1"/"9" surfaces as a clear validation error instead of a
 * silently different code.
 */

/** Party code alphabet (no I/O/L; see module docs). */
export const PARTY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";

/** Codes are always exactly four letters. */
export const PARTY_CODE_LENGTH = 4;

/** True when `input` is already an exact four-letter uppercase code. */
export function isValidPartyCode(input: string): boolean {
  return new RegExp(`^[A-Z]{${PARTY_CODE_LENGTH}}$`).test(input);
}

/**
 * Normalize a raw code as typed by a player: trim surrounding whitespace
 * and uppercase. Returns the normalized string even when it is not a valid
 * code (callers validate with {@link isValidPartyCode} / the protocol
 * schema to give a useful error).
 */
export function normalizePartyCode(input: string): string {
  return input.trim().toUpperCase();
}

/**
 * Generate a random four-letter party code, uniform over the alphabet.
 * `rng` is injectable for deterministic tests: ONE draw returning a raw
 * index in [0, 23^4) selects the code (0 → "AAAA"). The default draws
 * with `crypto.getRandomValues` (rejection sampling for uniformity).
 */
export function generatePartyCode(rng?: () => number): PartyCode {
  const total = PARTY_CODE_ALPHABET.length ** PARTY_CODE_LENGTH;
  const value =
    rng === undefined
      ? randomCodeIndex(total)
      : Math.min(total - 1, Math.max(0, Math.floor(rng())));
  return indexToCode(value);
}

/** Map a code index in [0, 23^4) to its four-letter code (MSD first). */
function indexToCode(index: number): PartyCode {
  const chars: string[] = [];
  let remaining = index;
  for (let i = 0; i < PARTY_CODE_LENGTH; i += 1) {
    const place = PARTY_CODE_ALPHABET.length ** (PARTY_CODE_LENGTH - 1 - i);
    chars.push(PARTY_CODE_ALPHABET.charAt(Math.floor(remaining / place)));
    remaining %= place;
  }
  return chars.join("") as PartyCode;
}

/** Uniform index in [0, bound) from the CSPRNG (rejection sampling). */
function randomCodeIndex(bound: number): number {
  // Rejection sampling keeps the CSPRNG draw unbiased for non-power-of-two
  // bounds (23^4 = 279841).
  const limit = Math.floor(0x1_0000_0000 / bound) * bound;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const value = buffer[0];
    if (value === undefined) {
      continue; // unreachable; keeps TS happy about noUncheckedIndexedAccess
    }
    if (value < limit) {
      return value % bound;
    }
  }
}
