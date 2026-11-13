# Cloudflare — Nova edge Worker runbook

Nova's only server-side code is the Cloudflare Worker `rocketcrab-edge`
(`deploy/edge/`) and its signaling Durable Objects. It stores no game data,
uses no KV, and runs no game code. `deploy/edge/wrangler.toml` is the single source of truth for its
configuration, and `npm run edge:deploy` is the single deployment path.
Record every change made outside that file (dashboard, secrets, account
settings) in this runbook. The staged edge allowlist includes the workers.dev
Nova beta origin, alongside rocketcrab.com and localhost; it has not been
deployed.

Static assets-only Worker configurations are staged in `deploy/nova/wrangler.toml`
and `deploy/runtime/wrangler.toml`. They have not been deployed; the app
uses SPA fallback and the runtime uses 404 handling for unknown paths.
Vite emits each Worker's `_headers` in its asset directory; Cloudflare's
[static asset headers documentation](https://developers.cloudflare.com/workers/static-assets/headers/)
confirms this mechanism (checked 2026-11-12). The runtime blocks all framing
unless `VITE_MAIN_ORIGIN` is set at build time. `deploy/origins.json` is the
source for the build pins used by `npm run deploy:nova` and
`npm run deploy:runtime`; both verify built assets before calling Wrangler.
First deploys still require owner approval. GitHub Pages and project-site
base paths are no longer deployment targets.

## What the Worker does

| Route                  | File        | Purpose                                                                                                                                                                        |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /turn`           | `turn.ts`   | Mints one 24 h Cloudflare Realtime TURN credential per party join so cross-network WebRTC (e.g. Wi-Fi ↔ cellular) works. Holds the TURN key secret; the browser never sees it. |
| `POST /`               | `relay.ts`  | Classic room-creation relay. 16 of the 22 Classic games create rooms on servers without CORS headers; the Worker calls only the 8 fixed endpoints in `RELAY_ENDPOINTS`.        |
| `GET /signal/:roomKey` | `signal.ts` | WebSocket signaling, one hibernating Durable Object per 32-character lowercase hex room key.                                                                                   |
| anything else          | —           | `404`                                                                                                                                                                          |

Every known route requires an allowlisted Origin. POST routes support CORS
preflight; signaling requires a WebSocket GET and is rate-limited on connection
attempts. Both use per-IP rate limiting (`429`, `Retry-After: 60`).

Signaling uses WebSocket hibernation and socket attachments; messages are not
persisted. The published `@trystero-p2p/ws-relay@0.27.0` server echoes to all
subscribers, including the publisher. We deliberately omit its aggregate 10,000
subscription default to respect the unlimited-party decision; per-socket limits
remain. See Cloudflare's [WebSocket hibernation documentation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) and [class migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).

**Rate limit:** the Workers Rate Limiting binding, 60 requests/min per IP per
route (`turn:<ip>`, `relay:<ip>`, and `signal:<ip>` are separate counters). A 10-player party
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

## Beta plan and pricing evidence

Checked against official Cloudflare documentation on **2026-11-12**; these are
published rates and limits, not a verification of this account's current plan,
usage, entitlements, invoice, or alert configuration. Owner decision remains:
Workers Free during development and workers.dev beta, then Workers Paid at the
approved cutover. Paid is a **$5/month minimum**, not a spending cap.

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
  lists Free at 100,000 Worker requests/day and 10 ms CPU per invocation; Paid
  includes 10 million requests/month and 30 million CPU-ms, then charges for
  overages. A WebSocket upgrade counts as a Worker request; subsequent messages
  do not. [Limits](https://developers.cloudflare.com/workers/platform/limits/#daily-requests)
  say Free resets at 00:00 UTC and exceeding the limit produces error 1027, with
  route fail-open/fail-closed behavior where applicable.
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
  lists Free SQLite-backed objects at 100,000 requests and 13,000 GB-s/day;
  exceeding a Free limit makes further operations of that type fail until the
  daily reset at 00:00 UTC. Paid includes 1 million requests and 400,000 GB-s
  per month, then $0.15/million requests and $12.50/million GB-s, rounded up to
  billable units. Connections count as requests; for compute request billing,
  20 incoming WebSocket messages count as one request, while outgoing messages
  and incoming protocol pings are not charged. Metrics show actual messages,
  not the billing ratio. Hibernation avoids duration charges only while the
  object is idle and eligible; active handlers and non-hibernatable time count.
  SQLite storage has separate limits and pricing, even for metadata.
- A party/day threshold cannot be inferred from these limits alone: traffic,
  connection attempts, session lengths, message rates, and other account usage
  matter. For illustration only, 1,000 parties with 2,000 incoming tunnel
  messages each would consume roughly 100,000 DO request equivalents for
  messages alone, before connections or other usage; this is not a traffic
  forecast or measured capacity. Free can interrupt service, so beta usage
  must be monitored; Paid can still incur overages and other failures.
- [WebSocket runtime limits](https://developers.cloudflare.com/workers/runtime-apis/websockets/)
  include a 32 MiB incoming message limit; routine runtime updates can disconnect
  sockets, so reconnect handling remains necessary.
- [Realtime pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/)
  lists TURN egress at $0.05/GB after 1,000 GB/month shared with SFU and the
  WebSocket adapter. This is separate from Workers plan billing, not a hard cap.
- [Analytics Engine pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/)
  lists Free (100,000 data points and 10,000 queries/day) and Paid (10 million
  points and 1 million queries/month; published overage rates $0.25 and $1 per
  additional million respectively). The page says usage is **currently not
  billed**, with future pricing announced in advance; do not assume it will
  remain free. [Limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/)
  include 250 points per Worker invocation and three months' retention.

**Owner/account gates:** confirm the actual Workers plan, Analytics Engine
access and relevant account usage/allowances in the dashboard before §8.1;
published plan availability does not prove this account's access. Determine
whether a useful Free-limit usage notification is offered for this account,
configure it and verify delivery; the notification type and threshold are not
yet confirmed. Separately configure and test the Realtime billing alert. No
notification, account setting, deployment, or other live change was made by
this research.

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

## Connection statistics (planned ingestion)

The independent SQL report assumes dataset **`connection_events`**: `blob1`
contains `direct`, `turn`, `tunnel`, or `failed`; `double1` is milliseconds to
connect for successful outcomes. The future §8.1 writer must use this exact
mapping (and must not record IPs, room IDs, or player IDs). No writer, binding,
or dataset has been deployed yet; a table appears only after its first event.
Coordinate changes to this schema with the reporting script.

The owner must create a Cloudflare API token scoped to this account with
**Account → Account Analytics → Read**, and supply it locally; never commit or
paste it into the repository. Set `CLOUDFLARE_API_TOKEN` in the environment
without putting its value in shell history. Set `CLOUDFLARE_ACCOUNT_ID` to the
account ID above, then run:

```sh
node scripts/connection-stats.mjs 2026-11-01 2026-11-12
```

Dates are UTC, start inclusive and end exclusive. Percentages cover all four
outcomes; the median covers successful connections only. Both use Analytics
Engine sampling weights, so sampled results are estimates. No events yields
zero percentages and an unavailable median. The report cannot be validated
against live data until ingestion and the owner's token exist. See Cloudflare's
[SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/)
and [aggregate functions](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/aggregate-functions/)
(checked 2026-11-12). No Cloudflare settings or secrets were changed for this tool.

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
   Usage Based Billing → Realtime. See dated pricing evidence above; verify
   current pricing and pick a threshold well under the allowance. This is an alert,
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
