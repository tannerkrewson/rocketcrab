/**
 * Client for the Classic room-creation relay on the Nova edge Worker
 * (deploy/edge/relay.ts). Classic games whose servers send no CORS headers
 * create rooms through it; builds without VITE_EDGE_ORIGIN get a readable
 * error instead of a confusing CORS failure.
 */
import { edgeOrigin } from "../edge";

/** Mirror of the Worker's RELAY_ENDPOINTS keys (deploy/edge/worker.test.ts checks them). */
export const RELAY_ENDPOINT_KEYS = [
  "drawphone-new",
  "dpk-new",
  "netgamesio-new",
  "ooc-rocketcrab",
  "secret-hitler-netlify",
  "snakeout-new",
  "spyfall-new",
  "werewolf-newroom",
] as const;

export type RelayEndpointKey = (typeof RELAY_ENDPOINT_KEYS)[number];

export interface RelayRequestOptions {
  /** JSON payload forwarded to POST endpoints (defaults to {}). */
  body?: unknown;
  /** netgames.io game id for the templated endpoint URL. */
  urlId?: string;
}

/**
 * POSTs one relay request and returns the upstream JSON (or { url } for
 * netgames.io). Throws when the relay is not configured or the request fails.
 */
export async function relayRequest<T>(
  endpoint: RelayEndpointKey,
  { body, urlId }: RelayRequestOptions = {},
): Promise<T> {
  const base = edgeOrigin();
  if (base === "") {
    throw new Error(
      "This game creates rooms through the Rocketcrab edge relay, but this build doesn't set VITE_EDGE_ORIGIN.",
    );
  }
  const res = await fetch(`${base}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint, body, urlId }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: { message?: string } } | null;
      detail = data?.error?.message || detail;
    } catch {
      // Non-JSON error body: keep the status.
    }
    throw new Error(`Room-creation relay request failed (${detail}).`);
  }
  return (await res.json()) as T;
}
