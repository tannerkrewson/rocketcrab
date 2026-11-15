# Cloudflare — Nova edge Worker runbook

Nova's only server-side code is the Cloudflare Worker `rocketcrab-edge`
(`deploy/edge/`) and its signaling and tunnel Durable Objects. It stores no game data,
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

| Route                  | File        | Purpose                                                                                                                                                                           |
| ---------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /turn`           | `turn.ts`   | Mints one 24 h Cloudflare Realtime TURN credential per party join so cross-network WebRTC (e.g. Wi-Fi ↔ cellular) works. Holds the TURN key secret; the browser never sees it.    |
| `POST /`               | `relay.ts`  | Classic room-creation relay. 16 of the 22 Classic games create rooms on servers without CORS headers; the Worker calls only the 8 fixed endpoints in `RELAY_ENDPOINTS`.           |
| `GET /signal/:roomKey` | `signal.ts` | WebSocket signaling, one hibernating Durable Object per 32-character lowercase hex room key.                                                                                      |
| `GET /tunnel/:pairId`  | `tunnel.ts` | **Not deployed.** WebSocket fallback tunnel: one hibernating `TunnelPair` Durable Object per 64-character lowercase hex pair ID, at most two sockets, frames forwarded unchanged. |
| anything else          | —           | `404`                                                                                                                                                                             |

The staged `POST /log` route (`deploy/edge/log.ts`, described under Connection
statistics) is not listed in the table above.

Every known route requires an allowlisted Origin. POST routes support CORS
preflight; signaling and tunnel routes require a WebSocket GET and are rate-limited on connection
attempts (`signal:<ip>` and `tunnel:<ip>`). All use per-IP rate limiting (`429`, `Retry-After: 60`).

**Tunnel pair (repo only, not deployed):** the `TUNNEL_PAIR` binding
(`TunnelPair`, `deploy/edge/tunnel.ts`) is staged in `wrangler.toml` with a
new `v2` migration (`new_sqlite_classes = ["TunnelPair"]`); the `v1` migration
for `SignalHub` is unchanged. The object accepts at most two sockets (a third
gets `409`). When the second socket joins, the server sends the text frame
`paired` once to each side; the client must wait for it before reporting a
connection. Data frames are binary and are forwarded unchanged; a frame that
arrives while the partner is absent is dropped. A client text frame closes
both sockets with `1003 binary only`, so text never reaches the peer. Nothing
is stored; the only storage use is a 30-second alarm that closes a lone socket
with `4408 no partner` and does nothing once the pair is complete. The
app side exists: the transport wraps each pair's WebRTC connection
(`packages/trystero-transport/src/fallback-peer-connection.ts`) and moves its
data channel onto this route when the direct channel has not opened 8 seconds
after both descriptions exist. Nothing reaches the route in production until
the Worker is deployed.

Storage cost per pairing: one `setAlarm` when the first socket joins and one
`deleteAlarm` when the second joins (or when a lone socket leaves). These are
Durable Object storage operations and should be treated as billable under the
SQLite storage pricing. That pricing was checked on 2026-11-12 and was not
re-checked for alarm operations, so confirm it before cutover. The relay budget
(below) is kept in memory and copied to the socket attachment at most once per
second per socket, after every 512 KiB spent, and when a socket closes.
Attachment writes are not storage operations.

Limits, in the order a frame is checked:

- Client text frame: both sockets closed with `1003 binary only`.
- Frame over 262,208 bytes (256 KiB plus the client's 29-byte AES-GCM framing,
  with a 64-byte allowance): both sockets closed with `1009 message too big`.
- Relay budget, per socket: 512 KiB/s sustained with a 4 MiB burst (named
  constants `RATE_BYTES_PER_SECOND` and `BURST_BYTES`). Legitimate traffic is the
  256 KiB/s game budget (PLAN §6) plus up to 2 MiB game-source transfers. A frame
  the bucket cannot cover closes both sockets with `1008 rate limit`. A missing or
  NaN bucket field is an empty bucket, so the socket fails closed.
- Over-credit after a hibernation wake: the wake rebuilds each bucket from the
  last attachment write. Writes happen at least once per second and after every
  512 KiB spent, so spending not yet written is under 512 KiB. A woken socket is
  over-credited by at most 512 KiB, about one second of the sustained rate. A
  4 MiB burst within one second causes 8 writes.
- Scope of the budget: it is per socket. The server does not cap the aggregate
  across pairs. Aggregate abuse is bounded only by the per-IP connection-attempt
  limit (`tunnel:<ip>`, 60 per minute per Cloudflare location, see above). There
  is no per-pair or global byte cap.
- Client contract for `409`: `pair_full` (a third socket) and `pair_closing` (a
  paired socket's partner is mid-close) are both retryable. A transient `409`
  can occur while the previous socket is still closing, so the client retries
  with backoff for up to a few seconds (for example 250 ms doubling, capped at
  2 s, then gives up). Retries count against the same per-IP limit.
- Sender's partner missing or not open after pairing: the sender is closed with
  `1011 partner gone`. Before pairing, frames are dropped rather than buffered.
- The server never sends `1010`, which RFC 6455 reserves for clients.

The staged Nova adapter uses Trystero 0.27's WebSocket relay strategy with
`VITE_EDGE_ORIGIN`, not public Nostr relays. It hashes the app and room IDs to
select a room-scoped `/signal/:roomKey` URL; the Worker routes each key to a
separate `SignalHub`. This provides signaling only. The data fallback is the separate
`/tunnel/:pairId` route above.
Signaling uses WebSocket hibernation and socket attachments; messages are not
persisted. The published `@trystero-p2p/ws-relay@0.27.0` server echoes to all
subscribers, including the publisher. We deliberately omit its aggregate 10,000
subscription default to respect the unlimited-party decision; per-socket limits
remain. See Cloudflare's [WebSocket hibernation documentation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) and [class migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).

**Rate limit:** the Workers Rate Limiting binding, 60 requests/min per IP per
route (`turn:<ip>`, `relay:<ip>`, `signal:<ip>`, `tunnel:<ip>` and `log:<ip>` are separate counters). A 10-player party
behind one carrier-NAT address uses 10 TURN mints at join; reconnects reuse
the cached credential. The counter is approximate and per Cloudflare
location, so it is an abuse backstop, not a quota. If the limiter itself
errors, requests are allowed (a limiter outage must not block joins).

There is deliberately no global daily cap: KV cannot count atomically, and a
cap that can be bypassed is worse than none. Spend is watched with billing
notifications instead (below).

### Local signaling integration test

Start a local Worker separately with `npx --yes wrangler@4.161.0 dev --config deploy/edge/wrangler.toml --local --port 18987`, then run `npm run test:edge:integration`. The test targets only `http://127.0.0.1:18987` by default; set `SIGNAL_TEST_ORIGIN` to another **local** origin if needed. It checks real WebSocket upgrade and origin rejection, fan-out, sender echo, room isolation, unsubscribe, and delivery after 12 seconds of idleness. The idle check does not establish whether workerd actually evicted the object; the unit test separately exercises restored attachments. It also runs one tunnel pairing (`paired` once per side, binary forwarded, a refused third socket, close propagation, and a text frame closing both sides with `1003`); the 30-second lone-socket alarm is covered only by `tunnel.test.ts`. On local workerd the partner's TCP close event can lag several seconds after its close frame arrives, so the test checks the received frame instead. Stop the local Worker afterward.

