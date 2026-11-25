/**
 * Create external-game rooms whose upstream endpoints lack CORS support. Only the
 * fixed endpoints below are reachable; never act as an open proxy.
 *
 * Request: { endpoint, body?, urlId? }. Return upstream JSON, or the final
 * redirect URL as { url } for netgames.io.
 */
import { BodyTooLargeError, json, jsonError, readBodyText } from "./http";

interface RelayEndpoint {
  url: string;
  /** GET endpoints are followed through redirects and answer { url }. */
  method: "POST" | "GET";
}

const RELAY_ENDPOINTS = {
  "drawphone-new": { url: "https://drawphone.tannerkrewson.com/new", method: "POST" },
  "dpk-new": { url: "https://dpk.tannerkrewson.com/new", method: "POST" },
  "netgamesio-new": { url: "https://netgames.io/games/{urlId}/new", method: "GET" },
  "ooc-rocketcrab": { url: "https://outofcontext.party/api/v1/rocketcrab", method: "POST" },
  "secret-hitler-netlify": {
    url: "https://inspiring-hugle-c583a0.netlify.app/.netlify/functions/secretHitler",
    method: "POST",
  },
  "snakeout-new": { url: "https://snakeout.tannerkrewson.com/new", method: "POST" },
  "spyfall-new": { url: "https://spyfall.tannerkrewson.com/new", method: "POST" },
  "werewolf-newroom": { url: "https://werewolf.uber.space/newRoom", method: "POST" },
} satisfies Record<string, RelayEndpoint>;

export type RelayEndpointKey = keyof typeof RELAY_ENDPOINTS;

const NETGAMES_ORIGIN = "https://netgames.io";
const NETGAMES_IDS = new Set([
  "avalon",
  "love-letter",
  "spyfall",
  "secret-hitler",
  "codewords",
  "onu-werewolf",
  "enigma",
]);
const OOC_GAMES = new Set(["story", "redacted", "recipe"]);
const REQUEST_BYTES = 1024;
const RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 5_000;

async function getNetgamesRoom(url: string, signal: AbortSignal): Promise<string> {
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, { redirect: "manual", signal });
    void response.body?.cancel().catch(() => undefined);
    if (response.ok) return url;
    const location = response.headers.get("Location");
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) break;
    const next = new URL(location, url);
    if (next.origin !== NETGAMES_ORIGIN || next.username || next.password) break;
    url = next.href;
  }
  throw new Error("Invalid room redirect");
}

export async function handleRelay(request: Request): Promise<Response> {
  let envelope: unknown;
  try {
    envelope = JSON.parse(await readBodyText(request.body, REQUEST_BYTES));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return jsonError(413, "too_large", "request too large");
    }
    return jsonError(400, "invalid_json", "invalid JSON body");
  }
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
    return jsonError(400, "invalid_body", "body must be a JSON object");
  }
  const { endpoint, body, urlId } = envelope as Record<string, unknown>;
  const entry =
    typeof endpoint === "string" && Object.hasOwn(RELAY_ENDPOINTS, endpoint)
      ? RELAY_ENDPOINTS[endpoint as RelayEndpointKey]
      : undefined;
  if (entry === undefined) {
    return jsonError(404, "unknown_endpoint", "unknown endpoint");
  }

  let url = entry.url;
  if (url.includes("{urlId}")) {
    if (typeof urlId !== "string" || !NETGAMES_IDS.has(urlId)) {
      return jsonError(400, "invalid_params", "invalid endpoint params");
    }
    url = url.replace("{urlId}", urlId);
  }

  let postBody: string | undefined;
  if (endpoint === "ooc-rocketcrab") {
    const game =
      typeof body === "object" && body !== null ? (body as { game?: unknown }).game : null;
    if (typeof game !== "string" || !OOC_GAMES.has(game)) {
      return jsonError(400, "invalid_params", "invalid endpoint params");
    }
    postBody = JSON.stringify({ game, version: 1 });
  }

  try {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    if (entry.method === "GET") return json(200, { url: await getNetgamesRoom(url, signal) });
    const upstream = await fetch(url, {
      method: "POST",
      // Workers reject "error"; a redirect comes back as a non-OK status instead.
      redirect: "manual",
      signal,
      ...(postBody ? { headers: { "Content-Type": "application/json" }, body: postBody } : {}),
    });
    if (!upstream.ok) {
      console.error({ event: "relay_upstream_error", endpoint, status: upstream.status });
      void upstream.body?.cancel().catch(() => undefined);
      return jsonError(502, "upstream_error", `upstream HTTP ${upstream.status}`);
    }
    const text = await readBodyText(upstream.body, RESPONSE_BYTES);
    try {
      return json(200, JSON.parse(text));
    } catch {
      return json(200, { raw: text });
    }
  } catch (error) {
    console.error({ event: "relay_upstream_unavailable", endpoint, error: String(error) });
    return jsonError(502, "upstream_unavailable", "upstream endpoint is unavailable");
  }
}
