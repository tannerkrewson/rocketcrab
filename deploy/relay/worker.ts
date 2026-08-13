/**
 * Scoped CORS relay for classic rocketcrab room-creation endpoints
 * (rocketcrab-9fv.7.7.5).
 *
 * 16 of the 22 ported classic games create rooms by fetching third-party
 * endpoints that send no Access-Control-Allow-Origin headers, so the
 * browser-side fetch in apps/nova/src/lib/classic/games.ts fails (CORS).
 * This worker forwards those room-creation requests from the server and
 * returns the upstream JSON with permissive CORS headers, exactly like the
 * one-tiny-serverless-endpoint pattern planned for the TURN credential
 * endpoint (rocketcrab-23s).
 *
 * SAFETY: the relay is NOT an open proxy. It only ever forwards to the
 * exact allowlisted endpoints below, selected by a fixed key; the upstream
 * method is fixed per endpoint; request bodies are passed through only to
 * those endpoints; and any interpolated path params are validated against a
 * strict charset.
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

/** CORS headers on every response so the browser can read the result. */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const JSON_HEADERS: Record<string, string> = { "Content-Type": "application/json" };

/** Charset allowed for interpolated path params (e.g. netgames.io game ids). */
const PARAM_CHARSET = /^[A-Za-z0-9-]+$/;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...CORS_HEADERS },
  });
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
 * { url } (redirect shape), with CORS headers on every response.
 */
export async function handleRelayRequest(request: Request): Promise<Response> {
  // Browser preflight for the POSTs below.
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "method not allowed" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "invalid JSON body" });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonResponse(400, { error: "body must be a JSON object" });
  }
  const { endpoint, body: payload, ...pathParams } = body as Record<string, unknown>;
  if (typeof endpoint !== "string") {
    return jsonResponse(400, { error: "missing endpoint" });
  }
  const entry = RELAY_ENDPOINTS[endpoint];
  if (entry === undefined) {
    return jsonResponse(404, { error: `unknown endpoint "${endpoint}"` });
  }
  const target = resolveEndpointUrl(endpoint, pathParams);
  if (target === null) {
    return jsonResponse(400, { error: "invalid endpoint params" });
  }

  if (entry.method === "GET") {
    const upstream = await fetch(target.toString(), { redirect: "follow" });
    if (!upstream.ok) {
      return jsonResponse(502, { error: `upstream HTTP ${upstream.status}` });
    }
    return jsonResponse(200, { url: upstream.url });
  }

  const upstream = await fetch(target.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  if (!upstream.ok) {
    return jsonResponse(502, { error: `upstream HTTP ${upstream.status}` });
  }
  const text = await upstream.text();
  return jsonResponse(200, parseJson(text));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

export default { fetch: handleRelayRequest };
