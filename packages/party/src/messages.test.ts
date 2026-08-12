import { describe, expect, it } from "vitest";
import type { PartyRenameMessage } from "@rocketcrab/protocol";
import { PARTY_CONTROL_CHANNEL, buildPartyRenameMessage } from "./messages";

describe("party control channel", () => {
  it("is separate from the game-facing protocol channel", () => {
    // Party control (adverts, join requests, admission, secret handoff,
    // greeter announcements) must never mix with game-plane messages so
    // party secrets cannot reach game code (ADR-0011).
    expect(PARTY_CONTROL_CHANNEL).not.toBe("nova.protocol");
    expect(PARTY_CONTROL_CHANNEL).toMatch(/^nova\./u);
  });

  it("builds a validated party.rename announcement (7.25)", () => {
    const message = buildPartyRenameMessage(
      {
        sessionId: "session-1",
        senderMemberId: "member-1",
        senderConnectionId: "connection-1",
      },
      { displayName: "New Name" },
    ) as PartyRenameMessage;
    expect(message.type).toBe("party.rename");
    expect(message.displayName).toBe("New Name");
    expect(message.senderMemberId).toBe("member-1");
  });
});
