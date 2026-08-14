# Rocketcrab CORS relay (classic room creation)

Scoped CORS relay for classic rocketcrab room-creation endpoints
(beads `rocketcrab-9fv.7.7.5`, deployed 2026-08-13 as `7.33`; hardened
2026-08 with origin allowlist + per-IP rate limiting, `rocketcrab-9fv.3.5`).

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
server and returns the upstream JSON with CORS headers echoing the
allowlisted origin — the same "one tiny serverless endpoint" pattern as the
TURN credential endpoint (`rocketcrab-23s`).

## Safety

**Abuse-controlled, defense in depth (mirrors `deploy/turn-creds/worker.ts`):**

- **Origin allowlist** (`ORIGIN_ALLOWLIST`, `rocketcrab-9fv.3.5`): requests
  whose `Origin` is missing or not allowlisted get `403` **before** any
  forwarding. The relay is browser-only by design (see "Origin allowlist and
  CORS" below).
- **Endpoint allowlist**: forwards to the exact endpoints in
  `RELAY_ENDPOINTS` (worker.ts), selected by a fixed key. Never an open
  proxy; unknown endpoints get 404.
- The upstream method is fixed per endpoint (clients cannot change it),
  and interpolated path params (netgames.io game ids) are validated
  against a strict `[A-Za-z0-9-]` charset.
- **Per-IP rate limiting** (`RATE_LIMIT_PER_MIN`, `rocketcrab-9fv.3.5`): an
  in-worker fixed-window fast-fail check answers `429` + `Retry-After`
  before any forwarding (see "Rate limiting" below).
- Stateless: no room-state database, no game code execution — the relay
  only forwards the room-creation request and returns the JSON.

## Environment variables

| Variable             | Default                                                                                                            | Meaning                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ORIGIN_ALLOWLIST`   | `https://rocketcrab.com,http://localhost:5173,https://localhost:5173,http://127.0.0.1:5173,https://127.0.0.1:5173` | Comma-separated origins allowed to use the relay. Each entry may be a full origin (`scheme://host[:port]`); a trailing slash is tolerated. Matching against the request `Origin` is exact. |
| `RATE_LIMIT_PER_MIN` | `20`                                                                                                               | Requests per minute per client IP allowed by the in-worker fast-fail counter (60s fixed window).                                                                                           |

A single-variable env override (unset = the default above). Neither variable
is sensitive — they can live in `[vars]` in `wrangler.toml` or as plain
`wrangler var set`:

```sh
wrangler var set ORIGIN_ALLOWLIST "https://rocketcrab.com,https://staging.rocketcrab.com"
wrangler var set RATE_LIMIT_PER_MIN 20
```

The defaults match the app's real origins: `https://rocketcrab.com` is the
production app (GitHub Pages), and the `:5173` localhost/127.0.0.1 entries
are the Vite dev server (including `npm run dev:https`). The Nova app always
sends its own origin on the cross-origin relay `fetch`
(`apps/nova/src/lib/classic/relay.ts`), so no other origin is needed in
production.

## Origin allowlist and CORS (`rocketcrab-9fv.3.5`)

- Read `Origin`; missing or not in `ORIGIN_ALLOWLIST` → `403` structured
  JSON (`{"error":{"code":"origin_not_allowed",...}}`), **no forwarding**.
  The `403` deliberately carries no CORS headers, so a disallowed origin's
  browser shows a plain CORS error instead of reading anything.
- Allowlisted origin: CORS headers echo the exact origin
  (`Access-Control-Allow-Origin: <origin>`, `Vary: Origin`), `POST` +
  `Content-Type` are allowed, and `OPTIONS` preflights get `204` with the
  same headers.
- **Missing Origin is rejected** (defense in depth): curl and other
  non-browser clients cannot drive the relay, even with a valid allowlist.
  This is deliberate — the relay exists to fix browser CORS, the app always
  sends `Origin`, and non-browser clients can fetch the allowlisted upstream
  endpoints directly. There is therefore no "no-Origin but permitted" case:
  CORS headers are **never** `Access-Control-Allow-Origin: *`; they always
  echo the allowlisted origin. (A wildcard would also be wrong for
  per-origin cache revalidation, hence `Vary: Origin`.)

## Rate limiting (`rocketcrab-9fv.3.5`)

An in-worker **fixed-window counter keyed by client IP** (`CF-Connecting-IP`,
edge-set and not client-spoofable). Over the limit, the worker answers `429`
with a `Retry-After` header **before any forwarding**. The window is 60s; the
limit is `RATE_LIMIT_PER_MIN` (default **20/min**). In-memory per-isolate
state is fine here: this is a fast-fail backstop, and over-counting under
concurrency is SAFE (it only ever rejects more aggressively, never less).
`OPTIONS` preflights are answered before the rate-limit check, so they never
consume the budget.

The same Cloudflare route-level rate rule pattern as the TURN mint
(deploy/turn-creds/README.md, "Rate limiting") can be added if the relay
ever moves to a proxied custom route; the in-worker counter alone is the
current backstop.

## Client wiring

- `apps/nova/src/lib/classic/relay.ts` — client helper. When
  `VITE_CLASSIC_RELAY_ORIGIN` is set at build time (same pattern as
  `VITE_RUNTIME_ORIGIN`, M2), CORS-blocked games create rooms through the
  relay; until then they keep the direct fetch and the "room creation
  blocked" browse badge stays accurate.
- `apps/nova/vite.config.ts` — the strict CSP adds the relay origin to
  `connect-src` when `VITE_CLASSIC_RELAY_ORIGIN` is set.
- A sync test (`apps/nova/src/lib/classic/relay-worker.test.ts`) keeps the
  worker allowlist and the client endpoint keys identical, and the worker's
  own suite lives in `deploy/relay/worker.test.ts` (run with
  `npx vitest run deploy/relay/worker.test.ts` from the repo root).

## Deploy (GitHub Actions -> Cloudflare Workers)

The worker deploys through the standard pipeline in
`.github/workflows/relay.yml` (cloudflare/wrangler-action, runs on pushes
that touch `deploy/relay/**` and via manual dispatch).

1. **Secrets** (repo Settings -> Secrets and variables -> Actions): add
   `CLOUDFLARE_API_TOKEN` (Workers Scripts edit) and
   `CLOUDFLARE_ACCOUNT_ID`. Configuration lives in `wrangler.toml`
   (`name = "rocketcrab-cors-relay"`, `workers_dev = true`). The two
   non-secret env vars above default safely in code; override with
   `wrangler var set` only if the defaults do not fit (e.g. a staging
   origin).
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
   relay (no CORS errors). The relay rejects missing origins by design, so
   a curl smoke test must send one (any allowlisted origin works):

   ```sh
   curl -si https://rocketcrab-cors-relay.<your-account-subdomain>.workers.dev/ \
     -H "Origin: https://rocketcrab.com" \
     -H "Content-Type: application/json" \
     -d '{"endpoint":"drawphone-new","body":{}}'
   ```

   Expect `200` with `access-control-allow-origin: https://rocketcrab.com`
   and the upstream JSON (e.g. a `gameCode`). A request without `Origin`
   returns `403`, as does one from a non-allowlisted origin.

5. **Remove the blocked badges**: once verified, flip `connectStatus:
"blocked"` off in `apps/nova/src/lib/classic/games.ts` and delete the
   "room creation blocked" badge + warning copy in
   `apps/nova/src/routes/game.$gameId.tsx` and any other `connectBlocked`
   UI (the browse badge updates automatically via `connectBlocked`).
