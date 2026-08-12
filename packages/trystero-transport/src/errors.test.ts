import { describe, expect, it } from "vitest";
import { TrysteroJoinError, categorizeJoinError, toTrysteroJoinError } from "./errors";

describe("categorizeJoinError", () => {
  it("maps password errors (F8 phrasing) to password_mismatch", () => {
    expect(categorizeJoinError("incorrect room password when decrypting offer")).toBe(
      "password_mismatch",
    );
    expect(categorizeJoinError("incorrect room password when decrypting answer")).toBe(
      "password_mismatch",
    );
    expect(categorizeJoinError("incorrect password for overlapping room")).toBe(
      "password_mismatch",
    );
  });

  it("maps handshake timeouts to handshake_timeout", () => {
    expect(categorizeJoinError("handshake timed out after 30000ms")).toBe("handshake_timeout");
  });

  it("maps SDP exchange failures (F5 S3) to peer_connection_failed", () => {
    expect(
      categorizeJoinError(
        "could not connect to peer xyz after exchanging SDP; configure TURN servers with turnConfig or rtcConfig.iceServers",
      ),
    ).toBe("peer_connection_failed");
    expect(
      categorizeJoinError(
        "could not connect to peer xyz after exchanging SDP; check that your TURN server URLs and credentials are reachable by both peers",
      ),
    ).toBe("peer_connection_failed");
  });

  it("maps admission/handshake rejections to rejected", () => {
    expect(categorizeJoinError("admission policy rejected peer")).toBe("rejected");
    expect(categorizeJoinError("peer rejected admission")).toBe("rejected");
    expect(categorizeJoinError("handshake failed: peer sent an invalid identity handshake")).toBe(
      "rejected",
    );
  });

  it("maps handshake disconnects to peer_disconnected", () => {
    expect(categorizeJoinError("peer disconnected during handshake")).toBe("peer_disconnected");
  });

  it("defaults unknown messages to unknown", () => {
    expect(categorizeJoinError("something unexpected happened")).toBe("unknown");
  });
});

describe("TrysteroJoinError", () => {
  it("carries the category and raw fields from a Trystero report", () => {
    const error = toTrysteroJoinError({
      error: "incorrect room password when decrypting offer",
      appId: "rocketcrab-nova-dev",
      roomId: "ROOM",
      peerId: "peer-1",
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("TrysteroJoinError");
    expect(error.category).toBe("password_mismatch");
    expect(error.peerId).toBe("peer-1");
    expect(error.appId).toBe("rocketcrab-nova-dev");
    expect(error.roomId).toBe("ROOM");
    expect(error.isFatal).toBe(true);
  });

  it("marks non-fatal categories as recoverable", () => {
    const error = new TrysteroJoinError({
      category: "peer_connection_failed",
      message: "could not connect to peer x",
    });
    expect(error.isFatal).toBe(false);
  });
});
