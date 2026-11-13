/**
 * Nova edge Worker — the only server-side code Nova runs.
 *
 * Browser endpoints:
 *   POST /turn          mint a Cloudflare Realtime TURN credential (turn.ts)
 *   POST /              Classic room-creation CORS relay (relay.ts)
 *   GET /signal/:room   WebSocket signaling through a per-room Durable Object
 *
 * Known routes enforce an Origin allowlist and per-IP rate limiting.
 * Configuration lives in wrangler.toml; the TURN key is a Worker secret.
 * See deploy/cloudflare.md.
 */
import { jsonError } from "./http";
import { handleRelay } from "./relay";
import { handleLog, type LogEnv } from "./log";
import { handleTurn, type TurnEnv } from "./turn";
export { SignalHub } from "./signal";

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface EdgeEnv extends TurnEnv, LogEnv {
  /** Comma-separated exact origins allowed to call the Worker. */
  ORIGIN_ALLOWLIST?: string;
  /** Workers Rate Limiting binding (wrangler.toml `[[ratelimits]]`). */
  RATE_LIMITER?: RateLimitBinding;
  SIGNAL_HUB?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
}

type Handler = (request: Request, env: EdgeEnv) => Promise<Response>;

const ROUTES: Record<string, { handler: Handler; rateLimitKey: string }> = {
  "/turn": { handler: handleTurn, rateLimitKey: "turn" },
  "/log": { handler: handleLog, rateLimitKey: "log" },
  "/": { handler: handleRelay, rateLimitKey: "relay" },
};

/** Fixed window of the platform rate limiter, in seconds. */
const RATE_LIMIT_PERIOD_SECONDS = 60;

export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter((entry) => entry !== "");
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/**
 * True when the request may proceed. A missing binding (unit tests) or a
 * binding failure fails open: a rate-limiter outage must never block a join.
 */
async function withinRateLimit(env: EdgeEnv, key: string): Promise<boolean> {
  if (env.RATE_LIMITER === undefined) return true;
  try {
    return (await env.RATE_LIMITER.limit({ key })).success;
  } catch (error) {
    console.log(`edge: rate limiter failed open: ${String(error)}`);
    return true;
  }
}

async function route(request: Request, env: EdgeEnv): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/(.)\/+$/, "$1");
  const target = ROUTES[path];
  const signal = /^\/signal\/([0-9a-f]{32})$/.exec(path);
  if (target === undefined && signal === null)
    return jsonError(404, "not_found", `no route for ${path}`);

  // No CORS headers on a rejected origin, so other sites cannot read it.
  const origin = request.headers.get("Origin")?.trim().replace(/\/+$/, "") ?? "";
  if (origin === "" || !parseAllowlist(env.ORIGIN_ALLOWLIST).includes(origin)) {
    return jsonError(403, "origin_not_allowed", "request Origin is missing or not allowlisted");
  }
  const cors = corsHeaders(origin);

  if (signal !== null) {
    if (request.method !== "GET") return jsonError(405, "method_not_allowed", "GET required");
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return jsonError(426, "upgrade_required", "WebSocket upgrade required");
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (!(await withinRateLimit(env, `signal:${ip}`)))
      return jsonError(429, "rate_limited", "too many requests; retry in a minute", {
        "Retry-After": String(RATE_LIMIT_PERIOD_SECONDS),
      });
    if (!env.SIGNAL_HUB) return jsonError(503, "unavailable", "signaling unavailable");
    return env.SIGNAL_HUB.get(env.SIGNAL_HUB.idFromName(signal[1]!)).fetch(request);
  }
  if (target === undefined) return jsonError(404, "not_found", `no route for ${path}`);

  let response: Response;
  if (request.method === "OPTIONS") {
    response = new Response(null, { status: 204 });
  } else if (request.method !== "POST") {
    response = jsonError(405, "method_not_allowed", `method ${request.method} is not allowed`);
  } else {
    // Keys are per route, so TURN joins never consume Classic's budget.
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    response = (await withinRateLimit(env, `${target.rateLimitKey}:${ip}`))
      ? await target.handler(request, env)
      : jsonError(429, "rate_limited", "too many requests; retry in a minute", {
          "Retry-After": String(RATE_LIMIT_PERIOD_SECONDS),
        });
  }
  for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
  return response;
}

export default { fetch: route };
