# TURN mint module (`/turn`)

The TURN half of Nova's single edge Worker (`deploy/edge/README.md`). It mints
**short-lived TURN credentials** at party-join time for cross-network WebRTC
(P0, task `rocketcrab-23s`; F5 verdict "TURN required", ADR-0003 M3 addendum).
The Worker entry point dispatches `/turn` here; this file documents the mint
module and its operator details.

The endpoint proxies Cloudflare Realtime's credentials API:

```
POST https://rtc.live.cloudflare.com/v1/turn/keys/<TURN_KEY_ID>/credentials/generate-ice-servers
Authorization: Bearer <TURN_KEY_API_TOKEN>
body: { "ttl": 86400 }
```

and returns the standard `iceServers` array (STUN + TURN entries) with CORS
headers so the browser can read it.

**Security model — no game code, stateless, abuse-controlled:**

- **No game code execution.** The worker only proxies the credentials API;
  it never runs or inspects game content.
- **No room-state database.** Stateless: every request independently mints
  credentials from the TURN key.
- **Origin allowlist** (`ORIGIN_ALLOWLIST`, rocketcrab-23s.1): requests whose
  `Origin` is missing or not allowlisted get `403` **before** any upstream
  call. The endpoint is browser-only by design.
- **One long party credential** (rocketcrab-23s.2): upstream is always called
  with `{"ttl": 86400}` (24 h; Cloudflare allows at most 48 h). The client mints
  once per party and never refreshes, because Cloudflare documents no maximum
  TURN allocation duration (the client keeps it alive with authenticated TURN
  refreshes) and only best-effort live credential replacement. Port-53 URLs are
  stripped (browsers block port 53; ICE would hang on timeouts).
- **Per-IP rate limiting** (rocketcrab-23s.3): the Cloudflare Workers Rate
  Limiting binding, with an in-memory local-dev fallback and an optional
  zone-level rule (see "Rate limiting" below).
- **No global daily cap** (rocketcrab-23s.4): Cloudflare KV cannot implement
  one reliably (no atomic increment, one write/second/key), so the old counter
  was deleted instead of pretending to cap issuance. See "No global daily cap"
  below.
- **Usage visibility** (rocketcrab-23s.5): native Cloudflare account budget
  alerts and Billable Usage notifications replace the former custom GraphQL
  watchdog (see "Usage visibility and abuse response" below). Mint caps bound
  issuance only; they cannot bound traffic from credentials already issued.
- **Secrets stay secret**: `TURN_KEY_ID` / `TURN_KEY_API_TOKEN` are set as
  Worker secrets only — never in code, `wrangler.toml`, or the client build.

## Environment variables

| Variable             | Default                                                                                                            | Meaning                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORIGIN_ALLOWLIST`   | `https://rocketcrab.com,http://localhost:5173,https://localhost:5173,http://127.0.0.1:5173,https://127.0.0.1:5173` | Comma-separated origins allowed to call the mint endpoint. Each entry may be a full origin (`scheme://host[:port]`); a trailing slash is tolerated. Matching against the request `Origin` is exact. |
| `RATE_LIMIT_PER_MIN` | `60`                                                                                                               | Requests per minute per client IP for the Workers Rate Limiting binding (60s window).                                                                                                               |

A single-variable env override (unset = the default above). The OpenTofu root
represents these values as `plain_text` bindings; do not use a separate
Wrangler variable deployment path. For example:

```hcl
edge_worker_variables = {
  ORIGIN_ALLOWLIST   = "https://rocketcrab.com,https://staging.rocketcrab.com"
  RATE_LIMIT_PER_MIN = "60"
}
```

(`ORIGIN_ALLOWLIST` and `RATE_LIMIT_PER_MIN` are not sensitive.)

## Worker secrets

Set after the edge Worker exists (never commit these; the TURN key is a
long-term secret):

```sh
wrangler secret put TURN_KEY_ID --config deploy/edge/wrangler.toml
wrangler secret put TURN_KEY_API_TOKEN --config deploy/edge/wrangler.toml
```

