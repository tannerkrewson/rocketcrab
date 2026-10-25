/**
 * Nova edge Worker — the only server-side process Nova operates.
 *
 * One stateless Cloudflare Worker with two allowlisted browser endpoints:
 *   - POST /turn   mints one short-lived Cloudflare Realtime TURN credential
 *                  (proxies the credentials API; holds the TURN key secret).
 *   - POST /       the scoped Classic CORS relay (unchanged root protocol).
 *
 * Both handlers reject missing/non-allowlisted Origins before doing work,
 * apply a per-IP in-memory rate limit, and share the same origin allowlist.
 * There is no room database and no game code execution.
 *
 * OpenTofu owns the deployed script, its bindings, and the optional route /
 * domain / rate rule. Worker secrets (TURN key) are set out of band.
 */
import { handleRelayRequest, type RelayEnv } from "../relay/worker";
import { handleTurnCredsRequest, type TurnCredsEnv } from "../turn-creds/worker";

export type EdgeEnv = RelayEnv & TurnCredsEnv;

/** Path reserved for TURN credential minting; every other path is the relay. */
export const TURN_MINT_PATH = "/turn";

export default {
  fetch(request: Request, env: EdgeEnv): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === TURN_MINT_PATH || pathname === `${TURN_MINT_PATH}/`) {
      return handleTurnCredsRequest(request, env);
    }
    return handleRelayRequest(request, env);
  },
};
