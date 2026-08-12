import { describe, expect, it } from "vitest";
import { peerEnvelopeSchema, runtimeEnvelopeSchema } from "./envelope";

const validPeerEnvelope = {
  version: 1,
  sessionId: "session-1",
  senderMemberId: "member-1",
  senderConnectionId: "connection-1",
  messageId: "message-1",
  sentAt: 1_700_000_000_000,
};

const validRuntimeEnvelope = {
  version: 1,
  runtimeInstanceId: "runtime-1",
  sessionId: "session-1",
  messageId: "message-1",
  sentAt: 1_700_000_000_000,
};

describe("peer envelope", () => {
  it("parses a complete peer envelope", () => {
    expect(peerEnvelopeSchema.safeParse(validPeerEnvelope).success).toBe(true);
  });

  it("requires every envelope field", () => {
    const fields = [
      "version",
      "sessionId",
      "senderMemberId",
      "senderConnectionId",
      "messageId",
      "sentAt",
    ] as const;
    for (const missing of fields) {
      const rest: Record<string, unknown> = { ...validPeerEnvelope };
      delete rest[missing];
      expect(peerEnvelopeSchema.safeParse(rest).success).toBe(false);
    }
  });

  it("rejects an unknown protocol version", () => {
    const result = peerEnvelopeSchema.safeParse({
      ...validPeerEnvelope,
      version: 2,
    });
    expect(result.success).toBe(false);
  });
});

describe("runtime envelope", () => {
  it("parses a complete runtime envelope", () => {
    expect(runtimeEnvelopeSchema.safeParse(validRuntimeEnvelope).success).toBe(true);
  });

  it("requires the runtime instance ID and message ID", () => {
    const noInstance: Record<string, unknown> = { ...validRuntimeEnvelope };
    delete noInstance.runtimeInstanceId;
    expect(runtimeEnvelopeSchema.safeParse(noInstance).success).toBe(false);
    const noMessageId: Record<string, unknown> = { ...validRuntimeEnvelope };
    delete noMessageId.messageId;
    expect(runtimeEnvelopeSchema.safeParse(noMessageId).success).toBe(false);
  });
});