## Account facts

| Fact                  | Value                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| Account               | `f82d64d09da6cb5a0afa0120033a7e13` ("Tannerkrewson@gmail.com's Account") |
| workers.dev subdomain | `tannerkrewson`                                                          |
| Edge Worker URL       | `https://rocketcrab-edge.tannerkrewson.workers.dev`                      |

## Beta plan and pricing evidence

Checked against official Cloudflare documentation on **2026-11-12**; these are
published rates and limits, not a verification of this account's current plan,
usage, entitlements, invoice, or alert configuration.

**Plan decision (owner, 2026-11-12; PLAN decisions log and §4.6):** stay on
Workers Free during development and the workers.dev beta; switch to Workers
Paid ($5/month minimum, not a spending cap) at the approved `rocketcrab.com`
cutover (PLAN §9). Reasons: Free does not bill for Workers or Durable Objects,
but a Free daily limit fails further requests until the 00:00 UTC reset, which
would stop every party at once. The earlier "1,000 parties/day" figure is not
supported without workload assumptions, so no party threshold is claimed. TURN
is billed separately on either plan. The limits and sources below support this.

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

Analytics Engine pricing and limits above were rechecked against those official pages on 2026-11-13.

**Owner/account gates:** confirm the actual Workers plan, Analytics Engine
access and relevant account usage/allowances in the dashboard before deployment;
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

