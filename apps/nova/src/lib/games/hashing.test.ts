import { describe, expect, it } from "vitest";
import { hashSource, sourceByteLength } from "./hashing";

describe("source hashing (Web Crypto SHA-256)", () => {
  it("matches the SHA-256 known vector for 'hello'", async () => {
    expect(await hashSource("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("is deterministic and matches a precomputed digest for arbitrary sources", async () => {
    const source = "<html><body>🦀 rocketcrab</body></html>";
    // Precomputed with SHA-256 over the UTF-8 encoding of `source`.
    const expected = "b2b0554ac2a8dc7885d383c43a10bd36a0ac0b008980aca6f5344974d1a06f91";
    expect(await hashSource(source)).toBe(expected);
    expect(await hashSource(source)).toBe(await hashSource(source));
  });

  it("returns 64 lowercase hex characters", async () => {
    const digest = await hashSource("<html>hi</html>");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("sourceByteLength", () => {
  it("counts UTF-8 bytes, not JS string length", () => {
    const source = "é🦀"; // 2 UTF-8 bytes (é) + 4 (🦀)
    expect(source.length).toBe(3);
    expect(sourceByteLength(source)).toBe(6);
  });

  it("measures ASCII and empty sources", () => {
    expect(sourceByteLength("")).toBe(0);
    expect(sourceByteLength("<html>hi</html>")).toBe(15);
  });
});
