/**
 * TURN credential mint endpoint for Rocketcrab Nova (beads rocketcrab-23s,
 * P0). Nova is backendless, so this tiny Cloudflare Worker is the one
 * serverless endpoint that mints SHORT-LIVED TURN credentials at party-join
 * time by proxying Cloudflare Realtime's credentials API:
 *
 *   POST https://rtc.live.cloudflare.com/v1/turn/keys/<TURN_KEY_ID>/credentials/generate-ice-servers
 *   Authorization: Bearer <TURN_KEY_API_TOKEN>
 *   body: { "ttl": 600 }
 *   -> { "iceServers": [ { "urls": [...], "username": "...", "credential": "..." }, ... ] }
 *
 * SAFETY (defense in depth, in request order):
 *   1. Origin allowlist + CORS (rocketcrab-23s.1): any request whose Origin
 *      is missing or not in ORIGIN_ALLOWLIST gets 403 BEFORE the upstream
 *      API is called. Missing Origin (curl, non-browser clients) is rejected
 *      too — the endpoint is browser-only by design.
 *   2. Short TTL (rocketcrab-23s.2): upstream is always called with
 *      { "ttl": 600 } (10 min) and the response's port-53 URLs are dropped
 *      (browsers block port 53 / DNS traffic; ICE would hang on timeouts).
 *   3. Per-IP rate limiting (rocketcrab-23s.3): in-worker fixed-window
 *      counter (fast-fail backstop) + a durable Cloudflare route-level
 *      rate rule (see README.md for the Rulesets curl).
 *
 * The TURN key (TURN_KEY_ID + TURN_KEY_API_TOKEN) is a long-term secret and
 * lives ONLY as a Worker secret — never in code, config, or public JS. The
 * endpoint executes NO game code and keeps NO room-state database
 * (stateless).
 *
 * Self-contained on purpose (zero imports): drop this single file into any
 * Workers-compatible runtime. Logic lives in pure exported functions (parse
 * allowlist, port-53 filter, rate-limit window, upstream request builder)
 * with a thin fetch handler; see worker.test.ts.
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
export const MINT_TTL_SECONDS = 600;

/** Fixed rate-limit window length (milliseconds). */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Requests per minute per IP when RATE_LIMIT_PER_MIN is unset. */
export const DEFAULT_RATE_LIMIT_PER_MIN = 10;

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

/** Structured JSON error: { error: { code, message } }. */
function jsonError(
  status: number,
  code: string,
  message: string,
  cors?: Record<string, string>,
  extra?: Record<string, string>,
): Response {
  return jsonResponse(status, { error: { code, message } }, cors, extra);
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

  // 4. Mint: proxy to the Cloudflare Realtime credentials API with a fixed
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

  return jsonResponse(200, filterPort53IceServers(body), cors);
}

export default { fetch: handleTurnCredsRequest };
