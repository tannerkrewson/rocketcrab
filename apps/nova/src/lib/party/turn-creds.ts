/**
 * Client side of the TURN credential mint (beads rocketcrab-23s, P0).
 *
 * Nova is backendless, so cross-network WebRTC needs short-lived TURN
 * credentials from the one serverless endpoint the app talks to: the mint
 * (deploy/turn-creds/worker.ts) mints Cloudflare Realtime credentials at
 * party-join time. It is deployed at VITE_TURN_CREDS_ORIGIN (same pattern
 * as VITE_CLASSIC_RELAY_ORIGIN, 7.33): the deploy workflow bakes that
 * origin into the build, and the strict CSP (apps/nova/vite.config.ts)
 * allowlists it in connect-src. Builds without the env var never fetch —
 * parties work exactly as they do today, without TURN.
 *
 * The mint is browser-only by design: `POST {VITE_TURN_CREDS_ORIGIN}/`
 * from the app sends the page's Origin automatically (no credentials, no
 * secrets in the request), and the worker 403s any missing/non-allowlisted
 * Origin before it would mint. The response is Cloudflare's standard
 * `{ iceServers: [{ urls, username, credential }] }` shape (STUN + TURN
 * entries).
 *
 * GRACEFUL DEGRADATION (acceptance criterion): a mint outage (network
 * error, 403, 5xx, timeout — capped at {@link TURN_CREDS_FETCH_TIMEOUT_MS})
 * never blocks a party. {@link fetchTurnCredentials} is TOTAL (never
 * throws): failures come back as `{ ok: false, reason }` and the engine
 * proceeds without TURN, recording a diagnostic/notice.
 *
 * STUN-only entries (no username/credential) are deliberately dropped:
 * Trystero spreads `rtcConfig` over the whole peer config, so
 * `rtcConfig.iceServers` would REPLACE the `turnConfig` entries merged into
 * `iceServers` (and Trystero's default STUN) — passing the mint's plain
 * STUN servers that way would silently disable the TURN we just fetched.
 * The transport already ships default STUN servers, and the minted TURN
 * entries are the point of the endpoint, so only entries carrying
 * short-lived credentials become `turnConfig` (Trystero's
 * `TurnServerConfig` shape: `{ urls, username, credential }`).
 */

/** One ICE server entry in the mint's response (Cloudflare standard shape). */
export interface TurnCredsIceServer {
  readonly urls: string | string[];
  readonly username?: string;
  readonly credential?: string;
}

/**
 * A TURN server the transport accepts via its `turnConfig` hook (Trystero's
 * `TurnServerConfig` shape). Defined locally on purpose — apps/nova may not
 * import `trystero` (ADR-0003; enforced by the root oxlint rule); the shape
 * is structurally identical to what `@rocketcrab/trystero-transport`
 * accepts.
 */
export interface TurnServerConfigLike {
  readonly urls: string | string[];
  readonly username?: string;
  readonly credential?: string;
}

/** Result of a mint fetch; never throws (graceful degradation). */
export type TurnCredentialsResult =
  | { readonly ok: true; readonly turnConfig: readonly TurnServerConfigLike[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Cap on the mint wait. Short enough that a hung mint never delays a party
 * setup meaningfully; the timeout aborts the fetch and degrades to no-TURN.
 */
export const TURN_CREDS_FETCH_TIMEOUT_MS = 4_000;

/** Injectable fetch + timeout (tests pass a stub fetch / short timeout). */
export interface TurnCredsFetchOptions {
  /** Fetch implementation override. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Timeout cap in ms. Defaults to {@link TURN_CREDS_FETCH_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** Base origin of the TURN credential mint; "" when the build pins none. */
export function turnCredsBaseUrl(): string {
  const raw = import.meta.env.VITE_TURN_CREDS_ORIGIN;
  return typeof raw === "string" ? raw.trim() : "";
}

/** True when the mint origin is configured (build-time env). */
export function turnCredsConfigured(): boolean {
  return turnCredsBaseUrl() !== "";
}

/**
 * True when the entry carries short-lived TURN credentials (the point of
 * the mint). Plain STUN entries (no username/credential) are dropped — see
 * the module doc for why they are not passed via `rtcConfig`.
 */
function isAuthenticatedIceServer(entry: unknown): entry is TurnCredsIceServer {
  if (typeof entry !== "object" || entry === null) {
    return false;
  }
  const server = entry as Record<string, unknown>;
  const { urls, username, credential } = server;
  if (typeof urls !== "string" && !Array.isArray(urls)) {
    return false;
  }
  // The mint always mints non-empty credentials; empty strings would be a
  // broken TURN server, so require usable values.
  if (
    typeof username !== "string" ||
    username === "" ||
    typeof credential !== "string" ||
    credential === ""
  ) {
    return false;
  }
  // urls may be a string or an array of strings; keep only well-formed ones
  // (a malformed mint response degrades per-entry, never fails the party).
  if (Array.isArray(urls)) {
    if (urls.length === 0 || !urls.every((url) => typeof url === "string")) {
      return false;
    }
  }
  return true;
}

/**
 * Fetch short-lived TURN credentials from the mint at party-join time.
 *
 * TOTAL (never throws): every failure mode (unconfigured build, network
 * error, HTTP error, timeout, malformed body) resolves to
 * `{ ok: false, reason }` so the party always proceeds without TURN. The
 * request is a simple cross-origin POST (no custom headers) so the browser
 * sends no CORS preflight; the Origin header rides along automatically and
 * the mint 403s anything not allowlisted.
 */
export async function fetchTurnCredentials(
  options: TurnCredsFetchOptions = {},
): Promise<TurnCredentialsResult> {
  const base = turnCredsBaseUrl();
  if (base === "") {
    return {
      ok: false,
      reason: "VITE_TURN_CREDS_ORIGIN is not set in this build.",
    };
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? TURN_CREDS_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(`${base}/`, {
        method: "POST",
        body: "{}",
        signal: controller.signal,
      });
    } catch (error) {
      return {
        ok: false,
        reason: controller.signal.aborted
          ? `the mint did not respond within ${timeoutMs} ms.`
          : `the mint request failed (${error instanceof Error ? error.message : String(error)}).`,
      };
    }
    if (!response.ok) {
      return { ok: false, reason: `the mint returned HTTP ${response.status}.` };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: "the mint returned a non-JSON response." };
    }
    const iceServers = (body as { iceServers?: unknown }).iceServers;
    if (!Array.isArray(iceServers)) {
      return { ok: false, reason: "the mint returned an unexpected response shape." };
    }
    const turnConfig = iceServers.filter(isAuthenticatedIceServer).map((server) => ({
      urls: server.urls,
      username: server.username,
      credential: server.credential,
    }));
    return { ok: true, turnConfig };
  } finally {
    clearTimeout(timer);
  }
}
