# Nova edge Worker (Classic relay + TURN mint)

One stateless Cloudflare Worker is Nova's entire server-side surface:

| Route           | Purpose                                                                   |
| --------------- | ------------------------------------------------------------------------- |
| `POST /turn`    | Mint one 24-hour Cloudflare Realtime TURN credential via the Realtime API |
| everything else | Scoped Classic CORS relay (allowlisted room-creation endpoints only)      |

Both routes share the same origin allowlist, per-IP rate limiter, and CORS
behavior. The Worker executes no game code and stores no rooms or game state.
The only state is a KV daily mint counter.

The deployed script keeps its historical name `rocketcrab-cors-relay` so the
live resource is not replaced. The code entry point is `worker.ts`; the relay
and TURN handlers live in `../relay/worker.ts` and `../turn-creds/worker.ts`
with their own tests.

## Environment and secrets

Non-secret variables are OpenTofu `plain_text` bindings:

| Variable             | Default                                                                                                            | Meaning                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `ORIGIN_ALLOWLIST`   | `https://rocketcrab.com,http://localhost:5173,https://localhost:5173,http://127.0.0.1:5173,https://127.0.0.1:5173` | Origins allowed to call either route  |
| `RATE_LIMIT_PER_MIN` | `20`                                                                                                               | In-worker per-IP limit for each route |
| `MINT_DAILY_CAP`     | `5000`                                                                                                             | Daily TURN-credential issuance cap    |

Worker secrets (never in Git or OpenTofu state):

```sh
wrangler secret put TURN_KEY_ID --config deploy/edge/wrangler.toml
wrangler secret put TURN_KEY_API_TOKEN --config deploy/edge/wrangler.toml
```

Local development reads the same names from a gitignored
`deploy/edge/.dev.vars`. `TURN_BUDGET` is a KV binding; the Wrangler config uses
a placeholder so `wrangler dev` simulates it locally, and OpenTofu supplies the
real namespace.

## Behavior

- **Origin allowlist first.** Missing or non-allowlisted `Origin` gets `403`
  before any work, with no CORS headers. CORS responses echo the exact allowed
  origin and set `Vary: Origin`.
- **TURN mint.** Always requests `ttl: 86400` (24 h, within Cloudflare's 48 h
  maximum), ignores request bodies, and drops port-53 ICE URLs. Every page mints
  its own credential once per party; there is no client refresh machinery.
- **Daily cap.** `mints:YYYY-MM-DD` is checked before upstream and incremented
  only after a successful mint. KV is eventually consistent and has no atomic
  increment, so the cap can over-count (safe: it trips early, never late). If KV
  is missing or unavailable the check fails open. The cap bounds issuance, not
  traffic from credentials already issued; Cloudflare budget alerts and
  Billable Usage notifications cover spend visibility.
- **Relay.** Forwards only the fixed endpoints in
  `deploy/relay/worker.ts` (`RELAY_ENDPOINTS`), with a fixed method and a strict
  charset for interpolated path params. Never an open proxy.
- **Rate limiting.** The in-worker fixed-window counter is the fast-fail
  backstop. A zone-level Cloudflare rate rule is optional (needs a proxied
  custom route or Custom Domain) and is modeled by OpenTofu.
- **Emergency controls.** Disable issuance by removing/rotating the TURN
  secrets, lower `MINT_DAILY_CAP`, or revoke credentials at Cloudflare:
  `POST /v1/turn/keys/<key>/credentials/<username>/revoke`. Revoke/rotate the
  TURN key in the Realtime dashboard. Budget alerts are notifications, not hard
  caps.

## Build and test

OpenTofu consumes a local dry-run bundle; Wrangler never deploys production:

```sh
npx --yes wrangler@4.127.1 deploy deploy/edge/worker.ts \
  --config deploy/edge/wrangler.toml \
  --dry-run --outdir "$PWD/deploy/opentofu/.build/edge"
npx vitest run --root deploy
```

Use the absolute output path (a relative `--outdir` under the ignored `.build`
directory can produce only a README with some Wrangler versions).

## Deployment order

OpenTofu is the only deployment path for the Worker and its non-secret
bindings. Apply the Worker first, verify `/turn`, then rebuild/deploy the
static app with `VITE_TURN_CREDS_ORIGIN` set to the same edge origin (the client
appends `/turn`). Classic relay clients keep using the origin root. No
deployment is automated from this repository; review and apply manually after
approval.
