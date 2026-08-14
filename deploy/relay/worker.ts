/**
 * Scoped CORS relay for classic rocketcrab room-creation endpoints
 * (rocketcrab-9fv.7.7.5).
 *
 * 16 of the 22 ported classic games create rooms by fetching third-party
 * endpoints that send no Access-Control-Allow-Origin headers, so the
 * browser-side fetch in apps/nova/src/lib/classic/games.ts fails (CORS).
 * This worker forwards those room-creation requests from the server and
 * returns the upstream JSON with CORS headers echoing the allowlisted
 * origin — the same one-tiny-serverless-endpoint pattern as the TURN
 * credential endpoint (rocketcrab-23s).
 *
 * SAFETY (defense in depth, mirroring deploy/turn-creds/worker.ts):
 *   1. Origin allowlist + CORS (rocketcrab-9fv.3.5): any request whose
 *      Origin is missing or not in ORIGIN_ALLOWLIST gets 403 BEFORE any
 *      forwarding. Missing Origin (curl, non-browser clients) is rejected
 *      too — the relay exists to fix browser CORS, and non-browser clients
 *      can fetch the allowlisted upstream endpoints directly. CORS headers
 *      echo the allowlisted origin (never "*"; Vary: Origin) so caches
 *      revalidate per origin. See README.md for the full rationale.
 *   2. Endpoint allowlist: forwards only to the exact endpoints in
 *      RELAY_ENDPOINTS, selected by a fixed key. Never an open proxy;
 *      unknown endpoints get 404. The upstream method is fixed per
 *      endpoint (clients cannot change it), and interpolated path params
 *      (netgames.io game ids) are validated against a strict charset.
 *   3. Per-IP rate limiting (rocketcrab-9fv.3.5): in-worker fixed-window
 *      counter (RATE_LIMIT_PER_MIN, default 20/min), rejecting with
 *      429 + Retry-After BEFORE any forwarding. Per-isolate state is the
 *      fast-fail backstop; over-counting under concurrency is safe (it
 *      only ever rejects more aggressively).
 *
 * Self-contained on purpose (zero imports): drop this single file into any
 * Workers-compatible runtime (Cloudflare Workers, Deno Deploy, ...). Keep
 * the endpoint keys in sync with RELAY_ENDPOINT_KEYS in
 * apps/nova/src/lib/classic/relay.ts (a sync test enforces it).
 *
 * Deployed: Cloudflare Worker "rocketcrab-cors-relay" (7.33), live at
 * https://rocketcrab-cors-relay.tannerkrewson.workers.dev, via the GitHub
 * Actions pipeline in .github/workflows/relay.yml (wrangler). See
 * deploy/relay/README.md.
 */

/** One allowlisted classic room-creation endpoint. */
export interface RelayEndpoint {
  /** Upstream URL. "{name}" placeholders are filled from request params. */
  url: string;
  /** Upstream request method (fixed per endpoint; clients cannot change it). */
  method: "POST" | "GET";
  /**
   * "json": pass the upstream JSON body through verbatim.
   * "redirect": follow redirects and return { url: <final url> } (netgames.io).
   */
  shape: "json" | "redirect";
}

export const RELAY_ENDPOINTS: Record<string, RelayEndpoint> = {
  "drawphone-new": {
    url: "https://drawphone.tannerkrewson.com/new",
    method: "POST",
    shape: "json",
  },
  "dpk-new": {
    url: "https://dpk.tannerkrewson.com/new",
    method: "POST",
    shape: "json",
  },
  "netgamesio-new": {
    url: "https://netgames.io/games/{urlId}/new",
    method: "GET",
    shape: "redirect",
  },
  "ooc-rocketcrab": {
    url: "https://outofcontext.party/api/v1/rocketcrab",
    method: "POST",
    shape: "json",
  },
  "secret-hitler-netlify": {
    url: "https://inspiring-hugle-c583a0.netlify.app/.netlify/functions/secretHitler",
    method: "POST",
    shape: "json",
  },
  "snakeout-new": {
    url: "https://snakeout.tannerkrewson.com/new",
    method: "POST",
    shape: "json",
  },
  "spyfall-new": {
    url: "https://spyfall.tannerkrewson.com/new",
    method: "POST",
    shape: "json",
  },
  "werewolf-newroom": {
    url: "https://werewolf.uber.space/newRoom",
    method: "POST",
    shape: "json",
  },
};

/** Production origin + local dev origins used when ORIGIN_ALLOWLIST is unset. */
export const DEFAULT_ORIGIN_ALLOWLIST = [
  "https://rocketcrab.com",
  "http://localhost:5173",
  "https://localhost:5173",
  "http://127.0.0.1:5173",
  "https://127.0.0.1:5173",
];

