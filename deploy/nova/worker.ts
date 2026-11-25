// Nova party API. Cloudflare serves static assets outside /api.
import { handleCodeClaim, handleCodeLookup, type CodeEnv } from "./code";
import { jsonError, type ObjectNamespace } from "./http";
import { handleRelay } from "./relay";
import { handleTurn, type TurnEnv } from "./turn";
export { PartyCode } from "./code";
export { SignalHub } from "./signal";
export { TunnelPair } from "./tunnel";

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface EdgeEnv extends TurnEnv, CodeEnv {
  /** Per-client limit for costly or guessable routes: `/turn`, the room relay and party codes. */
  RATE_LIMITER?: RateLimitBinding;
  /**
   * Per-client limit for cheap, high-volume routes: `/signal`, `/tunnel`.
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
  "/api/turn": { handler: handleTurn, key: "turn", limiter: "RATE_LIMITER" },
  "/api/relay": { handler: handleRelay, key: "relay", limiter: "RATE_LIMITER" },
  // Separate keys: members' renewals never spend a guesser-facing lookup budget.
  "/api/code/claim": { handler: handleCodeClaim, key: "code-claim", limiter: "RATE_LIMITER" },
  "/api/code/lookup": { handler: handleCodeLookup, key: "code-lookup", limiter: "RATE_LIMITER" },
};

const SOCKET_ROUTES: { pattern: RegExp; key: string; binding: "SIGNAL_HUB" | "TUNNEL_PAIR" }[] = [
  { pattern: /^\/api\/signal\/([0-9a-f]{32})$/, key: "signal", binding: "SIGNAL_HUB" },
  { pattern: /^\/api\/tunnel\/([0-9a-f]{64})$/, key: "tunnel", binding: "TUNNEL_PAIR" },
];

const RATE_LIMIT_PERIOD_SECONDS = 60;

/**
 * The rate-limit client for an address. One IPv6 subscriber or VPS holds a
 * whole /64, so IPv6 counts by its /64 prefix; IPv4 (mapped too) per address.
 */
export function rateLimitClient(ip: string): string {
  if (!ip.includes(":")) return ip;
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);
  const split = (part: string) => (part === "" ? [] : part.split(":"));
  const [head = "", tail] = ip.toLowerCase().split("::");
  const groups = split(head);
  if (tail !== undefined) {
    const rest = split(tail);
    groups.push(...Array<string>(Math.max(0, 8 - groups.length - rest.length)).fill("0"), ...rest);
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
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
    return (await binding.limit({ key: `${route}:${rateLimitClient(ip)}` })).success;
  } catch {
    console.error({ event: "rate_limiter_unavailable", route });
    return true;
  }
}

function rateLimited(): Response {
  return jsonError(429, "rate_limited", "too many requests; retry in a minute", {
    "Retry-After": String(RATE_LIMIT_PERIOD_SECONDS),
  });
}

async function route(request: Request, env: EdgeEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/(.)\/+$/, "$1");
  const replay = path === "/api/replay";
  const target = ROUTES[path];
  const socket = SOCKET_ROUTES.map((r) => ({ ...r, match: r.pattern.exec(path) })).find(
    (r) => r.match !== null,
  );
  if (!replay && target === undefined && socket === undefined)
    return jsonError(404, "not_found", `no route for ${path}`);

  const origin = request.headers.get("Origin");
  // A no-referrer request can send a null Origin. Fetch Metadata still
  // identifies it as same-origin. WebSocket upgrades carry an exact Origin.
  const sameOrigin =
    origin === url.origin ||
    (socket === undefined &&
      (origin === null || origin === "null") &&
      request.headers.get("Sec-Fetch-Site") === "same-origin");
  if (!sameOrigin) {
    return jsonError(403, "origin_not_allowed", "same-origin request required");
  }

  if (replay) {
    if (request.method !== "GET") return jsonError(405, "method_not_allowed", "GET required");
    const { country, regionCode } =
      (request as Request & { cf?: { country?: string; regionCode?: string } }).cf ?? {};
    const eligible =
      (country === "US" || (country === "CA" && !!regionCode && regionCode !== "QC")) &&
      request.headers.get("Sec-GPC") !== "1";
    return new Response(null, {
      status: eligible ? 204 : 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (socket !== undefined) {
    if (request.method !== "GET") return jsonError(405, "method_not_allowed", "GET required");
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return jsonError(426, "upgrade_required", "WebSocket upgrade required");
    if (!(await withinRateLimit(request, env.BULK_RATE_LIMITER, socket.key))) return rateLimited();
    const namespace = env[socket.binding];
    if (!namespace) {
      console.error({ event: "socket_binding_missing", route: socket.key });
      return jsonError(503, "unavailable", `${socket.key} unavailable`);
    }
    return namespace.get(namespace.idFromName(socket.match![1]!)).fetch(request);
  }

  if (request.method !== "POST") return jsonError(405, "method_not_allowed", "POST required");
  return (await withinRateLimit(request, env[target!.limiter], target!.key))
    ? target!.handler(request, env)
    : rateLimited();
}

export default { fetch: route };
