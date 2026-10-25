/**
 * TURN credential mint endpoint for Rocketcrab Nova (task rocketcrab-23s,
 * P0). Nova is backendless, so this tiny Cloudflare Worker is the one
 * serverless endpoint that mints SHORT-LIVED TURN credentials at party-join
 * time by proxying Cloudflare Realtime's credentials API:
 *
 *   POST https://rtc.live.cloudflare.com/v1/turn/keys/<TURN_KEY_ID>/credentials/generate-ice-servers
 *   Authorization: Bearer <TURN_KEY_API_TOKEN>
 *   body: { "ttl": 86400 }
 *   -> { "iceServers": [ { "urls": [...], "username": "...", "credential": "..." }, ... ] }
 *
 * SAFETY (defense in depth, in request order):
 *   1. Origin allowlist + CORS (rocketcrab-23s.1): any request whose Origin
 *      is missing or not in ORIGIN_ALLOWLIST gets 403 BEFORE the upstream
 *      API is called. Missing Origin (curl, non-browser clients) is rejected
 *      too — the endpoint is browser-only by design.
 *   2. One party-lifetime credential (rocketcrab-23s.2): upstream is always
 *      called with { "ttl": 86400 } (24 h; Cloudflare's maximum is 48 h) and
 *      the response's port-53 URLs are dropped (browsers block port 53 / DNS
 *      traffic; ICE would hang on timeouts). There is no allocation-duration
 *      cap, so one credential covers a whole party; the client does not
 *      re-mint or mutate live peer connections.
 *   3. Per-IP rate limiting (rocketcrab-23s.3): in-worker fixed-window
 *      counter (fast-fail backstop) + a durable Cloudflare route-level
 *      rate rule (see README.md for the Rulesets curl).
 *   4. Daily issuance cap (rocketcrab-23s.4): one KV counter in the
 *      TURN_BUDGET namespace (mints:YYYY-MM-DD) is checked BEFORE any
 *      upstream call; at MINT_DAILY_CAP the worker answers 429
 *      budget_exceeded. It is incremented only on successful mints. KV has
 *      no atomic increment, so concurrent mints can over-count — SAFE for a
 *      cap that errs on the safe side. KV unavailable (e.g. binding missing
 *      in dev) FAILS OPEN. This is the only account-wide issuance stop the
 *      per-IP limiter cannot replace; it bounds issuance, not traffic.
 *
 * Usage/cost visibility uses native Cloudflare controls instead of a custom
 * watchdog: account budget alerts (email threshold crossing; informational, not
 * a spending cap) and Billable Usage notifications/metrics. Mint counters here
 * bound issuance only — an already-issued credential can relay until it expires,
 * and Cloudflare documents no allocation-duration cap, only per-allocation
 * throughput limits. Credentials can be revoked upstream if abuse is observed.
 *
 * The TURN key (TURN_KEY_ID + TURN_KEY_API_TOKEN) is a long-term secret and
 * lives ONLY as a Worker secret — never in code, config, or public JS. The
 * endpoint executes NO game code and keeps NO room-state database
 * (stateless).
 *
 * Self-contained on purpose (zero dependencies): worker.ts drops into any
 * Workers-compatible runtime; wrangler bundles it into one script. Logic lives
 * in pure exported functions (parse allowlist, port-53 filter, rate-limit
 * window, budget counters, upstream request builder) with a thin fetch handler;
 * see worker.test.ts.
 */

/** Production origin + local dev origins used when ORIGIN_ALLOWLIST is unset. */
export const DEFAULT_ORIGIN_ALLOWLIST = [
  "https://rocketcrab.com",
  "http://localhost:5173",
  "https://localhost:5173",
  "http://127.0.0.1:5173",
  "https://127.0.0.1:5173",
];

/** Cloudflare Realtime credentials API base (public, not a secret). */
export const TURN_CREDS_API_BASE = "https://rtc.live.cloudflare.com";
/** Upstream path prefix; the TURN key id is interpolated between these. */
export const TURN_CREDS_API_PATH_PREFIX = "/v1/turn/keys/";
/** Credential lifetime requested from Cloudflare (seconds). */
export const MINT_TTL_SECONDS = 86_400; // 24 h; Cloudflare allows at most 48 h.

