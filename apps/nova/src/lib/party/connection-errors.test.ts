import { describe, expect, it } from "vitest";
import { connectionErrorMessage } from "./connection-errors";

describe("connectionErrorMessage", () => {
  it.each([
    ["password_mismatch", /fresh invite/i],
    ["incompatible_version", /update\/reload Nova/i],
    ["relay_unreachable", /signaling relays/i],
    ["join_timeout", /timed out/i],
    ["peer_connection_failed", /direct connection/i],
    ["peer_disconnected", /closed while joining/i],
    ["rejected", /rejected/i],
    ["cancelled", /cancelled/i],
    ["not_connected", /not active/i],
    ["invalid_state", /unexpected state/i],
    ["already_joined", /already in a party/i],
  ])("maps %s to a player-facing message", (category, expected) => {
    expect(connectionErrorMessage({ category })).toMatch(expected);
  });

  it("keeps a specific PartyError message (no category)", () => {
    const error = Object.assign(new Error("Couldn't reach anyone in this party."), {
      code: "peer_unreachable",
    });
    expect(connectionErrorMessage(error)).toBe("Couldn't reach anyone in this party.");
  });

  it("falls back for unknown categories, blank messages, and non-errors", () => {
    expect(
      connectionErrorMessage(Object.assign(new Error("SDP failure"), { category: "unknown" })),
    ).toBe("SDP failure");
    expect(connectionErrorMessage(new Error("   "))).toBe("Something went wrong.");
    expect(connectionErrorMessage("boom")).toBe("Something went wrong.");
  });
});
