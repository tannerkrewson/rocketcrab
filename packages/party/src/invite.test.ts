import { describe, expect, it } from "vitest";
import { buildInviteUrl, parseInviteFragment, parseInviteUrl } from "./invite";
const secret = "A".repeat(43);
describe("private invites", () => {
  it("keeps the only credential in the fragment and removes base queries", () => {
    const url = new URL(
      buildInviteUrl({ baseUrl: "https://example.com/join?noise=1#old", secret }),
    );
    expect(url.pathname).toBe("/join");
    expect(url.search).toBe("");
    expect(parseInviteUrl(url.href)).toEqual({ secret });
    expect(url.hash).toBe("#secret=" + secret);
  });
  it("does not accept secrets in paths or queries", () => {
    expect(parseInviteUrl("https://example.com/join?secret=" + secret)).toBeNull();
    expect(parseInviteUrl("https://example.com/" + secret)).toBeNull();
  });
  it("rejects malformed secrets without echoing them", () => {
    expect(parseInviteFragment("#secret=bad")).toBeNull();
    expect(() =>
      buildInviteUrl({ baseUrl: "https://example.com/join", secret: "do-not-log-this" }),
    ).toThrow("Invalid invite secret.");
  });
});