/** Fixed rate-limit window length (milliseconds). */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Requests per minute per IP when RATE_LIMIT_PER_MIN is unset. */
export const DEFAULT_RATE_LIMIT_PER_MIN = 10;

/** KV key prefix for the daily mint counter (full key: `mints:YYYY-MM-DD`). */
export const MINT_DAILY_KEY_PREFIX = "mints:";
/** Daily mint cap when MINT_DAILY_CAP is unset (rocketcrab-23s.4). */
export const DEFAULT_MINT_DAILY_CAP = 5000;
/** Daily counter keys self-expire after 2 days (stale day keys never linger). */
export const DAILY_COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60;

/**
 * Cap on tracked rate-limit keys; past it, expired windows are pruned so a
 * long-lived isolate cannot accumulate unbounded state.
 */
const MAX_RATE_LIMIT_KEYS = 10_000;

/** Worker environment: vars are `string | undefined`; secrets too. */
export interface TurnCredsEnv {
  /** Comma-separated origin allowlist. Unset -> DEFAULT_ORIGIN_ALLOWLIST. */
  ORIGIN_ALLOWLIST?: string;
  /** Requests per minute per client IP. Unset -> 10. */
  RATE_LIMIT_PER_MIN?: string;
  /** Cloudflare Realtime TURN key id (Worker secret). */
  TURN_KEY_ID?: string;
  /** Cloudflare Realtime TURN key API token (Worker secret). */
  TURN_KEY_API_TOKEN?: string;
  /** Daily mint cap. Unset -> 5000. */
  MINT_DAILY_CAP?: string;
  /** KV namespace binding (TURN_BUDGET) holding the mint counters. */
  TURN_BUDGET?: KvStore;
}

/**
 * The KV binding surface this worker uses (structural subset of Cloudflare's
 * KVNamespace). Declared locally so the worker and its tests do not depend on
 * @cloudflare/workers-types.
 */
export interface KvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** One ICE server entry in Cloudflare's documented response shape. */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Upstream generate-ice-servers response body. */
export interface IceServersResponse {
  iceServers?: IceServer[];
  ttl?: number;
}

/**
 * True when an ICE URL's port list includes exactly 53 (browsers block
 * port 53 / DNS traffic, so those candidates would hang on timeouts).
 *
 * Cloudflare URLs look like "turn:turn.cloudflare.com:3478?transport=udp"
 * or "turns:turn.cloudflare.com:5349|443?transport=tcp". A naive
 * `includes(":53")` would also match the ":5349" fallback port in the
 * documented primary set, so the port list is extracted and compared
 * exactly instead.
 */
export function isPort53IceUrl(url: string): boolean {
  const queryStart = url.indexOf("?");
  const beforeQuery = queryStart === -1 ? url : url.slice(0, queryStart);
  const portList = beforeQuery.slice(beforeQuery.lastIndexOf(":") + 1);
  return portList.split("|").includes("53");
}

/**
 * Drop every ICE server entry whose URLs include a port-53 candidate
 * (both stun: and turn: URLs). Entries with any surviving URL are kept
 * with their username/credential intact; entries whose URLs are all
 * dropped are removed. The iceServers array shape is preserved.
 */
export function filterPort53IceServers(response: IceServersResponse): IceServersResponse {
  const iceServers = (response.iceServers ?? []).flatMap((server) => {
    if (typeof server.urls === "string") {
      return isPort53IceUrl(server.urls) ? [] : [server];
    }
    if (!Array.isArray(server.urls)) return [];
    const urls = server.urls.filter((url) => !isPort53IceUrl(url));
    return urls.length === 0 ? [] : [{ ...server, urls }];
  });
  return { ...response, iceServers };
}

