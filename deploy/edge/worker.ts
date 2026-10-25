/**
 * Nova edge Worker — the only server-side process Nova operates.
 *
 * One stateless Cloudflare Worker with two allowlisted browser endpoints:
 *   - POST /turn   mints one short-lived Cloudflare Realtime TURN credential
 *                  (proxies the credentials API; holds the TURN key secret).
 *   - POST /       the scoped Classic CORS relay (unchanged root protocol).
 *
 * Both handlers reject missing/non-allowlisted Origins before doing work and
 * share the origin allowlist. Rate limiting uses the Cloudflare Workers Rate
 * Limiting binding, with an in-memory fallback for local dev/tests. There is
 * no room database, KV, or game code execution.
 *
 * OpenTofu owns the deployed script, its bindings, and the optional route /
 * domain / rate rule. Worker secrets (TURN key) are set out of band.
 */
import { handleRelayRequest, type RelayEnv } from "../relay/worker";
import { handleTurnCredsRequest, type TurnCredsEnv } from "../turn-creds/worker";

export type EdgeEnv = RelayEnv & TurnCredsEnv;

/** Path reserved for TURN credential minting; the relay owns only `/`. */
export const TURN_MINT_PATH = "/turn";

const NOT_FOUND_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

export default {
  fetch(request: Request, env: EdgeEnv): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === TURN_MINT_PATH || pathname === `${TURN_MINT_PATH}/`) {
      return handleTurnCredsRequest(request, env);
    }
    if (pathname === "/") {
      return handleRelayRequest(request, env);
    }
    // Unknown paths are neither the relay protocol nor the mint. Returning
    // here keeps future route names from silently inheriting relay behavior.
    return Promise.resolve(
      new Response(
        JSON.stringify({ error: { code: "not_found", message: `no route for ${pathname}` } }),
        { status: 404, headers: NOT_FOUND_HEADERS },
      ),
    );
  },
};
