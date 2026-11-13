/**
 * Client of the TURN credential mint (deploy/edge/turn.ts, `POST
 * {VITE_EDGE_ORIGIN}/turn`). The engine mints once per party at join time
 * and reuses the 24 h credential for reconnects.
 *
 * Never blocks a party: {@link fetchTurnCredentials} never throws, and any
 * failure (unconfigured build, network, HTTP, timeout, bad body) returns
 * `{ ok: false, reason }` so the party proceeds without TURN.
 *
 * Only credential-bearing entries become `turnConfig`: Trystero spreads
 * `rtcConfig` over the whole peer config, so passing the mint's plain STUN
 * entries would replace the TURN servers merged into `iceServers`.
 */
import { edgeOrigin } from "../edge";

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
/**
 * Must match the mint Worker's fixed TTL (24 h). Cloudflare allows at most 48 h
 * per credential; the TURN allocation itself has no maximum duration while the
 * client keeps it alive with authenticated refreshes. One long-lived credential
 * per party removes the old 8-minute re-mint/\`setConfiguration\` machinery,
 * which Nova cannot validate on physical devices and which Cloudflare only
 * supports as best-effort for live connections.
 */
export const TURN_CREDS_TTL_MS = 86_400_000;

/** Injectable fetch + timeout (tests pass a stub fetch / short timeout). */
export interface TurnCredsFetchOptions {
  /** Fetch implementation override. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Timeout cap in ms. Defaults to {@link TURN_CREDS_FETCH_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** True when the mint origin is configured (build-time env). */
export function turnCredsConfigured(): boolean {
  return edgeOrigin() !== "";
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
  const base = edgeOrigin();
  if (base === "") {
    return {
      ok: false,
      reason: "VITE_EDGE_ORIGIN is not set in this build.",
    };
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? TURN_CREDS_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(`${base}/turn`, {
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
    const iceServers =
      typeof body === "object" && body !== null
        ? (body as { iceServers?: unknown }).iceServers
        : undefined;
    if (!Array.isArray(iceServers)) {
      return { ok: false, reason: "the mint returned an unexpected response shape." };
    }
    const turnConfig = iceServers.filter(isAuthenticatedIceServer).map((server) => ({
      urls: server.urls,
      username: server.username,
      credential: server.credential,
    }));
    if (
      !turnConfig.some((server) =>
        (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) =>
          /^turns?:/i.test(url),
        ),
      )
    ) {
      return { ok: false, reason: "the mint returned no usable TURN servers." };
    }
    return { ok: true, turnConfig };
  } finally {
    clearTimeout(timer);
  }
}
