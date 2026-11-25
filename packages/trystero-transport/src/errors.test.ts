import { describe, expect, it } from "vitest";
import type { RoomError } from "@trystero-p2p/ws-relay";
import { TrysteroJoinError, fromRoomError } from "./errors";

describe("fromRoomError", () => {
  const base = { appId: "app", roomId: "room", peerId: "peer", message: "arbitrary text" };
  const cases: Array<[RoomError, string, boolean]> = [
    [{ ...base, code: "room-full" }, "room_full", true],
    [{ ...base, code: "banned" }, "rejected", false],
    [{ ...base, code: "relay-failed" }, "relay_unreachable", true],
    [{ ...base, code: "identity-failed" }, "invalid_state", false],
    [{ ...base, code: "plugin-failed" }, "invalid_state", false],
    [{ ...base, code: "decrypt-failed", stage: "offer" }, "password_mismatch", true],
    [{ ...base, code: "decrypt-failed", stage: "answer" }, "password_mismatch", true],
    [
      { ...base, code: "peer-connect-failed", turnConfigured: true },
      "peer_connection_failed",
      false,
    ],
    [{ ...base, code: "handshake-failed" }, "rejected", false],
    [{ ...base, code: "peer-error" }, "peer_disconnected", false],
  ];
  it.each(cases)("maps $code independently of wording", (input, category, isFatal) => {
    expect(fromRoomError(input)).toMatchObject({
      code: input.code,
      category,
      isFatal,
      message: input.message,
    });
  });

  it("preserves error fields and cause", () => {
    const cause = new Error("underlying error");
    const error = fromRoomError({ ...base, code: "decrypt-failed", stage: "offer", cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("TrysteroJoinError");
    expect(error).toMatchObject({
      ...base,
      code: "decrypt-failed",
      category: "password_mismatch",
      cause,
      isFatal: true,
    });
  });

  it("does not infer category from misleading messages", () => {
    expect(
      fromRoomError({ ...base, code: "peer-error", message: "incorrect password" }).category,
    ).toBe("peer_disconnected");
  });
});

describe("TrysteroJoinError", () => {
  it("marks non-fatal categories as recoverable", () => {
    const error = new TrysteroJoinError({
      category: "peer_connection_failed",
      message: "could not connect to peer x",
    });
    expect(error.isFatal).toBe(false);
  });
});