Local dev: create a gitignored `deploy/edge/.dev.vars` with the same names
(`wrangler dev` reads it). The repo `.gitignore` now excludes
`.dev.vars` — never commit it.

## Infrastructure management

The edge Worker is modeled by `cloudflare_workers_script.relay` in
`deploy/opentofu/`, with its workers.dev subdomain and optional custom
domain/route and zone rate rule. Wrangler is used only for local development
and the dry-run JavaScript bundle consumed by OpenTofu. No deploy workflow
remains in this repository.

After a coordinator-approved OpenTofu apply, set the Worker secrets through
the approved Workers Secrets API or the following human-managed Wrangler
commands. Their values must never be committed or passed as OpenTofu
`secret_text` bindings:

```sh
wrangler secret put TURN_KEY_ID --config deploy/edge/wrangler.toml
wrangler secret put TURN_KEY_API_TOKEN --config deploy/edge/wrangler.toml
```

The mint appears at
`https://rocketcrab-cors-relay.<your-account-subdomain>.workers.dev/turn` when
the account workers.dev subdomain is enabled. The validation-only workflow is
`.github/workflows/infrastructure-plan.yml`.

Smoke test (the mint endpoint rejects missing origins by design, so send
one — any allowlisted origin works):

```sh
curl -si https://rocketcrab-cors-relay.<your-account-subdomain>.workers.dev/turn \
  -H "Origin: https://rocketcrab.com" \
  -H "Content-Type: application/json" -d '{}'
```

Expect `200` with `access-control-allow-origin: https://rocketcrab.com` and
an `iceServers` array. A request without `Origin` returns `403`.

## Origin allowlist and CORS (rocketcrab-23s.1)

- Read `Origin`; missing or not in `ORIGIN_ALLOWLIST` → `403` structured
  JSON (`{"error":{"code":"origin_not_allowed",...}}`), **no upstream call**.
  The `403` deliberately carries no CORS headers, so a disallowed origin's
  browser shows a plain CORS error instead of reading anything.
- Allowlisted origin: CORS headers echo the exact origin
  (`Access-Control-Allow-Origin: <origin>`, `Vary: Origin`), `POST` +
  `Content-Type` are allowed, and `OPTIONS` preflights get `204` with the
  same headers.
- **Missing Origin is rejected** (defense in depth): curl and other
  non-browser clients cannot mint, even with a valid allowlist. This is
  deliberate — the endpoint is browser-only; the app always sends `Origin`.

### LAN-IP dev caveat (F5 spike)

The F5 spike serves the app over HTTPS from a machine's **LAN IP** (e.g.
`https://192.168.1.10:5173`, certs from `scripts/gen-certs.mjs`) for
physical-device testing. That origin cannot be statically allowlisted, so
when testing the mint from a LAN device, override the allowlist locally:

```sh
# wrangler dev (never affects prod):
wrangler dev --var ORIGIN_ALLOWLIST:https://192.168.1.10:5173,https://rocketcrab.com
```

Prod always uses the deployed `ORIGIN_ALLOWLIST` (or its default), so the
LAN override is dev-only. For the equivalent in `.dev.vars`:
`ORIGIN_ALLOWLIST=https://192.168.1.10:5173,https://rocketcrab.com`.

## Credential TTL and port-53 URLs (rocketcrab-23s.2)

- The upstream call always requests `{"ttl": 86400}` — a **24-hour** credential
  lifetime, baked into the worker (`MINT_TTL_SECONDS`). The client cannot change
  it (request bodies are ignored). Cloudflare documents a **48-hour maximum**
  credential expiry and **no maximum TURN allocation duration**: the WebRTC
  stack keeps the allocation alive with authenticated TURN Refresh requests, so
  a party longer than the credential lifetime needs new credentials, not a new
  allocation. 24 hours covers any plausible party, including overnight sessions.
