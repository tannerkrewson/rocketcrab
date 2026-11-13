import { describe, expect, it } from "vitest";
import { signalUrl } from "./signal-url";

describe("signalUrl", () => {
  it("hashes the app and room into a room-scoped WebSocket URL", async () => {
    expect(await signalUrl("https://edge.example", "a", "bc")).toBe(
      "wss://edge.example/signal/ba7816bf8f01cfea414140de5dae2223",
    );
    expect(await signalUrl("http://localhost:8787", "a", "bc")).toBe(
      "ws://localhost:8787/signal/ba7816bf8f01cfea414140de5dae2223",
    );
    expect(await signalUrl("https://edge.example", "a", "other")).not.toEqual(
      await signalUrl("https://edge.example", "a", "bc"),
    );
  });

  it("rejects non-HTTP origins", async () => {
    await expect(signalUrl("file:///tmp", "app", "room")).rejects.toThrow();
  });
});