The locally staged `POST /log` accepts one JSON object (including sendBeacon's
text/plain payload), at most 1024 bytes, with exactly these required fields:

- `outcome`: `direct`, `turn`, `tunnel`, `failed`, or `unknown` (blob1). `unknown` means the connection opened but the browser cannot honestly tell whether it was direct or TURN (e.g. selected-pair stats are missing, ambiguous or rejected, or a scale virtual peer has no native connection).
- `error_code`: empty or a Trystero 0.27 RoomError code: `room-full`, `banned`, `relay-failed`, `identity-failed`, `plugin-failed`, `decrypt-failed`, `peer-connect-failed`, `handshake-failed`, `peer-error` (blob2).
- `ms_to_connect`: integer 0–3600000 milliseconds (double1; report uses connected outcomes only).
- `signaling_ok`: boolean (blob3, encoded `true` or `false`).
- `browser`: `unknown`, `safari-ios`, `safari`, `chrome-android`, `chrome`, `firefox`, `edge`, or `other` (blob4).
- `network`: `unknown`, `slow-2g`, `2g`, `3g`, `4g`, `bluetooth`, `cellular`, `ethernet`, `wifi`, `wimax`, `none`, or `other` (blob5).
- `app_version`: numeric `major.minor.patch`, each component 0–999 without leading zeros (blob6).

Unknown fields and values are rejected; no names, IPs, room IDs, or player IDs
are written. The allowlist and `log:<ip>` rate-limit key are shared gate
mechanisms, but the IP is not stored in the data point. As with other routes,
the rate limiter fails open on binding failure. A 204 means the write call was
accepted, not that ingestion was verified. The binding targets dataset
**`connection_events`**; no writer, binding, or dataset has been deployed yet.
A table appears only after its first event. Coordinate schema changes with the
reporting script and future client. Account plan/access remain unverified.

The owner must create a Cloudflare API token scoped to this account with
**Account → Account Analytics → Read**, and supply it locally; never commit or
paste it into the repository. Set `CLOUDFLARE_API_TOKEN` in the environment
without putting its value in shell history. Set `CLOUDFLARE_ACCOUNT_ID` to the
account ID above, then run:

```sh
node scripts/connection-stats.mjs 2026-11-01 2026-11-12
```

Dates are UTC, start inclusive and end exclusive. Percentages cover all five
outcomes; the median covers connected outcomes only (`direct`, `turn`, `tunnel`,
and `unknown`, which opened but could not be classified). Both use Analytics
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
6. **App builds** — `npm run deploy:nova` supplies `VITE_EDGE_ORIGIN` from
   `deploy/origins.json`; first deployment requires owner approval.

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
- `rocketcrab-edge` — **not deployed yet**. When deployed, its Durable Object
  bindings will be `SIGNAL_HUB` (`SignalHub`, migration `v1`) and `TUNNEL_PAIR`
  (`TunnelPair`, migration `v2`, not yet deployed). Neither migration has run on
  any account.
- KV namespaces: none. R2 buckets: `prismrestore` only (not Nova's).
- TURN key: none configured as a Worker secret yet.
- 2026-11-15: the first `npm run edge:deploy` failed atomically (API code
  10089): the account must enable Workers Analytics Engine in the dashboard
  before the `CONNECTION_EVENTS` binding can be created. Nothing changed live.
