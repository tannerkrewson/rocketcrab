/**
 * Token-bucket rate limiter for runtime-plane reporting (F6 limits:
 * `runtimeLogRatePerSecond` console entries and `errorReportRatePerSecond`
 * error reports per runtime frame). A malicious or buggy game must not be
 * able to flood the host over the MessageChannel (threat model T10/T11).
 */
import { errorReportRatePerSecond, runtimeLogRatePerSecond } from "@rocketcrab/protocol";

export interface RateLimiter {
  /** Try to consume one token; false when the burst quota is exhausted. */
  tryAcquire(now?: number): boolean;
}

/** Token bucket with second-granularity refill (testable with injected time). */
export class TokenBucket implements RateLimiter {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number = ratePerSecond,
    now = Date.now(),
  ) {
    this.tokens = burst;
    this.lastRefillMs = now;
  }

  tryAcquire(now = Date.now()): boolean {
    const elapsed = Math.max(0, now - this.lastRefillMs);
    this.tokens = Math.min(this.burst, this.tokens + (elapsed / 1000) * this.ratePerSecond);
    this.lastRefillMs = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

/** The shared runtime-plane limiters, one pair per runtime instance. */
export function createRuntimeLimiters(now = Date.now()): {
  console: RateLimiter;
  errors: RateLimiter;
} {
  return {
    console: new TokenBucket(runtimeLogRatePerSecond, runtimeLogRatePerSecond, now),
    errors: new TokenBucket(errorReportRatePerSecond, errorReportRatePerSecond, now),
  };
}

/**
 * A rate-limited forwarder: items are dropped (counted) while the bucket is
 * exhausted; the drop count rides along on the next forwarded item.
 */
export class RateLimitedSink<T> {
  private dropped = 0;

  constructor(
    private readonly limiter: RateLimiter,
    private readonly sink: (item: T, dropped: number) => void,
  ) {}

  send(item: T, now?: number): void {
    if (this.limiter.tryAcquire(now)) {
      const dropped = this.dropped;
      this.dropped = 0;
      this.sink(item, dropped);
    } else {
      this.dropped += 1;
    }
  }

  get droppedCount(): number {
    return this.dropped;
  }
}
