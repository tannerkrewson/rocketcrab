import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALERT_THRESHOLDS_PCT,
  BYTES_PER_GIB,
  DEFAULT_GB_BUDGET,
  TURN_ANALYTICS_ENDPOINT,
  TURN_EGRESS_FIELD,
  TURN_USAGE_DATASET,
  WATERMARK_KEY_PREFIX,
  buildAlertMessage,
  buildUsageQuery,
  computeUsageBuckets,
  monthKey,
  monthStartKey,
  parseEgressBytes,
  parseGbBudget,
  postAlert,
  readWatermarkMonth,
  runWatchdog,
  shouldAlert,
  thresholdBytes,
  todayKey,
  updateWatermarks,
  type WatchdogEnv,
} from "./watchdog";
import type { KvStore } from "./worker";

/**
 * TURN usage watchdog tests (beads rocketcrab-23s.5). The watchdog
 * (deploy/turn-creds/watchdog.ts) queries the Cloudflare Realtime TURN
 * analytics GraphQL dataset (`callsTurnUsageAdaptiveGroups`) for the current
 * month's egress, and alerts when usage crosses 10% / 50% / 90% of
 * WATCHDOG_GB_BUDGET — each threshold exactly once per month via KV
 * watermarks. The GraphQL endpoint is stubbed with a mocked global fetch.
 */

class MemoryKv implements KvStore {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  entries(): Map<string, string> {
    return this.store;
  }
}

/** A GraphQL analytics response body with one row per (day, egressBytes) pair. */
function analyticsResponse(rows: Array<{ datetime: string; egressBytes: number }>): unknown {
  return {
    data: {
      viewer: {
        accounts: [
          {
            [TURN_USAGE_DATASET]: rows.map((row) => ({
              dimensions: { datetime: row.datetime },
              sum: { egressBytes: row.egressBytes },
            })),
          },
        ],
      },
    },
  };
}

/** Small env with the analytics secrets set and a webhook. */
function makeEnv(overrides: Partial<WatchdogEnv> = {}): WatchdogEnv {
  return {
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    CLOUDFLARE_API_TOKEN: "test-token",
    WATCHDOG_GB_BUDGET: "200",
    ALERT_WEBHOOK_URL: "https://alerts.example.net/hook",
    ...overrides,
  };
}

/** Fixed "now": 2026-08-13T09:00:00Z (mid-month, deterministic). */
const NOW = Date.UTC(2026, 7, 13, 9, 0, 0);

function fetchCalls(
  fetchMock: ReturnType<typeof vi.fn>,
): Array<{ url: string; init?: RequestInit }> {
  return fetchMock.mock.calls.map((call) => ({
    url: String(call[0]),
    init: call[1] as RequestInit | undefined,
  }));
}

describe("pure functions: dates, budget parsing, thresholds", () => {
  it("derives month keys and date bounds from a timestamp", () => {
    expect(monthKey(NOW)).toBe("2026-08");
    expect(monthStartKey(NOW)).toBe("2026-08-01");
    expect(todayKey(NOW)).toBe("2026-08-13");
  });

  it("parses WATCHDOG_GB_BUDGET with the 200 GiB default", () => {
    expect(parseGbBudget(undefined)).toBe(DEFAULT_GB_BUDGET);
    expect(parseGbBudget("50")).toBe(50);
    expect(parseGbBudget("0.5")).toBe(0.5);
  });

  it("falls back to the default for invalid or non-positive budgets", () => {
    expect(parseGbBudget("abc")).toBe(DEFAULT_GB_BUDGET);
    expect(parseGbBudget("")).toBe(DEFAULT_GB_BUDGET);
    expect(parseGbBudget("0")).toBe(DEFAULT_GB_BUDGET);
    expect(parseGbBudget("-10")).toBe(DEFAULT_GB_BUDGET);
  });

  it("computes threshold bytes and usage buckets", () => {
    const budgetBytes = 200 * BYTES_PER_GIB;
    expect(thresholdBytes(budgetBytes, 10)).toBe(20 * BYTES_PER_GIB);
    const buckets = computeUsageBuckets(100 * BYTES_PER_GIB, budgetBytes);
    expect(buckets.map((b) => b.pct)).toEqual([...ALERT_THRESHOLDS_PCT]);
    // 50% of 200 GiB: the 10% and 50% thresholds are crossed, 90% is not.
    expect(buckets.map((b) => b.crossed)).toEqual([true, true, false]);
    expect(buckets[1]?.egressBytesAtThreshold).toBe(100 * BYTES_PER_GIB);
  });
});

