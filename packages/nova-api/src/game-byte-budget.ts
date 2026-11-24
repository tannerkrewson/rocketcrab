import { gameBytesBurst, gameBytesPerSecond, gameBytesWarn } from "@rocketcrab/protocol";
import type { NovaSessionEvent } from "./client";
import { NovaError } from "./errors";

/** Per-session token bucket for game data. */
export class GameByteBudget {
  private gameByteTokens = gameBytesBurst;
  private gameByteUpdatedAt = performance.now();
  private gameByteWarned = false;

  consume(
    bytes: number,
    emit: (event: Extract<NovaSessionEvent, { type: "bandwidthWarning" }>) => void,
  ): void {
    const now = performance.now();
    const elapsed = Math.max(0, now - this.gameByteUpdatedAt);
    this.gameByteTokens = Math.min(
      gameBytesBurst,
      this.gameByteTokens + (elapsed * gameBytesPerSecond) / 1000,
    );
    this.gameByteUpdatedAt = now;
    if (this.gameByteTokens < bytes) {
      throw new NovaError(
        "rate_limited",
        "Game bandwidth budget exceeded (256 KiB/s, 1 MiB burst); the send was dropped.",
      );
    }
    this.gameByteTokens -= bytes;
    if (gameBytesBurst - this.gameByteTokens >= gameBytesWarn && !this.gameByteWarned) {
      this.gameByteWarned = true;
      emit({
        type: "bandwidthWarning",
        message: "Game bandwidth budget is 80% exhausted (256 KiB/s, 1 MiB burst).",
      });
    } else if (gameBytesBurst - this.gameByteTokens < gameBytesWarn) {
      this.gameByteWarned = false;
    }
  }
}

/**
 * Size of one payload in bytes: byte length for binary payloads, UTF-8
 * serialized size for structured data (the same measurement the transports
 * use for chunking and progress).
 */
export function payloadBytes(payload: unknown): number {
  if (payload instanceof Uint8Array) {
    return payload.byteLength;
  }
  if (payload instanceof ArrayBuffer) {
    return payload.byteLength;
  }
  const json = JSON.stringify(payload);
  return new TextEncoder().encode(json ?? "").length;
}
