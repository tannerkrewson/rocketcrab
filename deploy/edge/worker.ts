/**
 * Nova edge Worker — the only server-side code Nova runs.
 *
 * Browser endpoints:
 *   POST /turn          mint a Cloudflare Realtime TURN credential (turn.ts)
 *   POST /              external-game room-creation CORS relay (relay.ts)
 *   POST /log           privacy-limited connection events (log.ts)
 *   GET /signal/:room   WebSocket signaling through a per-room Durable Object
 *   GET /tunnel/:pair   WebSocket fallback tunnel between two peers (tunnel.ts)
 *
 * Known routes enforce an Origin allowlist and per-IP rate limiting.
 * Configuration lives in wrangler.toml; the TURN key is a Worker secret.
 * See deploy/README.md.
 */
import { jsonError } from "./http";
import { handleRelay } from "./relay";
import { handleLog } from "./log";
import { handleTurn, type TurnEnv } from "./turn";
export { SignalHub } from "./signal";
export { TunnelPair } from "./tunnel";

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface ObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

export interface EdgeEnv extends TurnEnv {
  /** Comma-separated exact origins allowed to call the Worker. */
  ORIGIN_ALLOWLIST?: string;
  /** Per-IP limit for costly routes: `/turn` and the room relay. */
  RATE_LIMITER?: RateLimitBinding;
  /**
   * Per-IP limit for cheap, high-volume routes: `/signal`, `/tunnel`, `/log`.
   * A whole school behind one NAT address, every player tunnelling to up to
   * nine neighbours, must fit under it.
   */
  BULK_RATE_LIMITER?: RateLimitBinding;
  SIGNAL_HUB?: ObjectNamespace;
  TUNNEL_PAIR?: ObjectNamespace;
}

type Handler = (request: Request, env: EdgeEnv) => Promise<Response>;
type Limiter = "RATE_LIMITER" | "BULK_RATE_LIMITER";

const ROUTES: Record<string, { handler: Handler; key: string; limiter: Limiter }> = {
  "/turn": { handler: handleTurn, key: "turn", limiter: "RATE_LIMITER" },
  "/log": { handler: handleLog, key: "log", limiter: "BULK_RATE_LIMITER" },
  "/": { handler: handleRelay, key: "relay", limiter: "RATE_LIMITER" },
};

const SOCKET_ROUTES: { pattern: RegExp; key: string; binding: "SIGNAL_HUB" | "TUNNEL_PAIR" }[] = [
  { pattern: /^\/signal\/([0-9a-f]{32})$/, key: "signal", binding: "SIGNAL_HUB" },
  { pattern: /^\/tunnel\/([0-9a-f]{64})$/, key: "tunnel", binding: "TUNNEL_PAIR" },
];

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
async function withinRateLimit(
  request: Request,
  binding: RateLimitBinding | undefined,
  route: string,
): Promise<boolean> {
  if (binding === undefined) return true;
  // Keys are per route, so one route's traffic never spends another's budget.
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  try {
    return (await binding.limit({ key: `${route}:${ip}` })).success;
  } catch (error) {
    console.log(`edge: rate limiter failed open: ${String(error)}`);
    return true;
  }
}

function rateLimited(): Response {
  return jsonError(429, "rate_limited", "too many requests; retry in a minute", {
    "Retry-After": String(RATE_LIMIT_PERIOD_SECONDS),
  });
}

async function route(request: Request, env: EdgeEnv): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/(.)\/+$/, "$1");
  const target = ROUTES[path];
  const socket = SOCKET_ROUTES.map((r) => ({ ...r, match: r.pattern.exec(path) })).find(
    (r) => r.match !== null,
  );
  if (target === undefined && socket === undefined)
    return jsonError(404, "not_found", `no route for ${path}`);

  // No CORS headers on a rejected origin, so other sites cannot read it.
  const origin = request.headers.get("Origin")?.trim().replace(/\/+$/, "") ?? "";
  if (origin === "" || !parseAllowlist(env.ORIGIN_ALLOWLIST).includes(origin)) {
    return jsonError(403, "origin_not_allowed", "request Origin is missing or not allowlisted");
  }

  if (socket !== undefined) {
    if (request.method !== "GET") return jsonError(405, "method_not_allowed", "GET required");
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return jsonError(426, "upgrade_required", "WebSocket upgrade required");
    if (!(await withinRateLimit(request, env.BULK_RATE_LIMITER, socket.key))) return rateLimited();
    const namespace = env[socket.binding];
    if (!namespace) return jsonError(503, "unavailable", `${socket.key} unavailable`);
    return namespace.get(namespace.idFromName(socket.match![1]!)).fetch(request);
  }

  let response: Response;
  if (request.method === "OPTIONS") {
    response = new Response(null, { status: 204 });
  } else if (request.method !== "POST") {
    response = jsonError(405, "method_not_allowed", `method ${request.method} is not allowed`);
  } else {
    response = (await withinRateLimit(request, env[target!.limiter], target!.key))
      ? await target!.handler(request, env)
      : rateLimited();
  }
  for (const [name, value] of Object.entries(corsHeaders(origin)))
    response.headers.set(name, value);
  return response;
}

export default { fetch: route };
