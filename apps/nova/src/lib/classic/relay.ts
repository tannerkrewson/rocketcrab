/**
 * Client side of the scoped CORS relay (rocketcrab-9fv.7.7.5).
 *
 * The relay (deploy/relay/worker.ts) forwards classic room-creation requests
 * to the allowlisted third-party endpoints so the browser never hits their
 * missing CORS headers. It is deployed at VITE_CLASSIC_RELAY_ORIGIN (7.33,
 * currently https://rocketcrab-cors-relay.tannerkrewson.workers.dev): the
 * deploy workflow bakes that origin into the build (same pattern as
 * VITE_RUNTIME_ORIGIN, M2), and the strict CSP (apps/nova/vite.config.ts)
 * then allowlists it in connect-src. Classic games whose endpoints send no
 * CORS headers always create rooms through the relay; builds without the
 * env var surface a readable error instead of a confusing CORS failure.
 */

/** Base origin of the scoped CORS relay; "" when the build pins no VITE_CLASSIC_RELAY_ORIGIN. */
export function classicRelayBaseUrl(): string {
  const raw = import.meta.env.VITE_CLASSIC_RELAY_ORIGIN;
  return typeof raw === "string" ? raw.trim() : "";
}

/** True when the relay origin is configured (build-time env). */
export function relayConfigured(): boolean {
  return classicRelayBaseUrl() !== "";
}

/**
 * Client mirror of the worker's allowlist (deploy/relay/worker.ts
 * RELAY_ENDPOINTS). A sync test keeps the two lists identical.
 */
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

export interface RelayRequestOptions {
  /** JSON payload forwarded to POST endpoints (defaults to {}). */
  body?: unknown;
  /** Path params for templated endpoint URLs (e.g. the netgames.io game id). */
  urlId?: string;
}

/**
 * POSTs one relay request for an allowlisted endpoint and returns the parsed
 * JSON response (upstream JSON passthrough, or { url } for redirect-shaped
 * endpoints). Throws when the relay is not configured or the relay/upstream
 * fails.
 */
export async function relayRequest<T>(
  endpoint: string,
  options: RelayRequestOptions = {},
): Promise<T> {
  const base = classicRelayBaseUrl();
  if (base === "") {
    throw new Error(
      "This game creates rooms through the Rocketcrab CORS relay (deploy/relay), but this build " +
        "doesn't set VITE_CLASSIC_RELAY_ORIGIN.",
    );
  }
  const res = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint,
      ...(options.body !== undefined ? { body: options.body } : {}),
      ...(options.urlId !== undefined ? { urlId: options.urlId } : {}),
    }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (typeof data.error === "string" && data.error !== "") detail = data.error;
    } catch {
      // Non-JSON error body; keep the HTTP status detail.
    }
    throw new Error(`CORS relay request failed (${detail}).`);
  }
  return (await res.json()) as T;
}