describe("pure functions: shouldAlert / buildAlertMessage", () => {
  it("alerts only when the threshold is crossed AND not already fired this month", () => {
    const budgetBytes = 200 * BYTES_PER_GIB;
    // Not crossed.
    expect(shouldAlert(5 * BYTES_PER_GIB, budgetBytes, 10, null, "2026-08")).toBe(false);
    // Crossed, never fired.
    expect(shouldAlert(30 * BYTES_PER_GIB, budgetBytes, 10, null, "2026-08")).toBe(true);
    // Crossed, but fired earlier this month -> once per month.
    expect(shouldAlert(30 * BYTES_PER_GIB, budgetBytes, 10, "2026-08", "2026-08")).toBe(false);
    // Crossed, fired last month -> a new month may alert again.
    expect(shouldAlert(30 * BYTES_PER_GIB, budgetBytes, 10, "2026-07", "2026-08")).toBe(true);
  });

  it("builds the structured alert payload with GiB conversions and ISO timestamp", () => {
    const alert = buildAlertMessage({
      month: "2026-08",
      pct: 50,
      egressBytes: 100 * BYTES_PER_GIB,
      budgetGiB: 200,
      now: NOW,
    });
    expect(alert.alert).toBe("turn_budget");
    expect(alert.month).toBe("2026-08");
    expect(alert.thresholdPct).toBe(50);
    expect(alert.egressBytes).toBe(100 * BYTES_PER_GIB);
    expect(alert.egressGiB).toBe(100);
    expect(alert.budgetGiB).toBe(200);
    expect(alert.usagePct).toBe(50);
    expect(alert.ts).toBe("2026-08-13T09:00:00.000Z");
  });
});

describe("GraphQL query + response parsing", () => {
  it("buildUsageQuery targets the documented TURN dataset, egress field, and month range", () => {
    const { query, variables } = buildUsageQuery("acc-1", "2026-08-01", "2026-08-13");
    expect(query).toContain("viewer");
    expect(query).toContain("accounts(filter: { accountTag: $accountTag })");
    expect(query).toContain(TURN_USAGE_DATASET);
    expect(query).toContain(TURN_EGRESS_FIELD);
    expect(query).toContain("date_geq: $dateFrom");
    expect(query).toContain("date_leq: $dateTo");
    expect(variables).toEqual({
      accountTag: "acc-1",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-13",
    });
  });

  it("parseEgressBytes sums egress across rows (the month total)", () => {
    const json = analyticsResponse([
      { datetime: "2026-08-01", egressBytes: 100 },
      { datetime: "2026-08-02", egressBytes: 250 },
    ]);
    expect(parseEgressBytes(json)).toBe(350);
  });

  it("parseEgressBytes returns 0 for an empty row set (no usage yet)", () => {
    expect(parseEgressBytes(analyticsResponse([]))).toBe(0);
  });

  it("parseEgressBytes throws on GraphQL errors or a missing dataset node", () => {
    expect(() => parseEgressBytes({ errors: [{ message: "boom" }] })).toThrow(/boom/);
    expect(() => parseEgressBytes({ data: { viewer: {} } })).toThrow(/viewer\.accounts/);
    expect(() =>
      parseEgressBytes({ data: { viewer: { accounts: [{ otherDataset: [] }] } } }),
    ).toThrow(/callsTurnUsageAdaptiveGroups/);
  });
});

describe("KV watermarks (once per month per threshold)", () => {
  it("readWatermarkMonth returns the stored month, or null when never alerted", async () => {
    const kv = new MemoryKv();
    expect(await readWatermarkMonth(kv, 10)).toBeNull();
    kv.entries().set("last-alerted:10", "2026-08");
    expect(await readWatermarkMonth(kv, 10)).toBe("2026-08");
  });

  it("readWatermarkMonth fails open (null) when the KV read throws", async () => {
    const kv = new MemoryKv();
    vi.spyOn(kv, "get").mockRejectedValue(new Error("kv down"));
    expect(await readWatermarkMonth(kv, 10)).toBeNull();
  });

  it("updateWatermarks writes one key per alerted threshold for the month", async () => {
    const kv = new MemoryKv();
    await updateWatermarks(kv, [10, 50], "2026-08");
    expect(kv.entries().get("last-alerted:10")).toBe("2026-08");
    expect(kv.entries().get("last-alerted:50")).toBe("2026-08");
    expect(kv.entries().has("last-alerted:90")).toBe(false);
  });

  it("updateWatermarks is a no-op for an empty threshold list", async () => {
    const kv = new MemoryKv();
    await updateWatermarks(kv, [], "2026-08");
    expect(kv.entries().size).toBe(0);
  });

  it("watermark keys use the documented prefix", () => {
    expect(`${WATERMARK_KEY_PREFIX}50`).toBe("last-alerted:50");
  });
});

