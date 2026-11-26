/**
 * Simulated time for session tests: timers, Date.now() and performance.now() run on vitest's
 * fake clock. WebCrypto's digest resolves off that clock, so simulated time
 * could run ahead of state hashing; the same SHA-256 resolves on a microtask
 * instead, which keeps every hash real and the order deterministic.
 */
import { createHash } from "node:crypto";
import { vi } from "vitest";

export function useSimulatedTime(): void {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
  });
  vi.spyOn(crypto.subtle, "digest").mockImplementation(async (_algorithm, data) => {
    const bytes = createHash("sha256")
      .update(new Uint8Array(data as ArrayBuffer))
      .digest();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  });
}

export function useRealTime(): void {
  vi.useRealTimers();
  vi.restoreAllMocks();
}
