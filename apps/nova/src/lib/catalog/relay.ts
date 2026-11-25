/** Room creation for games whose servers send no CORS headers. */
import type { RelayEndpointKey } from "../../../../../deploy/nova/relay";

export type { RelayEndpointKey } from "../../../../../deploy/nova/relay";

export interface RelayRequestOptions {
  /** JSON payload forwarded to POST endpoints (defaults to {}). */
  body?: unknown;
  /** netgames.io game id for the templated endpoint URL. */
  urlId?: string;
}

/**
 * POSTs one relay request and returns the upstream JSON (or { url } for
 * netgames.io).
 */
export async function relayRequest<T>(
  endpoint: RelayEndpointKey,
  { body, urlId }: RelayRequestOptions = {},
): Promise<T> {
  const res = await fetch("/api/relay", {
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