/** Parsed origin allowlist from ORIGIN_ALLOWLIST (or the default). */
export function parseAllowlist(raw: string | undefined): string[] {
  const source = raw === undefined ? "" : raw;
  const entries =
    source === ""
      ? DEFAULT_ORIGIN_ALLOWLIST
      : source
          .split(",")
          .map((e) => e.trim())
          .filter((e) => e !== "");
  // Normalize config entries (trailing slash, host casing) via URL parsing so
  // a stray "/" in the env var cannot break matching; keep the trimmed value
  // when it is not a parseable URL. The request Origin is NOT normalized
  // beyond trimming (see normalizeOrigin) — matching is exact by design.
  return entries.map((e) => {
    try {
      return new URL(e).origin;
    } catch {
      return e;
    }
  });
}

/** Trim the Origin header value; null when absent or empty. */
export function normalizeOrigin(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  // Browsers never serialize a trailing slash in Origin; tolerate one from
  // hand-rolled clients so a curl smoke test behaves like a browser.
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

/** True when `origin` is an exact member of `allowlist`. */
export function originAllowed(origin: string, allowlist: string[]): boolean {
  return allowlist.includes(origin);
}

/** CORS headers that echo the (allowlisted) request origin. */
export function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    // ACAO varies per request origin; must be revalidated by caches.
    Vary: "Origin",
  };
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function jsonResponse(
  status: number,
  body: unknown,
  cors?: Record<string, string>,
  extra?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...cors, ...extra },
  });
}

/** Structured JSON error: { error: { code, message, ...details } }. */
function jsonError(
  status: number,
  code: string,
  message: string,
  cors?: Record<string, string>,
  extra?: Record<string, string>,
  details?: Record<string, unknown>,
): Response {
  return jsonResponse(status, { error: { code, message, ...details } }, cors, extra);
}

/**
 * Parse RATE_LIMIT_PER_MIN: a positive integer, defaulting to
 * DEFAULT_RATE_LIMIT_PER_MIN when unset or invalid.
 */
export function parseRateLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_RATE_LIMIT_PER_MIN;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 1 ? DEFAULT_RATE_LIMIT_PER_MIN : parsed;
}

/**
 * Client IP for rate limiting: CF-Connecting-IP is set by Cloudflare's edge
 * and cannot be spoofed by clients; "unknown" when absent (impossible in
 * production — wrangler dev only).
 */
export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

/** UTC calendar date (YYYY-MM-DD) for a timestamp: the daily counter suffix. */
export function utcDateKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** KV key of the daily mint counter for `now`. */
export function dailyCounterKey(now: number): string {
  return `${MINT_DAILY_KEY_PREFIX}${utcDateKey(now)}`;
}

/** Parse MINT_DAILY_CAP: a positive integer, or `fallback` when unset/invalid. */
export function parseCap(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 1 ? fallback : parsed;
}

/** Next counter value: parse the stored string (0 when absent/unparseable) + 1. */
export function nextCounterValue(stored: string | null): number {
  const current = stored === null ? 0 : Number.parseInt(stored, 10);
  return (Number.isNaN(current) ? 0 : current) + 1;
}

/** True when today's mint count has reached the daily cap. */
export function dailyCapExceeded(daily: number, dailyCap: number): boolean {
  return daily >= dailyCap;
}

// The KV-unavailable warning is logged once per isolate (it would fire on
// every request in dev where the binding is missing).
let warnedKvMissing = false;

function warnKvMissing(): void {
  if (warnedKvMissing) return;
  warnedKvMissing = true;
  console.log(
    "turn-creds: TURN_BUDGET KV binding missing — daily mint cap disabled (fail-open; create the namespace in prod, see README)",
  );
}

/**
 * Read today's mint count. Returns null when the KV binding is missing or the
 * read fails — the cap FAILS OPEN. Fail-open is fine for dev; in prod the
 * binding must exist, and even with it down abuse stays bounded by the per-IP
 * rate limiter while native budget alerts cover spend visibility.
 */
export async function readDailyMints(kv: KvStore | undefined, now: number): Promise<number | null> {
  if (kv === undefined) {
    warnKvMissing();
    return null;
  }
  try {
    const stored = await kv.get(dailyCounterKey(now));
    return Number.parseInt(stored ?? "0", 10) || 0;
  } catch (err) {
    console.log(`turn-creds: mint counter read failed, failing open: ${String(err)}`);
    return null;
  }
}

