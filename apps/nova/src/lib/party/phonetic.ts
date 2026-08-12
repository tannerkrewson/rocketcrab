/**
 * Phonetic spelling for party codes (7.22 — classic rocketcrab parity).
 *
 * Classic renders the four-letter room code as NATO-style words under the
 * big party URL ("(alpha bravo charlie delta)") so players can read it
 * aloud over a call. Nova codes use the P2 alphabet (no I/O/L), but the
 * full NATO map is provided so any letter is covered.
 */

const NATO_PHONETIC: Readonly<Record<string, string>> = {
  A: "alpha",
  B: "bravo",
  C: "charlie",
  D: "delta",
  E: "echo",
  F: "foxtrot",
  G: "golf",
  H: "hotel",
  I: "india",
  J: "juliett",
  K: "kilo",
  L: "lima",
  M: "mike",
  N: "november",
  O: "oscar",
  P: "papa",
  Q: "quebec",
  R: "romeo",
  S: "sierra",
  T: "tango",
  U: "uniform",
  V: "victor",
  W: "whiskey",
  X: "xray",
  Y: "yankee",
  Z: "zulu",
};

/**
 * Map a party code (or any short string) to its phonetic words, joined
 * with spaces and lowercased — "RCRB" → "romeo charlie romeo bravo".
 * Unknown characters pass through lowercased.
 */
export function phoneticSpelling(code: string): string {
  return code
    .toUpperCase()
    .split("")
    .map((char) => NATO_PHONETIC[char] ?? char.toLowerCase())
    .join(" ");
}
