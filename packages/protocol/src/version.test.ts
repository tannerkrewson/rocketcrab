import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  isSupportedProtocolVersion,
  protocolVersionSchema,
} from "./version";

describe("protocol versions", () => {
  it("exports the current version and the supported set", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(PROTOCOL_VERSION);
  });

  it("accepts the current protocol version", () => {
    expect(protocolVersionSchema.safeParse(PROTOCOL_VERSION).success).toBe(true);
    expect(isSupportedProtocolVersion(PROTOCOL_VERSION)).toBe(true);
  });

  it("rejects unknown versions with a useful error", () => {
    const result = protocolVersionSchema.safeParse(99);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("Unsupported protocol version");
      expect(result.error.issues[0]?.message).toContain("1");
    }
    expect(isSupportedProtocolVersion(99)).toBe(false);
    expect(isSupportedProtocolVersion("1")).toBe(false);
    expect(isSupportedProtocolVersion(undefined)).toBe(false);
  });
});