/**
 * Increment today's mint counter after a SUCCESSFUL mint (KV
 * read-modify-write; KV has NO atomic increment). Concurrent mints can
 * over-count, which is SAFE here: the cap errs on the safe side. Fails open:
 * a failed write is logged, the mint has already happened.
 */
export async function incrementDailyMints(kv: KvStore | undefined, now: number): Promise<void> {
  if (kv === undefined) {
    warnKvMissing();
    return;
  }
  const dailyKey = dailyCounterKey(now);
  try {
    const daily = await kv.get(dailyKey);
    await kv.put(dailyKey, String(nextCounterValue(daily)), {
      expirationTtl: DAILY_COUNTER_TTL_SECONDS,
    });
  } catch (err) {
    console.log(
      `turn-creds: mint counter increment failed (mint already succeeded): ${String(err)}`,
    );
  }
}

/**
 * Log one successful mint for Workers analytics / usage review (IP, origin,
 * ttl, timestamp). No PII beyond the client IP the edge already sees.
 */
export function logMint(request: Request, ttlSeconds: number, now: number): void {
  console.log(
    JSON.stringify({
      event: "turn_cred_mint",
      ip: clientIp(request),
      origin: request.headers.get("Origin") ?? null,
      ttl: ttlSeconds,
      ts: new Date(now).toISOString(),
    }),
  );
}

/**
 * In-memory fixed-window rate limiter keyed by client IP
 * (rocketcrab-23s.3). Per-isolate state is fine: this is the fast-fail
 * backstop, and over-counting under concurrency is SAFE (it only ever
 * rejects more aggressively). The durable backstop is a Cloudflare
 * route-level rate rule (README).
 */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  /**
   * Count one request for `key` in the 60s window containing `now`.
   * Returns { allowed, retryAfterSeconds }; retryAfterSeconds is the
   * seconds until the window resets (only meaningful when denied).
   */
  check(key: string, limit: number, now: number): { allowed: boolean; retryAfterSeconds: number } {
    const current = this.windows.get(key);
    if (current === undefined || now - current.start >= RATE_LIMIT_WINDOW_MS) {
      this.windows.set(key, { start: now, count: 1 });
      this.prune(now);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((current.start + RATE_LIMIT_WINDOW_MS - now) / 1000),
        ),
      };
    }
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Drop expired windows once the key map grows past the cap. */
  private prune(now: number): void {
    if (this.windows.size < MAX_RATE_LIMIT_KEYS) return;
    for (const [key, entry] of this.windows) {
      if (now - entry.start >= RATE_LIMIT_WINDOW_MS) this.windows.delete(key);
    }
  }
}

// Module-level per-isolate limiter (the worker's fast-fail backstop).
let limiter: RateLimiter | undefined;

function getLimiter(): RateLimiter {
  limiter ??= new RateLimiter();
  return limiter;
}

/** Test helper: clear the module-level limiter so tests start from a clean window. */
export function resetRateLimiter(): void {
  limiter = undefined;
}

/**
 * Build the upstream mint request. Returns null when the worker is
 * misconfigured (TURN key secrets missing) so callers can fail loudly.
 * The API token is only ever placed in the Authorization header — never in
 * URLs, bodies, or any response the client can read.
 */
export function buildMintRequest(env: TurnCredsEnv): { url: string; init: RequestInit } | null {
  const keyId = env.TURN_KEY_ID?.trim() ?? "";
  const token = env.TURN_KEY_API_TOKEN?.trim() ?? "";
  if (keyId === "" || token === "") return null;
  const url = `${TURN_CREDS_API_BASE}${TURN_CREDS_API_PATH_PREFIX}${encodeURIComponent(keyId)}/credentials/generate-ice-servers`;
  return {
    url,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: MINT_TTL_SECONDS }),
    },
  };
}

/**
 * The mint request handler (Cloudflare Worker `fetch` shape).
 *
 * Request: any method; only POST is minted, OPTIONS is answered as a CORS
 * preflight. Request bodies are ignored — the client cannot influence the
 * TTL, the TURN key, or anything else. Response: the upstream
 * generate-ice-servers body (iceServers array, standard shape) with CORS
 * headers echoing the allowlisted origin.
 */
