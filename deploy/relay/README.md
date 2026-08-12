# Rocketcrab CORS relay (classic room creation)

Scoped CORS relay for classic rocketcrab room-creation endpoints
(beads `rocketcrab-9fv.7.7.5`).

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

## Deploy (NOT DONE — pending provider decision)

Deployment intentionally mirrors the TURN credential endpoint's decision
record (`rocketcrab-23s`): evaluate free/zero-cost options first, surface
any paid-account decision to the user, add rate limiting and origin checks
before production.

1. Deploy `worker.ts` to a Workers-compatible host (e.g. Cloudflare
   Workers, Deno Deploy). It is self-contained (zero imports).
2. Set `VITE_CLASSIC_RELAY_ORIGIN` in the nova deploy workflow to the
   relay's origin.
3. Verify each of the 16 blocked games creates a room through the relay
   from the browser (play each via the `/classic/:gameId` route).
4. Once verified, flip `connectStatus: "blocked"` off in
   `apps/nova/src/lib/classic/games.ts` (the browse UI badge updates
   automatically via `connectBlocked`).
