import { describe, expect, it } from "vitest";
import {
  LIMITS,
  PROTOCOL_VERSION,
  parsePeerMessage,
  parseRuntimeMessage,
  peerMessagesSchema,
  runtimeMessagesSchema,
} from "@rocketcrab/protocol";

/**
 * Compile + runtime smoke test: the Nova app consumes @rocketcrab/protocol,
 * so the shared types are exercised by the app's `tsc --noEmit` typecheck and
 * its vitest run. This app must never import React from the protocol package.
 */
describe("@rocketcrab/protocol shared types in the Nova app", () => {
  it("exposes the protocol version and limits", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(LIMITS.handshakeTimeoutMs).toBeGreaterThan(0);
  });

  it("validates a peer message at the boundary", () => {
    const message = {
      version: 1,
      sessionId: "session-1",
      senderMemberId: "member-1",
      senderConnectionId: "connection-1",
      messageId: "message-1",
      sentAt: 1_700_000_000_000,
      seq: 1,
      type: "action.dispatch",
      actionId: "action-1",
      baseRevision: 0,
      actionType: "playCard",
      payload: { card: "ace" },
    };
    const result = parsePeerMessage(message);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("action.dispatch");
    }
    expect(peerMessagesSchema.safeParse(message).success).toBe(true);
    expect(parsePeerMessage({ ...message, version: 99 }).ok).toBe(false);
  });

  it("validates a runtime message at the boundary", () => {
    const message = {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-1",
      sentAt: 1_700_000_000_000,
      type: "runtime.bootstrap",
      gameId: "game-1",
      gameMode: "state",
      gameSource: "<html></html>",
      player: { memberId: "member-1", displayName: "Alex" },
    };
    const result = parseRuntimeMessage(message);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("runtime.bootstrap");
    }
    expect(runtimeMessagesSchema.safeParse(message).success).toBe(true);
  });
});