/** Fixed rate-limit window length (milliseconds). */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Requests per minute per IP when RATE_LIMIT_PER_MIN is unset. */
export const DEFAULT_RATE_LIMIT_PER_MIN = 20;

/**
 * Cap on tracked rate-limit keys; past it, expired windows are pruned so a
 * long-lived isolate cannot accumulate unbounded state.
 */
const MAX_RATE_LIMIT_KEYS = 10_000;

/** Worker environment: vars are `string | undefined`; secrets too. */
export interface RelayEnv {
  /** Comma-separated origin allowlist. Unset -> DEFAULT_ORIGIN_ALLOWLIST. */
  ORIGIN_ALLOWLIST?: string;
  /** Requests per minute per client IP. Unset -> 20. */
  RATE_LIMIT_PER_MIN?: string;
}

/** Charset allowed for interpolated path params (e.g. netgames.io game ids). */
const PARAM_CHARSET = /^[A-Za-z0-9-]+$/;

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

const JSON_HEADERS: Record<string, string> = { "Content-Type": "application/json" };

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

/**
 * In-memory fixed-window rate limiter keyed by client IP. Per-isolate state
 * is fine: this is the fast-fail backstop, and over-counting under
 * concurrency is SAFE (it only ever rejects more aggressively).
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

/** Resolve an allowlisted endpoint to its concrete URL, or null when invalid. */
function resolveEndpointUrl(endpointKey: string, pathParams: Record<string, unknown>): URL | null {
  const entry = RELAY_ENDPOINTS[endpointKey];
  if (entry === undefined) return null;
  let url = entry.url;
  for (const [key, raw] of Object.entries(pathParams)) {
    if (typeof raw !== "string" || !PARAM_CHARSET.test(raw)) return null;
    url = url.replaceAll(`{${key}}`, raw);
  }
  if (url.includes("{")) return null; // unfilled template placeholder
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * The relay request handler (Cloudflare Worker `fetch` shape).
 *
 * Request body: { endpoint: <allowlist key>, body?: <JSON to forward>,
 * <pathParams>? }. Response: upstream JSON passthrough (json shape) or
 * { url } (redirect shape), with CORS headers echoing the allowlisted
 * origin on every response after the origin check.
 *
 * Checks run in order: origin allowlist (403, no CORS headers on purpose) →
 * CORS preflight (204) → method (405) → per-IP rate limit (429) → body
 * parse (400) → endpoint allowlist (404) → forwarding (502 on upstream
 * failure). Nothing is ever forwarded to a disallowed origin or a
 * rate-limited IP.
 */
export async function handleRelayRequest(request: Request, env: RelayEnv = {}): Promise<Response> {
  // 1. Origin allowlist: reject BEFORE any forwarding. No CORS headers on
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

  // 3. Per-IP rate limit (fast-fail backstop): reject BEFORE any forwarding.
  // Over-counting under concurrency is safe.
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

  // 4. Parse the request envelope.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_json", "invalid JSON body", cors);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonError(400, "invalid_body", "body must be a JSON object", cors);
  }
  const { endpoint, body: payload, ...pathParams } = body as Record<string, unknown>;
  if (typeof endpoint !== "string") {
    return jsonError(400, "missing_endpoint", "missing endpoint", cors);
  }
  const entry = RELAY_ENDPOINTS[endpoint];
  if (entry === undefined) {
    return jsonError(404, "unknown_endpoint", `unknown endpoint "${endpoint}"`, cors);
  }
  const target = resolveEndpointUrl(endpoint, pathParams);
  if (target === null) {
    return jsonError(400, "invalid_params", "invalid endpoint params", cors);
  }

  // 5. Forward to the allowlisted endpoint only.
  try {
    if (entry.method === "GET") {
      const upstream = await fetch(target.toString(), { redirect: "follow" });
      if (!upstream.ok) {
        return jsonError(502, "upstream_error", `upstream HTTP ${upstream.status}`, cors);
      }
      return jsonResponse(200, { url: upstream.url }, cors);
    }

    const upstream = await fetch(target.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    if (!upstream.ok) {
      return jsonError(502, "upstream_error", `upstream HTTP ${upstream.status}`, cors);
    }
    const text = await upstream.text();
    return jsonResponse(200, parseJson(text), cors);
  } catch {
    return jsonError(502, "upstream_unavailable", "upstream endpoint is unavailable", cors);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

export default {
  fetch: (request: Request, env: RelayEnv): Promise<Response> => handleRelayRequest(request, env),
};
