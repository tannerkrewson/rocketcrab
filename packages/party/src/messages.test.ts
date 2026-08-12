import { describe, expect, it } from "vitest";
import { PARTY_CONTROL_CHANNEL } from "./messages";

describe("party control channel", () => {
  it("is separate from the game-facing protocol channel", () => {
    // Party control (adverts, join requests, admission, secret handoff,
    // greeter announcements) must never mix with game-plane messages so
    // party secrets cannot reach game code (ADR-0011).
    expect(PARTY_CONTROL_CHANNEL).not.toBe("nova.protocol");
    expect(PARTY_CONTROL_CHANNEL).toMatch(/^nova\./u);
  });
});
