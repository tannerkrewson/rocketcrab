# Cloudflare — Nova edge Worker runbook

Nova's only server-side code is one stateless Cloudflare Worker,
`rocketcrab-edge` (`deploy/edge/`). It has no database, no KV, and no game
code. `deploy/edge/wrangler.toml` is the single source of truth for its
configuration, and `npm run edge:deploy` is the single deployment path.
Record every change made outside that file (dashboard, secrets, account
settings) in this runbook.

## What the Worker does

| Route         | File       | Purpose                                                                                                                                                                        |
| ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /turn`  | `turn.ts`  | Mints one 24 h Cloudflare Realtime TURN credential per party join so cross-network WebRTC (e.g. Wi-Fi ↔ cellular) works. Holds the TURN key secret; the browser never sees it. |
| `POST /`      | `relay.ts` | Classic room-creation relay. 16 of the 22 Classic games create rooms on servers without CORS headers; the Worker calls only the 8 fixed endpoints in `RELAY_ENDPOINTS`.        |
| anything else | —          | `404`                                                                                                                                                                          |

Every request is gated in `worker.ts`, in order: Origin allowlist (`403`, no
CORS headers) → preflight (`204`) → POST only (`405`) → per-IP rate limit
(`429`, `Retry-After: 60`).

**Rate limit:** the Workers Rate Limiting binding, 60 requests/min per IP per
route (`turn:<ip>` and `relay:<ip>` are separate counters). A 10-player party
behind one carrier-NAT address uses 10 TURN mints at join; reconnects reuse
the cached credential. The counter is approximate and per Cloudflare
location, so it is an abuse backstop, not a quota. If the limiter itself
errors, requests are allowed (a limiter outage must not block joins).

There is deliberately no global daily cap: KV cannot count atomically, and a
cap that can be bypassed is worse than none. Spend is watched with billing
notifications instead (below).

## Account facts

| Fact                  | Value                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| Account               | `f82d64d09da6cb5a0afa0120033a7e13` ("Tannerkrewson@gmail.com's Account") |
| workers.dev subdomain | `tannerkrewson`                                                          |
| Edge Worker URL       | `https://rocketcrab-edge.tannerkrewson.workers.dev`                      |

## Everyday commands

All run from the repo root. Wrangler is pinned in `package.json` scripts and
fetched by `npx`, so nothing needs installing.

```sh
npx --yes wrangler@4.161.0 login   # once per machine (browser OAuth)
npm run test:edge                  # Worker unit tests
npm run edge:check                 # bundle without uploading (CI runs this too)
npm run edge:dev                   # local Worker on http://localhost:8787
npm run edge:deploy                # deploy wrangler.toml + worker code
```

For `edge:dev` with real TURN minting, put the two secrets in a gitignored
`deploy/edge/.dev.vars` (`TURN_KEY_ID=...` / `TURN_KEY_API_TOKEN=...`).

## First-time setup (or rebuilding on a fresh account)

1. **TURN key** — Dashboard → Realtime → TURN Server → Create. Copy the
   key ID and API token (shown once).
2. **Deploy the Worker** — `npm run edge:deploy`. Creates `rocketcrab-edge`
   with its allowlist, rate-limit binding, and Workers Logs.
3. **Secrets** — each prompts for the value; they are stored only in
   Cloudflare:
   ```sh
   npx --yes wrangler@4.161.0 secret put TURN_KEY_ID --config deploy/edge/wrangler.toml
   npx --yes wrangler@4.161.0 secret put TURN_KEY_API_TOKEN --config deploy/edge/wrangler.toml
   ```
   Secrets survive later deploys; `wrangler.toml` never contains them.
4. **Billing notification** — Dashboard → Notifications → Add → Billing →
   Usage Based Billing → Realtime. TURN egress was $0.05/GB after a shared
   1,000 GB/month Realtime free allowance when last checked; verify current
   pricing and pick a threshold well under the allowance. This is an alert,
   not a spending cap.
5. **Smoke test:**
   ```sh
   E=https://rocketcrab-edge.tannerkrewson.workers.dev
   curl -si -X POST $E/turn                                   # 403 (no Origin)
   curl -s  -X POST $E/turn -H 'Origin: https://rocketcrab.com' # { iceServers: [...] }
   curl -s  -X POST $E/ -H 'Origin: https://rocketcrab.com' \
     -H 'Content-Type: application/json' -d '{"endpoint":"spyfall-new"}'  # { gameCode }
   ```
6. **App builds** — the GitHub Pages deploy workflow's `edge_origin` input
   defaults to the URL above and becomes `VITE_EDGE_ORIGIN`.

## Abuse and emergencies

- **Stop TURN issuance:** `wrangler secret delete TURN_KEY_API_TOKEN` (mints
  return `500`; parties continue without TURN).
- **Revoke one credential:** `POST https://rtc.live.cloudflare.com/v1/turn/keys/<key>/credentials/<username>/revoke`
  with the key's bearer token. Rate limits bound issuance, not the traffic of
  an already-issued credential, so revoke or rotate the key for live abuse.
- **Rotate the TURN key:** create a new key in the dashboard, `secret put`
  both values, delete the old key.
- **Investigate:** Workers & Pages → `rocketcrab-edge` → Logs; each mint logs a
  `turn_cred_mint` line with IP and Origin (never the credential).

## Live state

Verified read-only with Wrangler on 2026-11-12:

- `rocketcrab-cors-relay` — the **old** relay-only Worker (last deployed
  2026-08-13, no bindings, no secrets). Superseded by `rocketcrab-edge`;
  nothing in the repo points at it. Delete it once `rocketcrab-edge` is live:
  `npx --yes wrangler@4.161.0 delete --name rocketcrab-cors-relay`.
- `curly-dream-16c4` — a pre-Nova Worker (2024); not a repo resource.
- `rocketcrab-edge` — **not deployed yet**.
- KV namespaces: none. R2 buckets: `prismrestore` only (not Nova's).
- TURN key: none configured as a Worker secret yet.
