# Rocketcrab CORS relay (classic room creation)

Scoped CORS relay for classic rocketcrab room-creation endpoints
(beads `rocketcrab-9fv.7.7.5`, deployed 2026-08-13 as `7.33`).

**Current deployment:** Cloudflare Worker `rocketcrab-cors-relay`, live at
`https://rocketcrab-cors-relay.tannerkrewson.workers.dev` (workers.dev
enabled; the account's subdomain is `tannerkrewson`).

## Why

16 of the 22 ported classic games create rooms by fetching third-party
endpoints that send no `Access-Control-Allow-Origin` headers, so the
browser-side `connectToGame` fetch in
`apps/nova/src/lib/classic/games.ts` fails with a CORS error. Classic
rocketcrab ran these room creations on its own server; Nova is
backendless, so this worker forwards the room-creation requests from the
server and returns the upstream JSON with permissive CORS headers —
the same "one tiny serverless endpoint" pattern planned for the TURN
credential endpoint (`rocketcrab-23s`).

## Safety

- **Allowlist-only**: forwards to the exact endpoints in
  `RELAY_ENDPOINTS` (worker.ts), selected by a fixed key. Never an open
  proxy; unknown endpoints get 404.
- The upstream method is fixed per endpoint (clients cannot change it),
  and interpolated path params (netgames.io game ids) are validated
  against a strict `[A-Za-z0-9-]` charset.
- Stateless: no room-state database, no game code execution — the relay
  only forwards the room-creation request and returns the JSON.

## Client wiring

- `apps/nova/src/lib/classic/relay.ts` — client helper. When
  `VITE_CLASSIC_RELAY_ORIGIN` is set at build time (same pattern as
  `VITE_RUNTIME_ORIGIN`, M2), CORS-blocked games create rooms through the
  relay; until then they keep the direct fetch and the "room creation
  blocked" browse badge stays accurate.
- `apps/nova/vite.config.ts` — the strict CSP adds the relay origin to
  `connect-src` when `VITE_CLASSIC_RELAY_ORIGIN` is set.
- A sync test (`apps/nova/src/lib/classic/relay-worker.test.ts`) keeps
  the worker allowlist and the client endpoint keys identical.

## Deploy (GitHub Actions -> Cloudflare Workers)

The worker deploys through the standard pipeline in
`.github/workflows/relay.yml` (cloudflare/wrangler-action, runs on pushes
that touch `deploy/relay/**` and via manual dispatch).

1. **Secrets** (repo Settings -> Secrets and variables -> Actions): add
   `CLOUDFLARE_API_TOKEN` (Workers Scripts edit) and
   `CLOUDFLARE_ACCOUNT_ID`. Configuration lives in `wrangler.toml`
   (`name = "rocketcrab-cors-relay"`, `workers_dev = true`).
2. Run the `Deploy classic CORS relay` workflow (manual dispatch, or push
   to `nova` touching `deploy/relay/**`). The worker appears at
   `https://rocketcrab-cors-relay.<your-account-subdomain>.workers.dev`
   (a custom domain can be added later via the Cloudflare dashboard).
3. **Enable in the app**: re-run the `Deploy to GitHub Pages` workflow for
   `origin: nova` with `relay_origin` set to the worker's origin. That
   bakes `VITE_CLASSIC_RELAY_ORIGIN` into the build (the strict CSP in
   `apps/nova/vite.config.ts` adds it to `connect-src` automatically).
4. **Verify**: play each of the 16 previously-blocked games via the
   `/classic/:gameId` route and confirm room creation succeeds through the
   relay (no CORS errors).
5. **Remove the blocked badges**: once verified, flip `connectStatus:
"blocked"` off in `apps/nova/src/lib/classic/games.ts` and delete the
   "room creation blocked" badge + warning copy in
   `apps/nova/src/routes/game.$gameId.tsx` and any other `connectBlocked`
   UI (the browse badge updates automatically via `connectBlocked`).

Before a public release, add origin checks (verify the request Origin is a
Rocketcrab origin) and rate limiting to the worker — see the safety notes
below and the deployment follow-up bead (7.33).
