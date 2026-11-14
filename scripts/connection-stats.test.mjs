import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQueries, run } from "./connection-stats.mjs";

const args = { start: "2026-01-01", end: "2026-02-01", accountId: "a".repeat(32), token: "secret" };

test("dates and account inputs cannot inject SQL or URLs", async () => {
  for (const value of ["2026-01-01' OR 1=1", "2026-02-30", "2026-1-01"])
    assert.throws(() => buildQueries(value, args.end));
  assert.throws(() => buildQueries(args.end, args.start));
  await assert.rejects(run({ ...args, accountId: "../bad" }), /account ID/);
});

test("queries use sampling weights and report outcomes and successful median", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        data:
          calls.length === 1
            ? [
                { outcome: "direct", events: "3" },
                { outcome: "failed", events: 1 },
              ]
            : [{ events: 3, median_ms: 125 }],
      }),
    };
  };
  const output = await run({ ...args, fetchImpl });
  assert.match(output, /direct: 75.0%/);
  assert.match(output, /failed: 25.0%/);
  assert.match(output, /125 ms/);
  assert.match(calls[0].url, /analytics_engine\/sql$/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret");
  assert.equal(calls[0].options.redirect, "error");
  assert.match(calls[0].options.body, /SUM\(_sample_interval\)/);
  assert.match(calls[1].options.body, /quantileExactWeighted\(0.5\)\(double1, _sample_interval\)/);
});

test("empty data and errors do not disclose tokens", async () => {
  const empty = await run({
    ...args,
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: [] }) }),
  });
  assert.match(empty, /Median successful connect time: n\/a/);
  await assert.rejects(
    run({
      ...args,
      fetchImpl: async () => {
        throw Error("secret");
      },
    }),
    (error) => !error.message.includes("secret"),
  );
  await assert.rejects(
    run({ ...args, fetchImpl: async () => ({ ok: false, status: 403 }) }),
    /HTTP 403/,
  );
});

test("unknown outcomes are reported and count as connected for the median", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(options.body);
    return {
      ok: true,
      json: async () => ({
        data:
          calls.length === 1
            ? [
                { outcome: "direct", events: 1 },
                { outcome: "unknown", events: 1 },
                { outcome: "failed", events: 2 },
              ]
            : [{ events: 2, median_ms: 80 }],
      }),
    };
  };
  const output = await run({ ...args, fetchImpl });
  assert.match(output, /Estimated events: 4/);
  assert.match(output, /unknown: 25.0%/);
  assert.match(output, /failed: 50.0%/);
  assert.match(calls[1], /blob1 IN \('direct', 'turn', 'tunnel', 'unknown'\)/);
  assert.match(output, /80 ms/);
});

test("unrecognised outcome names are still rejected", async () => {
  await assert.rejects(
    run({
      ...args,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ data: [{ outcome: "relay", events: 1 }] }),
      }),
    }),
    /unknown outcome/,
  );
});
