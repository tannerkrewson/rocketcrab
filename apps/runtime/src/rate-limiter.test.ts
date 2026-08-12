import { describe, expect, it } from "vitest";
import { RateLimitedSink, TokenBucket } from "./rate-limiter";

describe("TokenBucket", () => {
  const start = 1_700_000_000_000;

  it("allows a full burst up to the capacity", () => {
    const bucket = new TokenBucket(10, 10, start);
    for (let i = 0; i < 10; i += 1) {
      expect(bucket.tryAcquire(start + i)).toBe(true);
    }
    expect(bucket.tryAcquire(start + 10)).toBe(false);
  });

  it("refills continuously at ratePerSecond tokens per second", () => {
    const bucket = new TokenBucket(10, 10, start);
    for (let i = 0; i < 10; i += 1) bucket.tryAcquire(start);
    expect(bucket.tryAcquire(start + 99)).toBe(false); // 0.99 tokens
    expect(bucket.tryAcquire(start + 100)).toBe(true); // 1.0 tokens
  });

  it("never exceeds the burst capacity", () => {
    const bucket = new TokenBucket(10, 5, start);
    bucket.tryAcquire(start);
    bucket.tryAcquire(start + 60_000);
    for (let i = 0; i < 4; i += 1) {
      expect(bucket.tryAcquire(start + 60_000)).toBe(true);
    }
    expect(bucket.tryAcquire(start + 60_000)).toBe(false);
  });
});

describe("RateLimitedSink", () => {
  const start = 1_700_000_000_000;

  it("drops over-limit items and reports the count on the next success", () => {
    const forwarded: Array<{ item: string; dropped: number }> = [];
    const sink = new RateLimitedSink<string>(new TokenBucket(3, 3, start), (item, dropped) => {
      forwarded.push({ item, dropped });
    });
    sink.send("a", start);
    sink.send("b", start);
    sink.send("c", start);
    sink.send("d", start); // dropped
    sink.send("e", start); // dropped
    expect(forwarded).toEqual([
      { item: "a", dropped: 0 },
      { item: "b", dropped: 0 },
      { item: "c", dropped: 0 },
    ]);
    sink.send("f", start + 1000); // refill
    expect(forwarded.at(-1)).toEqual({ item: "f", dropped: 2 });
  });

  it("tracks the pending drop count", () => {
    const sink = new RateLimitedSink<string>(new TokenBucket(1, 1, start), () => {});
    sink.send("a", start);
    sink.send("b", start);
    sink.send("c", start);
    expect(sink.droppedCount).toBe(2);
  });
});