- **No client refresh machinery.** The app mints once per party (cached for the
  lease on the page) and uses that configuration for every peer it creates,
  including reconnects. The previous 8-minute re-mint and live
  `RTCPeerConnection.setConfiguration()` path was removed: it was unproven on
  physical devices, Cloudflare only documents it as short-lived-credential
  replacement for an active session, and Trystero has no ICE-restart hook. If
  credentials do expire, Cloudflare stops billing/analytics immediately and
  disconnects the allocation shortly after; a party that reconnects afterwards
  mints fresh credentials.
- **Cost implication:** a leaked credential is usable for up to 24 hours. That
  is the deliberate trade for removing refresh machinery; the origin allowlist,
  mint caps, per-IP rate limit and native budget alerts are the compensating
  controls. Credentials live only in page memory and are never persisted.
- Cloudflare's `generate-ice-servers` response includes alternate **port-53**
  URLs (`stun:`/`turn:` on port 53), which browsers block — ICE would stall on
  timeouts, and Nova does not use trickle ICE. The worker drops every URL
  whose port list includes exactly `53` and keeps the documented primary set:

  ```
  turn:turn.cloudflare.com:3478?transport=udp
  turn:turn.cloudflare.com:3478?transport=tcp
  turns:turn.cloudflare.com:5349|443?transport=tcp
  ```

  The check is port-exact (`:5349` is kept; only `:53` candidates are
  dropped) and the `iceServers` array shape (urls/username/credential per
  entry) is preserved.

- Upstream failures (network error, non-2xx, invalid JSON, wrong shape)
  return `502` with a structured JSON error; the TURN API token never appears
  in any response.

## Rate limiting (rocketcrab-23s.3)

### 1. Workers Rate Limiting binding (primary)

OpenTofu provisions a `RATE_LIMITER` binding (`type = "ratelimit"`,
`namespace_id = "1001"`, `simple = { limit = RATE_LIMIT_PER_MIN, period = 60 }`).
Each request calls `limit({ key: "turn:<client-ip>" })` before any upstream
call. The binding is approximate and counts separately per Cloudflare location,
but it survives isolate restarts and is shared by instances in a location —
unlike a module-global `Map`.

The in-memory fixed-window counter remains only as a fallback when the binding
is absent (`wrangler dev`, unit tests) or throws. That fallback is per-isolate
and must not be treated as a durable limit.

**Separate from Classic:** TURN uses the `turn:<ip>` key in the shared binding;
the Classic relay uses `relay:<ip>`, so the two routes have independent
per-IP counters.

**Headroom for carrier NAT:** the default is **60 mints/min per IP per
location**. A 10-player party sharing one public IP needs 10 mints for
simultaneous joins; reconnects reuse the page's cached 24 h credential and do
not mint. Reloads and retries therefore fit comfortably within 60 even when
several parties share a carrier-NAT address. A dedicated test sends ten
simultaneous joins from one IP and asserts all succeed.

### 2. Optional zone rate rule

A Cloudflare rate-limiting rule on the mint route adds an edge-level per-IP
backstop, but requires a proxied zone hostname (custom domain/route) and a WAF
plan that supports `ip.src` characteristics. Cloudflare's Free plan does not
offer `ip.src` rate rules, so `turn_zone_rate_limit_enabled` defaults to
**false**. Enable it only after checking the plan; the exact Rules expression is
a human-supplied input. The same rule can be configured in the dashboard under
Security -> WAF -> Rate limiting rules; if configured manually, record it in
`deploy/cloudflare.md`.

## No global daily cap (rocketcrab-23s.4)

The previous implementation kept `mints:YYYY-MM-DD` in KV and did a
read-before-mint / increment-after-success. That cannot enforce a cap:

- KV allows only **one write per second per key**, with no atomic increment.
- Two simultaneous joins both read the same count, both mint, then their
  read-modify-write updates overwrite each other (last write wins). The counter
  under-counts, so the cap is bypassed precisely under load.
- Concurrent writes can also be rejected by the KV write limit. The worker
  caught that and continued, so the counter silently stopped moving.

