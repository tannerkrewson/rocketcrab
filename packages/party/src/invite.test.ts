import { describe, expect, it } from "vitest";
import { buildInviteUrl, buildShortJoinUrl, parseInviteFragment, parseInviteUrl } from "./invite";

const SECRET = "A".repeat(43);
const BASE = "https://nova.example/join";

describe("invite links (ADR-0011)", () => {
  it("builds a URL with the secret in the fragment and nothing in the query", () => {
    const url = buildInviteUrl({ baseUrl: BASE, code: "abcd", secret: SECRET });
    expect(url).toBe(`${BASE}#code=ABCD&secret=${SECRET}`);
    expect(url).not.toContain("?");
  });

  it("round-trips through parsing", () => {
    const url = buildInviteUrl({ baseUrl: BASE, code: "ABCD", secret: SECRET });
    expect(parseInviteUrl(url)).toEqual({ code: "ABCD", secret: SECRET });
    expect(parseInviteFragment(`#code=ABCD&secret=${SECRET}`)).toEqual({
      code: "ABCD",
      secret: SECRET,
    });
    expect(parseInviteFragment(`code=ABCD&secret=${SECRET}`)).toEqual({
      code: "ABCD",
      secret: SECRET,
    });
  });

  it("parses fragment-only links and ignores the query string", () => {
    const url = `${BASE}?utm_source=x#code=ABCD&secret=${SECRET}`;
    expect(parseInviteUrl(url)).toEqual({ code: "ABCD", secret: SECRET });
  });

  it("accepts a code-less invite (secret only)", () => {
    expect(parseInviteFragment(`secret=${SECRET}`)).toEqual({ secret: SECRET });
  });

  it("rejects malformed invites", () => {
    expect(parseInviteUrl(BASE)).toBeNull(); // no fragment at all
    expect(parseInviteUrl(`${BASE}#code=ABCD`)).toBeNull(); // no secret
    expect(parseInviteFragment(`secret=too-short`)).toBeNull();
    expect(parseInviteFragment(`secret=${"A".repeat(44)}`)).toBeNull();
    expect(parseInviteFragment(`code=AB1D&secret=${SECRET}`)).toBeNull();
    expect(parseInviteFragment(`code=ABC&secret=${SECRET}`)).toBeNull();
  });

  it("throws on invalid build inputs", () => {
    expect(() => buildInviteUrl({ baseUrl: BASE, code: "AB1D", secret: SECRET })).toThrow(
      /invalid party code/u,
    );
    expect(() => buildInviteUrl({ baseUrl: BASE, code: "ABCD", secret: "nope" })).toThrow(
      /invalid session secret/u,
    );
  });

  it("strips any existing fragment from the base URL", () => {
    const url = buildInviteUrl({ baseUrl: `${BASE}#old`, code: "ABCD", secret: SECRET });
    expect(url).toBe(`${BASE}#code=ABCD&secret=${SECRET}`);
  });
});

describe("short join URLs (9fv.8)", () => {
  const ORIGIN = "https://rocketcrab.com";

  it("builds origin + lowercase code with no secret anywhere", () => {
    const url = buildShortJoinUrl({ baseUrl: ORIGIN, code: "CVVU" });
    expect(url).toBe("https://rocketcrab.com/cvvu");
    // The code is a public rendezvous namespace (ADR-0004): a path segment
    // is fine — but the secret must never appear in the URL (ADR-0011).
    expect(url).not.toContain("#");
    expect(url).not.toContain("?");
    expect(url).not.toContain("secret");
  });

  it("normalizes mixed-case codes to lowercase (codes are typed lowercase now)", () => {
    expect(buildShortJoinUrl({ baseUrl: ORIGIN, code: "cVvU" })).toBe(
      "https://rocketcrab.com/cvvu",
    );
  });

  it("tolerates a trailing slash or an existing fragment on the base", () => {
    expect(buildShortJoinUrl({ baseUrl: `${ORIGIN}/`, code: "cvvu" })).toBe(
      "https://rocketcrab.com/cvvu",
    );
    expect(buildShortJoinUrl({ baseUrl: `${ORIGIN}#old`, code: "cvvu" })).toBe(
      "https://rocketcrab.com/cvvu",
    );
  });

  it("throws on invalid codes (digits or wrong length)", () => {
    expect(() => buildShortJoinUrl({ baseUrl: ORIGIN, code: "AB1D" })).toThrow(
      /invalid party code/u,
    );
    expect(() => buildShortJoinUrl({ baseUrl: ORIGIN, code: "ABC" })).toThrow(
      /invalid party code/u,
    );
    expect(() => buildShortJoinUrl({ baseUrl: ORIGIN, code: "ABCDE" })).toThrow(
      /invalid party code/u,
    );
  });
});