describe("runWatchdog (end to end, stubbed GraphQL)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("below every threshold: queries analytics, alerts nobody", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify(
            analyticsResponse([{ datetime: "2026-08-01", egressBytes: 5 * BYTES_PER_GIB }]),
          ),
          { status: 200 },
        ),
    );
    const result = await runWatchdog(makeEnv(), NOW);

    expect(result.ok).toBe(true);
    expect(result.month).toBe("2026-08");
    expect(result.egressBytes).toBe(5 * BYTES_PER_GIB);
    expect(result.usagePct).toBe(2.5);
    expect(result.thresholds.map((t) => t.alerted)).toEqual([false, false, false]);

    // Only the analytics call; no webhook POSTs.
    const calls = fetchCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(TURN_ANALYTICS_ENDPOINT);
  });

  it("crossing 50% alerts exactly the crossed thresholds and records watermarks", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify(
            analyticsResponse([{ datetime: "2026-08-01", egressBytes: 120 * BYTES_PER_GIB }]),
          ),
          { status: 200 },
        ),
    );
    const kv = new MemoryKv();
    const result = await runWatchdog(makeEnv({ TURN_BUDGET: kv }), NOW);

    expect(result.ok).toBe(true);
    expect(result.thresholds.map((t) => t.alerted)).toEqual([true, true, false]);

    // One webhook POST per fired threshold (10% and 50%).
    const calls = fetchCalls(fetchMock);
    const webhookCalls = calls.filter((c) => c.url === "https://alerts.example.net/hook");
    expect(webhookCalls).toHaveLength(2);
    for (const call of webhookCalls) {
      const payload = JSON.parse(String(call.init?.body)) as {
        alert: string;
        thresholdPct: number;
      };
      expect(payload.alert).toBe("turn_budget");
      expect([10, 50]).toContain(payload.thresholdPct);
    }
    expect(kv.entries().get("last-alerted:10")).toBe("2026-08");
    expect(kv.entries().get("last-alerted:50")).toBe("2026-08");
    expect(kv.entries().has("last-alerted:90")).toBe(false);
  });

  it("a threshold already fired this month does not re-alert (once per month)", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify(
            analyticsResponse([{ datetime: "2026-08-01", egressBytes: 30 * BYTES_PER_GIB }]),
          ),
          { status: 200 },
        ),
    );
    const kv = new MemoryKv();
    kv.entries().set("last-alerted:10", "2026-08"); // fired earlier this month

    const result = await runWatchdog(makeEnv({ TURN_BUDGET: kv }), NOW);
    expect(result.thresholds.map((t) => t.alerted)).toEqual([false, false, false]);
    const webhookCalls = fetchCalls(fetchMock).filter((c) => c.url !== TURN_ANALYTICS_ENDPOINT);
    expect(webhookCalls).toHaveLength(0);
  });

  it("crossed thresholds alert again in a NEW month (fresh watermarks)", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify(
            analyticsResponse([{ datetime: "2026-09-01", egressBytes: 30 * BYTES_PER_GIB }]),
          ),
          { status: 200 },
        ),
    );
    const kv = new MemoryKv();
    kv.entries().set("last-alerted:10", "2026-08"); // last month

    const result = await runWatchdog(makeEnv({ TURN_BUDGET: kv }), Date.UTC(2026, 8, 1, 9, 0, 0));
    expect(result.thresholds.map((t) => t.alerted)).toEqual([true, false, false]);
    expect(kv.entries().get("last-alerted:10")).toBe("2026-09");
  });

  it("ALERT_WEBHOOK_URL unset: alerts go to console.log, no webhook POST", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify(
            analyticsResponse([{ datetime: "2026-08-01", egressBytes: 30 * BYTES_PER_GIB }]),
          ),
          { status: 200 },
        ),
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await runWatchdog(makeEnv({ ALERT_WEBHOOK_URL: undefined }), NOW);
    expect(result.thresholds.map((t) => t.alerted)).toEqual([true, false, false]);
    expect(fetchCalls(fetchMock)).toHaveLength(1); // analytics only
    expect(logSpy).toHaveBeenCalled();
  });

  it("analytics unreachable: logs and skips the run (no alert, no throw)", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const result = await runWatchdog(makeEnv(), NOW);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("analytics_unreachable");
    expect(result.thresholds).toEqual([]);
  });

  it("analytics non-2xx: logs and skips the run", async () => {
    fetchMock.mockImplementation(async () => new Response("nope", { status: 401 }));
    const result = await runWatchdog(makeEnv(), NOW);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("analytics_http_401");
  });

  it("analytics returns GraphQL errors: logs and skips the run", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ errors: [{ message: "bad query" }] }), { status: 200 }),
    );
    const result = await runWatchdog(makeEnv(), NOW);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("analytics_invalid");
  });

  it("missing account id or token: misconfigured, no analytics call", async () => {
    const result = await runWatchdog(makeEnv({ CLOUDFLARE_ACCOUNT_ID: "" }), NOW);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("misconfigured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("postAlert POSTs the JSON payload to the webhook", async () => {
    fetchMock.mockImplementation(async () => new Response("ok", { status: 200 }));
    const alert = buildAlertMessage({
      month: "2026-08",
      pct: 90,
      egressBytes: 180 * BYTES_PER_GIB,
      budgetGiB: 200,
      now: NOW,
    });
    await postAlert(makeEnv(), alert);
    const call = fetchCalls(fetchMock)[0];
    expect(call?.url).toBe("https://alerts.example.net/hook");
    expect(call?.init?.method).toBe("POST");
    expect(JSON.parse(String(call?.init?.body))).toEqual(alert);
  });
});
