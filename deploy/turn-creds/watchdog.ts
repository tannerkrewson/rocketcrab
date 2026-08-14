/**
 * TURN usage watchdog for the Rocketcrab turn-creds worker (beads
 * rocketcrab-23s.5). Runs on a daily cron (wrangler `[triggers] crons`,
 * 09:00 UTC) and on demand via `GET /__watchdog` on the worker. It queries
 * the Cloudflare Realtime TURN analytics dataset (`callsTurnUsageAdaptiveGroups`
 * on the standard GraphQL Analytics API, https://api.cloudflare.com/client/v4/graphql)
 * for the current calendar month, sums `egressBytes` (the direction
 * Cloudflare bills for), and alerts when usage crosses 10% / 50% / 90% of
 * `WATCHDOG_GB_BUDGET`. Each threshold fires exactly once per month, tracked
 * by a KV watermark (`last-alerted:<pct>` in the TURN_BUDGET namespace).
 *
 * This is an ALERTING watchdog, not a hard stop: if the analytics API is
 * unreachable it logs and skips the run. The hard stop stays the mint
 * budget kill-switch (rocketcrab-23s.4) — counter-based and independent of
 * analytics. See README.md ("Watchdog") for thresholds, secrets, and the
 * verify-at-deploy note for the GraphQL dataset naming.
 *
 * Same style as worker.ts: no external imports, pure exported functions
 * (computeUsageBuckets, shouldAlert, buildAlertMessage, updateWatermarks,
 * parseEgressBytes, buildUsageQuery) plus one thin orchestration function
 * (runWatchdog). See watchdog.test.ts.
 */

import type { KvStore } from "./worker";

/** Standard Cloudflare GraphQL Analytics API endpoint (not a secret). */
export const TURN_ANALYTICS_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

/**
 * Realtime TURN usage dataset node on `viewer.accounts` — verified against
 * the Cloudflare Realtime TURN analytics docs (developers.cloudflare.com/
 * realtime/turn/analytics). Account-scoped, grouped via `dimensions` and
 * aggregated via `sum` / `avg`.
 */
export const TURN_USAGE_DATASET = "callsTurnUsageAdaptiveGroups";

/** Billed direction: bytes sent from TURN servers to clients. */
export const TURN_EGRESS_FIELD = "egressBytes";

/** Default monthly egress budget (GiB) when WATCHDOG_GB_BUDGET is unset. */
export const DEFAULT_GB_BUDGET = 200;

/** Alert thresholds as percent of budget; each fires once per month. */
export const ALERT_THRESHOLDS_PCT = [10, 50, 90] as const;

/** KV watermark key prefix; full key: `last-alerted:<pct>`, value: YYYY-MM. */
export const WATERMARK_KEY_PREFIX = "last-alerted:";

/** Bytes per GiB (binary; adjust WATCHDOG_GB_BUDGET if you track decimal GB). */
export const BYTES_PER_GIB = 1024 ** 3;

/** Max rows requested from the dataset (a month of day rows is <= 31). */
const ANALYTICS_QUERY_LIMIT = 10_000;

/** Watchdog environment (subset of the worker's env; shared with worker.ts). */
export interface WatchdogEnv {
  /** Cloudflare account id for the GraphQL `accountTag` filter (Worker secret). */
  CLOUDFLARE_ACCOUNT_ID?: string;
  /** Cloudflare API token with the "Account Analytics" permission (Worker secret). */
  CLOUDFLARE_API_TOKEN?: string;
  /** Monthly egress budget in GiB. Unset -> DEFAULT_GB_BUDGET (200). */
  WATCHDOG_GB_BUDGET?: string;
  /** Alert webhook URL. Unset -> alerts go to console.log only. */
  ALERT_WEBHOOK_URL?: string;
  /** KV namespace binding (TURN_BUDGET) holding the alert watermarks. */
  TURN_BUDGET?: KvStore;
}

