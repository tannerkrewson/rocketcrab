import { describe, expect, it } from "vitest";
import { sessionSecretSchema } from "@rocketcrab/protocol";
import { SESSION_SECRET_BYTES, deriveSessionMaterial, generateSessionSecret } from "./secrets";

const SECRET = "A".repeat(43);

describe("session secrets (ADR-0011)", () => {
  it("generates 32-byte CSPRNG secrets in unpadded base64url", () => {
    for (let i = 0; i < 20; i += 1) {
      const secret = generateSessionSecret();
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(sessionSecretSchema.safeParse(secret).success).toBe(true);
    }
  });

  it("generates a fresh secret every call", () => {
    expect(generateSessionSecret()).not.toBe(generateSessionSecret());
  });

  it("derives 256-bit room credentials deterministically", async () => {
    const material = await deriveSessionMaterial(SECRET);
    expect(material.secret).toBe(SECRET);
    expect(material.roomId).toMatch(/^party:[0-9a-f]{64}$/u);
    expect(material.password).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(material.sessionId).toMatch(/^[0-9a-f]{64}$/u);

    // Deterministic: the same secret always derives the same room.
    const again = await deriveSessionMaterial(SECRET);
    expect(again).toEqual(material);
  });

  it("derives distinct rooms for distinct secrets", async () => {
    const a = await deriveSessionMaterial(SECRET);
    const b = await deriveSessionMaterial("B".repeat(43));
    expect(a.roomId).not.toBe(b.roomId);
    expect(a.password).not.toBe(b.password);
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it("derives different labels from the same secret (domain separation)", async () => {
    const material = await deriveSessionMaterial(SECRET);
    expect(material.roomId).not.toContain(material.password);
    expect(material.password).not.toBe(material.sessionId);
  });

  it("rejects malformed secrets", async () => {
    await expect(deriveSessionMaterial("short")).rejects.toThrow(/malformed/u);
    await expect(deriveSessionMaterial("A".repeat(44))).rejects.toThrow(/malformed/u);
  });

  it("uses exactly SESSION_SECRET_BYTES of entropy", () => {
    expect(SESSION_SECRET_BYTES).toBe(32);
    // 32 bytes -> 43 unpadded base64url characters (ceil(256/6)).
    expect(Math.ceil((SESSION_SECRET_BYTES * 8) / 6)).toBe(43);
  });
});
