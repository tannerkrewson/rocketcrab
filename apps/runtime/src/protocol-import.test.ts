import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  parseRuntimeMessage,
  runtimeEnvelopeSchema,
  runtimeMessagesSchema,
} from "@rocketcrab/protocol";

/**
 * Compile + runtime smoke test: the runtime app consumes
 * @rocketcrab/protocol, so the shared types are exercised by the app's
 * `tsc --noEmit` typecheck and its vitest run.
 */
describe("@rocketcrab/protocol shared types in the runtime app", () => {
  it("exposes the protocol version", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("parses a runtime message and rejects invalid input", () => {
    const message = {
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "message-1",
      sentAt: 1_700_000_000_000,
      type: "runtime.ready",
      status: "ready",
    };
    const result = parseRuntimeMessage(message);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("runtime.ready");
    }
    expect(runtimeMessagesSchema.safeParse(message).success).toBe(true);
    expect(runtimeEnvelopeSchema.safeParse(message).success).toBe(true);
    expect(parseRuntimeMessage({ ...message, status: "nope" }).ok).toBe(false);
  });
});