/** UTC month key (YYYY-MM) for a timestamp; watermarks are scoped per month. */
export function monthKey(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

/** First day of the month (YYYY-MM-01): the analytics date filter lower bound. */
export function monthStartKey(now: number): string {
  return `${monthKey(now)}-01`;
}

/** Today (YYYY-MM-DD): the analytics date filter upper bound. */
export function todayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Parse WATCHDOG_GB_BUDGET: a positive number, defaulting when unset/invalid. */
export function parseGbBudget(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_GB_BUDGET;
  const parsed = Number.parseFloat(raw);
  return Number.isNaN(parsed) || parsed <= 0 ? DEFAULT_GB_BUDGET : parsed;
}

/** Egress bytes at `pct` percent of a budget of `budgetBytes`. */
export function thresholdBytes(budgetBytes: number, pct: number): number {
  return (budgetBytes * pct) / 100;
}

/** One alert threshold's usage state for the month. */
export interface UsageBucket {
  pct: number;
  egressBytesAtThreshold: number;
  crossed: boolean;
}

/** For each alert threshold: whether current egress has crossed it. */
export function computeUsageBuckets(egressBytes: number, budgetBytes: number): UsageBucket[] {
  return ALERT_THRESHOLDS_PCT.map((pct) => ({
    pct,
    egressBytesAtThreshold: thresholdBytes(budgetBytes, pct),
    crossed: egressBytes >= thresholdBytes(budgetBytes, pct),
  }));
}

/**
 * True when usage has crossed `pct` of the budget AND that threshold has
 * not already fired this month (watermarkMonth is the month it last fired,
 * or null when it never fired / the watermark is unreadable).
 */
export function shouldAlert(
  egressBytes: number,
  budgetBytes: number,
  pct: number,
  watermarkMonth: string | null,
  currentMonth: string,
): boolean {
  if (egressBytes < thresholdBytes(budgetBytes, pct)) return false;
  return watermarkMonth !== currentMonth;
}

/** Alert payload POSTed to ALERT_WEBHOOK_URL (or console.log when unset). */
export interface WatchdogAlert {
  alert: "turn_budget";
  month: string;
  thresholdPct: number;
  egressBytes: number;
  egressGiB: number;
  budgetGiB: number;
  usagePct: number;
  ts: string;
}

/** Build the structured alert payload for one threshold crossing. */
export function buildAlertMessage(input: {
  month: string;
  pct: number;
  egressBytes: number;
  budgetGiB: number;
  now: number;
}): WatchdogAlert {
  const { month, pct, egressBytes, budgetGiB, now } = input;
  return {
    alert: "turn_budget",
    month,
    thresholdPct: pct,
    egressBytes,
    egressGiB: egressBytes / BYTES_PER_GIB,
    budgetGiB,
    usagePct: (egressBytes / (budgetGiB * BYTES_PER_GIB)) * 100,
    ts: new Date(now).toISOString(),
  };
}

/** Read the stored alert month for a threshold (null when absent/unreadable). */
export async function readWatermarkMonth(
  kv: KvStore | undefined,
  pct: number,
): Promise<string | null> {
  if (kv === undefined) return null;
  try {
    return await kv.get(`${WATERMARK_KEY_PREFIX}${pct}`);
  } catch (err) {
    // Fail open: treat as not alerted so the threshold still fires; alert
    // duplication is acceptable for a watchdog, silence is not.
    console.log(
      `turn-creds watchdog: watermark read failed, treating as not alerted: ${String(err)}`,
    );
    return null;
  }
}

/**
 * Record that `thresholds` fired in `month` (one KV key per threshold).
 * Fail-open: a failed write is logged; the worst case is a duplicate alert
 * on the next run.
 */
export async function updateWatermarks(
  kv: KvStore | undefined,
  thresholds: number[],
  month: string,
): Promise<void> {
  if (kv === undefined || thresholds.length === 0) return;
  try {
    await Promise.all(thresholds.map((pct) => kv.put(`${WATERMARK_KEY_PREFIX}${pct}`, month)));
  } catch (err) {
    console.log(`turn-creds watchdog: watermark write failed: ${String(err)}`);
  }
}

/**
 * Build the GraphQL request for the current month's TURN egress sum.
 *
 * Dataset and field names follow the Cloudflare Realtime TURN analytics
 * docs; the date filters use the standard `date_geq` / `date_leq` (Date
 * scalar, YYYY-MM-DD) and rows are grouped by day (`datetime`), then
 * summed in parseEgressBytes. Verify against the live schema at deploy
 * time (README "Watchdog").
 */
export function buildUsageQuery(
  accountId: string,
  dateFrom: string,
  dateTo: string,
): { query: string; variables: Record<string, string> } {
  return {
    query: `query TurnUsage($accountTag: string, $dateFrom: Date, $dateTo: Date) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      ${TURN_USAGE_DATASET}(
        limit: ${ANALYTICS_QUERY_LIMIT}
        filter: { date_geq: $dateFrom, date_leq: $dateTo }
      ) {
        dimensions {
          datetime
        }
        sum {
          ${TURN_EGRESS_FIELD}
        }
      }
    }
  }
}`,
    variables: { accountTag: accountId, dateFrom, dateTo },
  };
}

/** Shape of the analytics response for the query above. */
interface TurnUsageResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        [dataset: string]: Array<{ sum?: { egressBytes?: number } }>;
      }>;
    };
  };
  errors?: Array<{ message?: string }>;
}

/**
 * Sum `egressBytes` across all returned rows (the month total). Throws
 * when the response is unusable (GraphQL errors, missing account or
 * dataset nodes) so the watchdog can log-and-skip; an empty row set is
 * legitimate (no usage yet) and yields 0.
 */
