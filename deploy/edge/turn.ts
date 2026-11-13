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
}

/** 24 h covers a whole party; Cloudflare allows at most 48 h. */
export const MINT_TTL_SECONDS = 86_400;

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

export async function handleTurn(request: Request, env: TurnEnv): Promise<Response> {
  const keyId = env.TURN_KEY_ID?.trim() ?? "";
  const token = env.TURN_KEY_API_TOKEN?.trim() ?? "";
  if (keyId === "" || token === "") {
    return jsonError(500, "worker_misconfigured", "TURN key secrets are not configured");
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
