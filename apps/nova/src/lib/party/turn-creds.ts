/**
 * The engine mints TURN credentials once per party and reuses them on reconnect.
 * Only credential-bearing ICE servers become Trystero's TURN configuration.
 */
import { consumeChallengeToken, turnstileEnabled } from "./turnstile";

/** One ICE server entry in the mint's response (Cloudflare standard shape). */
export interface TurnCredsIceServer {
  readonly urls: string | string[];
  readonly username?: string;
  readonly credential?: string;
}

/**
 * A TURN server the transport accepts via its `turnConfig` hook (Trystero's
 * `TurnServerConfig` shape). Defined locally on purpose — apps/nova may not
 * import `trystero` (enforced by the root oxlint rule); the shape
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
 * Match the mint Worker's fixed 4-hour TTL. TURN allocations can continue
 * through authenticated refreshes, so retain one credential rather than
 * replacing ICE configuration on live connections (best-effort upstream).
 */
export const TURN_CREDS_TTL_MS = 4 * 60 * 60 * 1000;

/** Injectable fetch + timeout (tests pass a stub fetch / short timeout). */
export interface TurnCredsFetchOptions {
  /** Fetch implementation override. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Timeout cap in ms. Defaults to {@link TURN_CREDS_FETCH_TIMEOUT_MS}. */
  timeoutMs?: number;
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
  if (
    typeof username !== "string" ||
    username === "" ||
    typeof credential !== "string" ||
    credential === ""
  ) {
    return false;
  }
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
 * A failed mint returns a reason and the party proceeds without TURN.
 */
export async function fetchTurnCredentials(
  options: TurnCredsFetchOptions = {},
): Promise<TurnCredentialsResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? TURN_CREDS_FETCH_TIMEOUT_MS;
  const token = await consumeChallengeToken("mint_turn");
  if (turnstileEnabled && !token) {
    return { ok: false, reason: "TURN verification was unavailable." };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl("/api/turn", {
        method: "POST",
        ...(token ? { headers: { "X-Turnstile-Token": token } } : {}),
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