export function parseEgressBytes(json: unknown): number {
  const root = json as TurnUsageResponse;
  if (Array.isArray(root.errors) && root.errors.length > 0) {
    throw new Error(
      `analytics query failed: ${root.errors.map((e) => e.message ?? "unknown").join("; ")}`,
    );
  }
  const accounts = root.data?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("analytics response missing viewer.accounts");
  }
  const rows = accounts[0]?.[TURN_USAGE_DATASET];
  if (!Array.isArray(rows)) {
    throw new Error(`analytics response missing ${TURN_USAGE_DATASET} rows`);
  }
  let total = 0;
  for (const row of rows) {
    const value = row.sum?.egressBytes;
    if (typeof value === "number" && Number.isFinite(value)) total += value;
  }
  return total;
}

/** POST one alert to ALERT_WEBHOOK_URL; console.log only when unset. */
export async function postAlert(env: WatchdogEnv, alert: WatchdogAlert): Promise<void> {
  const webhook = env.ALERT_WEBHOOK_URL?.trim() ?? "";
  const line = JSON.stringify(alert);
  if (webhook === "") {
    console.log(`turn-creds watchdog alert: ${line}`);
    return;
  }
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: line,
    });
    if (!res.ok) {
      console.log(`turn-creds watchdog: alert webhook returned HTTP ${res.status}`);
    }
  } catch (err) {
    console.log(`turn-creds watchdog: alert webhook failed: ${String(err)}`);
  }
}

/** Result of one watchdog run (returned for the /__watchdog route + tests). */
export interface WatchdogRunResult {
  ok: boolean;
  month: string;
  egressBytes: number | null;
  budgetGiB: number;
  usagePct: number | null;
  thresholds: Array<{ pct: number; crossed: boolean; alerted: boolean }>;
  error?: string;
}

function failed(now: number, budgetGiB: number, error: string): WatchdogRunResult {
  return {
    ok: false,
    month: monthKey(now),
    egressBytes: null,
    budgetGiB,
    usagePct: null,
    thresholds: [],
    error,
  };
}

/**
 * One watchdog pass: query the month's TURN egress, compare against the
 * budget, alert on newly crossed thresholds, and record watermarks.
 * Graceful failure: any analytics problem is logged and skipped (the
 * kill-switch remains the hard stop).
 */
export async function runWatchdog(env: WatchdogEnv, now: number): Promise<WatchdogRunResult> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const token = env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
  if (accountId === "" || token === "") {
    const error = "watchdog misconfigured: CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN missing";
    console.log(`turn-creds watchdog: ${error}`);
    return failed(now, parseGbBudget(env.WATCHDOG_GB_BUDGET), error);
  }

  const month = monthKey(now);
  const budgetGiB = parseGbBudget(env.WATCHDOG_GB_BUDGET);
  const budgetBytes = budgetGiB * BYTES_PER_GIB;

  // 1. Query the TURN analytics dataset for the current month.
  const requestBody = buildUsageQuery(accountId, monthStartKey(now), todayKey(now));
  let res: Response;
  try {
    res = await fetch(TURN_ANALYTICS_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    console.log(`turn-creds watchdog: analytics unreachable, skipping run: ${String(err)}`);
    return failed(now, budgetGiB, "analytics_unreachable");
  }
  if (!res.ok) {
    console.log(`turn-creds watchdog: analytics returned HTTP ${res.status}, skipping run`);
    return failed(now, budgetGiB, `analytics_http_${res.status}`);
  }

  let egressBytes: number;
  try {
    egressBytes = parseEgressBytes(await res.json());
  } catch (err) {
    console.log(`turn-creds watchdog: analytics response invalid, skipping run: ${String(err)}`);
    return failed(now, budgetGiB, "analytics_invalid");
  }

  // 2. Thresholds + watermarks (each threshold fires once per month).
  const buckets = computeUsageBuckets(egressBytes, budgetBytes);
  const alerted: number[] = [];
  const thresholds = [];
  for (const bucket of buckets) {
    const watermarkMonth = await readWatermarkMonth(env.TURN_BUDGET, bucket.pct);
    const alert = shouldAlert(egressBytes, budgetBytes, bucket.pct, watermarkMonth, month);
    thresholds.push({ pct: bucket.pct, crossed: bucket.crossed, alerted: alert });
    if (alert) {
      alerted.push(bucket.pct);
      await postAlert(
        env,
        buildAlertMessage({ month, pct: bucket.pct, egressBytes, budgetGiB, now }),
      );
    }
  }
  await updateWatermarks(env.TURN_BUDGET, alerted, month);

  return {
    ok: true,
    month,
    egressBytes,
    budgetGiB,
    usagePct: (egressBytes / budgetBytes) * 100,
    thresholds,
  };
}
