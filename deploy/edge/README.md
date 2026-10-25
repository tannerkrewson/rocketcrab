# Nova edge Worker (Classic relay + TURN mint)

One stateless Cloudflare Worker is Nova's entire server-side surface:

| Route         | Purpose                                                                   |
| ------------- | ------------------------------------------------------------------------- |
| `POST /turn`  | Mint one 24-hour Cloudflare Realtime TURN credential via the Realtime API |
| `POST /`      | Scoped Classic CORS relay (allowlisted room-creation endpoints only)      |
| anything else | `404` JSON; never forwarded anywhere                                      |

Both routes share the same origin allowlist, per-IP rate limiter, and CORS
behavior. The Worker executes no game code, stores no rooms or game state, and
has **no KV or database bindings**. Its only state is in-memory per-isolate
rate-limit counters.

The deployed script keeps its historical name `rocketcrab-cors-relay` so the
live resource is not replaced. The code entry point is `worker.ts`; the relay
and TURN handlers live in `../relay/worker.ts` and `../turn-creds/worker.ts`
with their own tests.

## Environment and secrets

Non-secret variables are OpenTofu `plain_text` bindings:

| Variable             | Default                                                                                                            | Meaning                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `ORIGIN_ALLOWLIST`   | `https://rocketcrab.com,http://localhost:5173,https://localhost:5173,http://127.0.0.1:5173,https://127.0.0.1:5173` | Origins allowed to call either route |
| `RATE_LIMIT_PER_MIN` | `60`                                                                                                               | Platform per-IP limit for each route |

Worker secrets (never in Git or OpenTofu state):

```sh
wrangler secret put TURN_KEY_ID --config deploy/edge/wrangler.toml
wrangler secret put TURN_KEY_API_TOKEN --config deploy/edge/wrangler.toml
```

Local development reads the same names from a gitignored
`deploy/edge/.dev.vars`.

## Behavior

- **Origin allowlist first.** Missing or non-allowlisted `Origin` gets `403`
  before any work, with no CORS headers. CORS responses echo the exact allowed
  origin and set `Vary: Origin`.
- **TURN mint.** Always requests `ttl: 86400` (24 h, within Cloudflare's 48 h
  maximum), ignores request bodies, and drops port-53 ICE URLs. Every page mints
  its own credential once per party; there is no client refresh machinery and
  no account-wide daily counter (see `../turn-creds/README.md`).
- **Relay.** Forwards only the fixed endpoints in
  `deploy/relay/worker.ts` (`RELAY_ENDPOINTS`), with a fixed method and a strict
  charset for interpolated path params. Never an open proxy. The relay owns
  only `/`; unknown paths are `404`.
- **Rate limiting.** The primary limit is the Cloudflare Workers Rate Limiting
  binding (`RATE_LIMITER`, keyed by client IP and route; default **60/min per
  route per location**). It survives isolate restarts and is
  approximate/per-location. 60/min covers ten simultaneous joins behind one
  carrier-NAT IP plus reloads; reconnects do not mint. The in-memory
  fixed-window counter is only a local-dev/test fallback when that binding is
  absent. A zone-level Cloudflare rate rule is optional (needs a proxied custom
  route or Custom Domain and a WAF plan that supports `ip.src`); it is off by
  default.
- **Emergency controls.** Disable issuance by removing/rotating the TURN
  secrets, or revoke credentials at Cloudflare:
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
