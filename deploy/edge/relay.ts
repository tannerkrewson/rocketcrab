/**
 * Create external-game rooms whose upstream endpoints lack CORS support. Only the
 * fixed endpoints below are reachable; never act as an open proxy. Keep the
 * client RELAY_ENDPOINT_KEYS mirror in sync (worker.test.ts).
 *
 * Request: { endpoint, body?, urlId? }. Return upstream JSON, or the final
 * redirect URL as { url } for netgames.io.
 */
import { json, jsonError } from "./http";

interface RelayEndpoint {
  url: string;
  /** GET endpoints are followed through redirects and answer { url }. */
  method: "POST" | "GET";
}

export const RELAY_ENDPOINTS: Record<string, RelayEndpoint> = {
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
};

const URL_ID = /^[A-Za-z0-9-]+$/;

export async function handleRelay(request: Request): Promise<Response> {
  let envelope: unknown;
  try {
    envelope = await request.json();
  } catch {
    return jsonError(400, "invalid_json", "invalid JSON body");
  }
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
    return jsonError(400, "invalid_body", "body must be a JSON object");
  }
  const { endpoint, body, urlId } = envelope as Record<string, unknown>;
  const entry = typeof endpoint === "string" ? RELAY_ENDPOINTS[endpoint] : undefined;
  if (entry === undefined) {
    return jsonError(404, "unknown_endpoint", `unknown endpoint "${String(endpoint)}"`);
  }

  let url = entry.url;
  if (url.includes("{urlId}")) {
    if (typeof urlId !== "string" || !URL_ID.test(urlId)) {
      return jsonError(400, "invalid_params", "invalid endpoint params");
    }
    url = url.replace("{urlId}", urlId);
  }

  try {
    const upstream =
      entry.method === "GET"
        ? await fetch(url, { redirect: "follow" })
        : await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body ?? {}),
          });
    if (!upstream.ok) {
      return jsonError(502, "upstream_error", `upstream HTTP ${upstream.status}`);
    }
    if (entry.method === "GET") return json(200, { url: upstream.url });
    const text = await upstream.text();
    try {
      return json(200, JSON.parse(text));
    } catch {
      return json(200, { raw: text });
    }
  } catch {
    return jsonError(502, "upstream_unavailable", "upstream endpoint is unavailable");
  }
}
