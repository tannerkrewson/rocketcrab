import { describe, expect, it } from "vitest";
import { edgeSocketUrl, tunnelUrl } from "./edge-url";

const PAIR = "a".repeat(64);

describe("tunnelUrl", () => {
  it("maps an http edge origin to ws://.../tunnel/:pairId", () => {
    expect(tunnelUrl("http://localhost:2724", PAIR)).toBe(`ws://localhost:2724/tunnel/${PAIR}`);
  });

  it("maps an https edge origin to wss://.../tunnel/:pairId", () => {
    expect(tunnelUrl("https://edge.example", PAIR)).toBe(`wss://edge.example/tunnel/${PAIR}`);
  });

  it("drops any path on the configured origin", () => {
    expect(tunnelUrl("https://edge.example/some/path", PAIR)).toBe(
      `wss://edge.example/tunnel/${PAIR}`,
    );
  });

  it("rejects pair IDs that are not 64 lowercase hex characters", () => {
    expect(() => tunnelUrl("https://edge.example", "a".repeat(63))).toThrow();
    expect(() => tunnelUrl("https://edge.example", "A".repeat(64))).toThrow();
    expect(() => tunnelUrl("https://edge.example", `${PAIR}/../x`)).toThrow();
  });

  it("rejects non-HTTP origins", () => {
    expect(() => tunnelUrl("ws://edge.example", PAIR)).toThrow();
    expect(() => edgeSocketUrl("file:///tmp", "/tunnel/x")).toThrow();
  });
});