A Durable Object would make the counter atomic, but adds persistent state,
billing, migrations, and a second failure mode for a control that only bounds
issuance. The counter was therefore **removed**, along with the KV namespace
binding and `MINT_DAILY_CAP`. Issuance is bounded by the origin allowlist and
rate limits; spend is visible through native Cloudflare budget alerts and
Billable Usage (notifications, not hard caps). If abuse occurs, remove/rotate
the TURN secrets and revoke credentials; see "Usage visibility and abuse
response" below.

### Credential attribution

Each participant's page mints **its own** credential once at party join and
reuses it for that page's peer connections; there is no credential shared
between participants and no client refresh. Cloudflare TURN analytics exposes
`keyId`, `username`, and `customIdentifier` dimensions. `customIdentifier` is
documented for the sibling `credentials/generate` endpoint, not for
`credentials/generate-ice-servers`, so Nova does not send an unverified field.
Current attribution is therefore per credential (`username`) plus the
`turn_cred_mint` log line (`ip`, `origin`, `ts`). Revisit custom identifiers
after a live API check; do not add a client-supplied identifier without
validation.

### TURN analytics queries

Use the Cloudflare GraphQL analytics API with an Account Analytics token. Start
from the current TURN dataset in the dashboard/GraphiQL and filter the desired
window, then:

- **Total traffic:** sum `ingressBytes` and `egressBytes` for the account.
- **Top credentials/keys:** group by `username` and `keyId`, ordered by
  `sum_egressBytes_DESC`, when investigating an unexpected spike.
- **Issuance failures:** Workers Logs for the edge Worker plus the
  `turn_cred_mint` lines show successful mints only; alert on budget thresholds
  separately.

Cloudflare budget alerts and Billable Usage notifications are dashboard
settings and are **notifications, not hard spending caps**. See
`deploy/cloudflare.md` for the emergency procedure.

## Usage visibility and abuse response (rocketcrab-23s.5)

Cloudflare's native controls replace the former custom GraphQL watchdog
(removed with its cron trigger, three Worker secrets and alert-watermark KV
state):

- **Account budget alerts** (Manage Account → Billing → Billable Usage →
  Budget alerts) email a threshold crossing for combined usage-based spend.
  They are informational and do **not** cap or stop usage, so they are a
  warning, not a hard stop.
- **Billable Usage / product usage notifications** (Notifications → Add →
  Billable Usage) show and can alert on Realtime usage. TURN and SFU share one
  Realtime free allowance (1,000 GB/month) and one bill line.
- **Per-mint logs** (`turn_cred_mint`) remain in Workers Logs for volume review
  and incident reconstruction; OpenTofu keeps Workers observability enabled.
- **Abuse response:** Cloudflare's credentials API can revoke a short-lived
  credential before its TTL (`POST /v1/turn/keys/<key>/credentials/<username>/revoke`).
  That is a manual operator action; Nova does not ship a revoke route. Remove
  or rotate the TURN secrets, or tighten rate limits, as the other levers.

### What these controls do and do not bound

- The per-IP rate limits bound **issuance**. They cannot bound traffic from an
  already-issued credential: TURN relays whatever the holder sends until
  expiry. With the 24 h TTL, assume a leaked credential can relay for up to 24
  hours. There is deliberately no global daily cap (see above).
- Cloudflare documents **per-allocation** limits (roughly 5–10 kpps and
  50–100 Mbps, plus >5 new destination IPs/sec) and bills **$0.05/GB** of
  egress. There is no account-wide TURN packet/bandwidth cap in Nova's control;
  the account budget alert is the detection path.
- Physical-device cross-network tests (later release gates) should measure
  whether direct ICE succeeds, so TURN egress stays rare.

### Why not HMAC refresh tickets / an external rate-limit library?

Deliberately NOT doing: HMAC refresh tickets, per-room quotas, a Durable
Object counter, or external rate-limit libraries. Complexity > value here: the
24 h credential covers a whole party with one mint, the native Workers rate
limiting binding stops per-IP farming at the source without extra state, the
optional zone rule adds a WAF-level backstop where the plan supports it, and
native budget alerts cover spend visibility.