export async function handleTurnCredsRequest(
  request: Request,
  env: TurnCredsEnv,
): Promise<Response> {
  // 1. Origin allowlist: reject BEFORE any upstream call. No CORS headers on
  // purpose — a disallowed origin must not be able to read the response.
  const allowlist = parseAllowlist(env.ORIGIN_ALLOWLIST);
  const origin = normalizeOrigin(request.headers.get("Origin"));
  if (origin === null || !originAllowed(origin, allowlist)) {
    return jsonError(403, "origin_not_allowed", "request Origin is missing or not allowlisted");
  }
  const cors = corsHeaders(origin);

  // 2. CORS preflight (browsers send OPTIONS before the POST).
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") {
    return jsonError(405, "method_not_allowed", `method ${request.method} is not allowed`, cors);
  }

  // 3. Per-IP rate limit (fast-fail backstop, rocketcrab-23s.3): reject
  // BEFORE any upstream call. Over-counting under concurrency is safe.
  const rateLimit = parseRateLimit(env.RATE_LIMIT_PER_MIN);
  const { allowed, retryAfterSeconds } = getLimiter().check(
    clientIp(request),
    rateLimit,
    Date.now(),
  );
  if (!allowed) {
    return jsonError(
      429,
      "rate_limited",
      "too many requests; retry after the rate-limit window resets",
      cors,
      { "Retry-After": String(retryAfterSeconds) },
    );
  }

  // 4. Daily issuance cap (rocketcrab-23s.4): the counter is read BEFORE any
  // upstream call. At the cap the worker answers 429. KV unavailable (dev /
  // outage) FAILS OPEN — the check degrades to a no-op with a log.
  const now = Date.now();
  const dailyMints = await readDailyMints(env.TURN_BUDGET, now);
  if (dailyMints !== null) {
    const limit = parseCap(env.MINT_DAILY_CAP, DEFAULT_MINT_DAILY_CAP);
    if (dailyCapExceeded(dailyMints, limit)) {
      return jsonError(
        429,
        "budget_exceeded",
        `mint budget exhausted: daily cap (${limit}) reached for ${utcDateKey(now)}`,
        cors,
        undefined,
        { cap: "daily", limit },
      );
    }
  }

  // 5. Mint: proxy to the Cloudflare Realtime credentials API with a fixed
  // short TTL (rocketcrab-23s.2), then drop port-53 URLs from the response
  // (browsers block port 53). Never leak the API token in any response.
  const upstream = buildMintRequest(env);
  if (upstream === null) {
    return jsonError(
      500,
      "worker_misconfigured",
      "TURN_KEY_ID or TURN_KEY_API_TOKEN is not configured",
      cors,
    );
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstream.url, upstream.init);
  } catch {
    return jsonError(
      502,
      "upstream_unavailable",
      "upstream TURN credentials service is unavailable",
      cors,
    );
  }
  if (!upstreamResponse.ok) {
    return jsonError(
      502,
      "upstream_error",
      `upstream TURN credentials service returned HTTP ${upstreamResponse.status}`,
      cors,
    );
  }

  let body: IceServersResponse;
  try {
    body = (await upstreamResponse.json()) as IceServersResponse;
  } catch {
    return jsonError(
      502,
      "upstream_invalid",
      "upstream TURN credentials service returned invalid JSON",
      cors,
    );
  }
  if (!Array.isArray(body.iceServers)) {
    return jsonError(
      502,
      "upstream_invalid",
      "upstream TURN credentials service returned an unexpected shape",
      cors,
    );
  }

  // Count every SUCCESSFUL mint: increment both KV counters (kill-switch
  // bookkeeping, rocketcrab-23s.4) and log the mint for Workers analytics
  // / usage review (IP, origin, ttl, timestamp). Both are best-effort — the
  // credentials are already minted and must not be lost to a KV hiccup.
  await incrementDailyMints(env.TURN_BUDGET, now);
  logMint(request, MINT_TTL_SECONDS, now);

  return jsonResponse(200, filterPort53IceServers(body), cors);
}

export default {
  fetch: (request: Request, env: TurnCredsEnv): Promise<Response> =>
    handleTurnCredsRequest(request, env),
};
