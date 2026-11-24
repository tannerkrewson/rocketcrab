/**
 * TURN credential mint. Proxies Cloudflare Realtime's credentials API so the
 * long-lived TURN key stays a Worker secret and the browser only ever gets a
 * short-lived credential. The client mints once per party and reuses it for
 * reconnects (apps/nova/src/lib/party/turn-creds.ts).
 */
import { json, jsonError } from "./http";

export interface TurnEnv {
  /** Cloudflare Realtime TURN key id (Worker secret). */
  TURN_KEY_ID?: string;
  /** Cloudflare Realtime TURN key API token (Worker secret). */
  TURN_KEY_API_TOKEN?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_REQUIRED?: string;
}

export const MINT_TTL_SECONDS = 4 * 60 * 60;

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * True when an ICE URL uses port 53, which browsers block (ICE would hang).
 * Ports are compared exactly so `turns:host:5349` is kept.
 */
export function isPort53IceUrl(url: string): boolean {
  const beforeQuery = url.split("?")[0] ?? url;
  return beforeQuery
    .slice(beforeQuery.lastIndexOf(":") + 1)
    .split("|")
    .includes("53");
}

export function dropPort53(servers: IceServer[]): IceServer[] {
  return servers.flatMap((server) => {
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(
      (url) => typeof url === "string" && !isPort53IceUrl(url),
    );
    return urls.length === 0 ? [] : [{ ...server, urls }];
  });
}

async function verifyChallenge(request: Request, secret: string): Promise<boolean> {
  const token = request.headers.get("X-Turnstile-Token");
  if (!token || token.length > 2048) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
    } | null;
    return (
      result?.success === true &&
      result.hostname === new URL(request.url).hostname &&
      result.action === "mint_turn"
    );
  } catch {
    return false;
  }
}

export async function handleTurn(request: Request, env: TurnEnv): Promise<Response> {
  const keyId = env.TURN_KEY_ID?.trim() ?? "";
  const token = env.TURN_KEY_API_TOKEN?.trim() ?? "";
  if (keyId === "" || token === "") {
    return jsonError(500, "worker_misconfigured", "TURN key secrets are not configured");
  }

  const turnstileSecret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!turnstileSecret && env.TURNSTILE_REQUIRED === "true") {
    return jsonError(500, "worker_misconfigured", "TURN verification is not configured");
  }
  if (turnstileSecret && !(await verifyChallenge(request, turnstileSecret))) {
    return jsonError(403, "verification_failed", "TURN verification failed");
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: MINT_TTL_SECONDS }),
      },
    );
  } catch {
    return jsonError(502, "upstream_unavailable", "TURN credentials service is unavailable");
  }
  if (!upstream.ok) {
    return jsonError(502, "upstream_error", `TURN credentials service returned ${upstream.status}`);
  }

  const body = (await upstream.json().catch(() => null)) as { iceServers?: unknown } | null;
  if (!Array.isArray(body?.iceServers)) {
    return jsonError(502, "upstream_invalid", "TURN credentials service returned bad JSON");
  }

  // Credentials are never logged; this line feeds Workers Logs usage review.
  console.log(
    JSON.stringify({
      event: "turn_cred_mint",
      ip: request.headers.get("CF-Connecting-IP"),
      origin: request.headers.get("Origin"),
    }),
  );
  return json(200, { iceServers: dropPort53(body.iceServers as IceServer[]) });
}
