import { describe, expect, it } from "vitest";
import {
  ProtocolError,
  assertPeerMessage,
  assertRuntimeMessage,
  isPeerMessage,
  isRuntimeMessage,
  parsePeerMessage,
  parseRuntimeMessage,
} from "./errors";

const validPeerAction = {
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

const validRuntimeBootstrap = {
  version: 1,
  runtimeInstanceId: "runtime-1",
  sessionId: "session-1",
  messageId: "message-1",
  sentAt: 1_700_000_000_000,
  type: "runtime.bootstrap",
  gameId: "game-1",
  gameMode: "state",
  gameSource: "<html></html>",
  player: { memberId: "member-1", displayName: "Alex" },
};

describe("ProtocolError", () => {
  it("carries a code, message, and issues", () => {
    const error = new ProtocolError("invalid_message", "boom", [
      { code: "custom", message: "nope", path: [] },
    ]);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ProtocolError);
    expect(error.name).toBe("ProtocolError");
    expect(error.code).toBe("invalid_message");
    expect(error.message).toBe("boom");
    expect(error.issues).toHaveLength(1);
  });
});

describe("parsePeerMessage", () => {
  it("returns the validated message on success", () => {
    const result = parsePeerMessage(validPeerAction);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("action.dispatch");
      expect(result.value.senderMemberId).toBe("member-1");
      expect(result.value.version).toBe(1);
    }
  });

  it("rejects non-object input as an invalid envelope", () => {
    for (const bad of [null, undefined, 42, "hello", []]) {
      const result = parsePeerMessage(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("invalid_envelope");
        expect(result.error.message).toContain("version");
      }
    }
  });

  it("rejects an unknown protocol version with a useful error", () => {
    const result = parsePeerMessage({ ...validPeerAction, version: 99 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unsupported_version");
      expect(result.error.message).toContain("99");
      expect(result.error.message).toContain("1");
    }
  });

  it("rejects an unknown message type with a useful error", () => {
    const result = parsePeerMessage({ ...validPeerAction, type: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unknown_message_type");
      expect(result.error.message).toContain("nope");
    }
  });

  it("rejects a valid envelope with an invalid payload", () => {
    const result = parsePeerMessage({
      ...validPeerAction,
      baseRevision: -1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_message");
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});

describe("parseRuntimeMessage", () => {
  it("returns the validated message on success", () => {
    const result = parseRuntimeMessage(validRuntimeBootstrap);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("runtime.bootstrap");
      expect(result.value.runtimeInstanceId).toBe("runtime-1");
    }
  });

  it("rejects an unknown protocol version with a useful error", () => {
    const result = parseRuntimeMessage({
      ...validRuntimeBootstrap,
      version: 7,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unsupported_version");
      expect(result.error.message).toContain("7");
    }
  });
});

describe("type guards and assertions", () => {
  it("isPeerMessage / isRuntimeMessage narrow correctly", () => {
    expect(isPeerMessage(validPeerAction)).toBe(true);
    expect(isPeerMessage({ ...validPeerAction, version: 99 })).toBe(false);
    expect(isPeerMessage(validRuntimeBootstrap)).toBe(false);
    expect(isRuntimeMessage(validRuntimeBootstrap)).toBe(true);
    expect(isRuntimeMessage(validPeerAction)).toBe(false);
  });

  it("assertPeerMessage returns the value or throws ProtocolError", () => {
    expect(assertPeerMessage(validPeerAction).type).toBe("action.dispatch");
    expect(() => assertPeerMessage({ ...validPeerAction, version: 99 })).toThrow(ProtocolError);
    expect(() => assertPeerMessage({ ...validPeerAction, version: 99 })).toThrow(
      "Unsupported protocol version",
    );
  });

  it("assertRuntimeMessage returns the value or throws ProtocolError", () => {
    expect(assertRuntimeMessage(validRuntimeBootstrap).type).toBe("runtime.bootstrap");
    expect(() => assertRuntimeMessage({ ...validRuntimeBootstrap, type: "nope" })).toThrow(
      ProtocolError,
    );
  });
});
