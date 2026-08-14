# Rocketcrab TURN credential mint endpoint

One tiny Cloudflare Worker that mints **short-lived TURN credentials** at
party-join time for Rocketcrab Nova's cross-network WebRTC (P0, beads
`rocketcrab-23s`; F5 verdict "TURN required", ADR-0003 M3 addendum).

The endpoint proxies Cloudflare Realtime's credentials API:

```
POST https://rtc.live.cloudflare.com/v1/turn/keys/<TURN_KEY_ID>/credentials/generate-ice-servers
Authorization: Bearer <TURN_KEY_API_TOKEN>
body: { "ttl": 600 }
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
- **Short credential TTL** (rocketcrab-23s.2): upstream is always called with
  `{"ttl": 600}` (10 minutes) — extracted credentials self-expire and cannot
  be stockpiled — and port-53 URLs are stripped from the response (browsers
  block port 53; ICE would hang on timeouts).
- **Per-IP rate limiting** (rocketcrab-23s.3): an in-worker fixed-window
  fast-fail check plus a durable Cloudflare route-level rate rule (see
  "Rate limiting" below).
- **Budget kill-switch** (rocketcrab-23s.4): KV counters cap how many
  credentials can be minted per day and since the counters were last
  re-armed; when a cap is hit the worker answers `429 budget_exceeded`
  **before** any upstream call (see "Budget kill-switch" below).
- **Secrets stay secret**: `TURN_KEY_ID` / `TURN_KEY_API_TOKEN` are set as
  Worker secrets only — never in code, `wrangler.toml`, or the client build.

## Environment variables

| Variable             | Default                                                                                                            | Meaning                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORIGIN_ALLOWLIST`   | `https://rocketcrab.com,http://localhost:5173,https://localhost:5173,http://127.0.0.1:5173,https://127.0.0.1:5173` | Comma-separated origins allowed to call the mint endpoint. Each entry may be a full origin (`scheme://host[:port]`); a trailing slash is tolerated. Matching against the request `Origin` is exact. |
| `RATE_LIMIT_PER_MIN` | `10`                                                                                                               | Requests per minute per client IP allowed by the in-worker fast-fail counter (60s fixed window).                                                                                                    |
| `MINT_DAILY_CAP`     | `5000`                                                                                                             | Maximum successful mints per UTC calendar day (kill-switch; see below). A new day starts a fresh counter automatically.                                                                             |
| `MINT_TOTAL_CAP`     | `50000`                                                                                                            | Maximum successful mints since the counters were last re-armed (kill-switch; see below). Re-arm by deleting the counters (see "Re-arming the counters").                                            |

A single-variable env override (unset = the default above). For example, to
allow a staging origin:

```sh
wrangler var set ORIGIN_ALLOWLIST "https://rocketcrab.com,https://staging.rocketcrab.com"
```

(`ORIGIN_ALLOWLIST`, `MINT_DAILY_CAP`, `MINT_TOTAL_CAP` are not sensitive —
they can live in `[vars]` in `wrangler.toml` or as plain `wrangler var set`;
the two TURN secrets below are the sensitive ones.)

## Worker secrets

Set once after deploy (never commit these; the TURN key is a long-term
secret):

```sh
wrangler secret put TURN_KEY_ID          # e.g. the Cloudflare Realtime key token id
wrangler secret put TURN_KEY_API_TOKEN   # the matching API token
```

Local dev: create a gitignored `deploy/turn-creds/.dev.vars` with the same
names (`wrangler dev` reads it). The repo `.gitignore` now excludes
`.dev.vars` — never commit it.

## KV namespace (TURN_BUDGET)

The budget kill-switch counts successful mints in a KV namespace bound as
`TURN_BUDGET` (declared in `wrangler.toml` with a placeholder id). Create the
namespace once, then paste the id into `wrangler.toml`:

```sh
wrangler kv namespace create TURN_BUDGET
# -> id: <namespace-id>   (paste it into kv_namespaces in wrangler.toml)
```

`wrangler deploy` fails until the placeholder id is replaced (by design — the
kill-switch must exist in prod). In dev, `wrangler dev` uses a local KV
simulator keyed by binding name, so the placeholder id is fine locally.

## Deploy

`workers_dev = true`, deployed as `rocketcrab-turn-creds`:

```sh
cd deploy/turn-creds
wrangler login
wrangler kv namespace create TURN_BUDGET   # once; paste the id into wrangler.toml
wrangler secret put TURN_KEY_ID
wrangler secret put TURN_KEY_API_TOKEN
wrangler deploy
```

The worker appears at
`https://rocketcrab-turn-creds.<your-account-subdomain>.workers.dev`. CI: the
same pipeline pattern as `deploy/relay/.github/workflows/relay.yml`
(cloudflare/wrangler-action, `workingDirectory: deploy/turn-creds`,
secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`); the workflow file
itself is owned by the orchestrator and is not part of this directory.

Smoke test (the mint endpoint rejects missing origins by design, so send
one — any allowlisted origin works):

```sh
curl -si https://rocketcrab-turn-creds.<your-account-subdomain>.workers.dev/ \
  -H "Origin: https://rocketcrab.com" \
  -H "Content-Type: application/json" -d '{}'
```

Expect `200` with `access-control-allow-origin: https://rocketcrab.com` and
an `iceServers` array. A request without `Origin` returns `403`. After
deploy, check the counters moved:

```sh
wrangler kv key list --binding TURN_BUDGET
```

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

- The upstream call always requests `{"ttl": 600}` — a **10-minute** credential
  lifetime, baked into the worker (`MINT_TTL_SECONDS`). Short enough that an
  extracted credential is worthless, long enough for a full party. The client
  cannot change it (request bodies are ignored).
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

Two cheap layers (no external library — Cloudflare platform primitives only):

### 1. In-worker fast-fail check (code-level backstop)

A simple **fixed-window counter keyed by client IP** (`CF-Connecting-IP`,
edge-set and not client-spoofable) in the worker itself. Over the limit, the
worker answers `429` with a `Retry-After` header **before any upstream call**.
The window is 60s; the limit is `RATE_LIMIT_PER_MIN` (default **10/min**).
In-memory per-isolate state is fine here: this is a fast-fail backstop, and
over-counting under concurrency is SAFE (it only ever rejects more
aggressively, never less).

### 2. Cloudflare route-level rate rule (durable backstop)

The worker's own counter resets when an isolate restarts; the durable
backstop is a **Cloudflare rate-limiting rule** on the mint route (zone
level, per IP) via the Rulesets API — wrangler cannot manage rate rules, so
this curl is the reproducibility path. It needs a proxied zone hostname
(custom domain) for the mint route; the workers.dev host has no zone to hang
a rule on. Put the mint on a custom route (e.g. `turn-creds.rocketcrab.com/*`
or `rocketcrab.com/turn-creds/*`), then:

```sh
# 10 requests/min per IP on the mint route (action: block, 60s window)
curl -X PUT \
  "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/rulesets/phases/http_ratelimit/entrypoint" \
  -H "Authorization: Bearer <API_TOKEN>" \
  -H "Content-Type: application/json" \
  --data '{
    "rules": [
      {
        "expression": "(http.request.method eq \"POST\") and (http.request.uri.path starts_with \"/\")",
        "description": "rocketcrab-turn-creds: 10 requests/min per IP",
        "action": "block",
        "ratelimit": {
          "characteristics": ["ip.src"],
          "period": 60,
          "requests_per_period": 10,
          "mitigation_timeout": 60
        }
      }
    ]
  }'
```

(`<ZONE_ID>` and `<API_TOKEN>` come from the zone and an API token with
Zone > Config > Rulesets edit permission.) The same rule is configurable in
the Cloudflare dashboard under Security -> WAF -> Rate limiting rules. Keep
`RATE_LIMIT_PER_MIN` and the rule's `requests_per_period` in sync — both
default to 10/min.

## Budget kill-switch (rocketcrab-23s.4)

Nova users author their own games, so the mint endpoint must never be
abusable enough to blow the account's TURN allowance. The kill-switch is the
**hard stop**: two KV counters, checked on every mint **before any upstream
call**:

| Counter          | Key                | Reset                                    |
| ---------------- | ------------------ | ---------------------------------------- |
| Daily mints      | `mints:YYYY-MM-DD` | Automatic at UTC midnight (new key)      |
| Cumulative mints | `mints:total`      | Manual, by deleting the counters (below) |

On every **successful** mint the worker increments both counters
(read-modify-write; KV has **no atomic increment**, so concurrent mints can
over-count — that is SAFE and correct for a kill-switch: it errs on the safe
side and can only ever trip _early_, never late). When either counter reaches
its cap (`MINT_DAILY_CAP` default **5000**, `MINT_TOTAL_CAP` default
**50000**), the worker answers:

```json
{
  "error": {
    "code": "budget_exceeded",
    "message": "mint budget exhausted: daily cap (5000) reached for 2026-08-13",
    "cap": "daily",
    "limit": 5000
  }
}
```

with HTTP `429`, **no upstream call**, and the usual CORS headers so the
browser can read it. Failed mints (upstream `502`s, bad origins, rate-limit
`429`s) never touch the counters — only credentials that were actually
minted cost allowance.

**Fail-open behavior**: if the `TURN_BUDGET` binding is missing (dev) or KV
is unreachable, the worker logs and **proceeds with the mint**. That is fine
for dev and correct under an outage — abuse stays bounded by the per-IP rate
limiter meanwhile. In prod the binding **must** exist (wrangler.toml has a
placeholder id and `wrangler deploy` fails until it is replaced). Daily
counter keys self-expire after 2 days, so stale day keys never accumulate.

**Mint logging**: every successful mint is logged to the Workers logs as a
JSON line (`event: "turn_cred_mint"`, `ip`, `origin`, `ttl`, `ts`) via
`console.log` — free Workers analytics that feeds the usage watchdog and
makes post-mortems easy.

### Re-arming the counters

The cumulative counter (`mints:total`) only resets when you delete it —
deliberate, so a re-arm is a conscious operator action. To reset the budget
(after, say, raising `MINT_TOTAL_CAP` or fixing an abuse incident):

```sh
wrangler kv key delete mints:total --binding TURN_BUDGET
wrangler kv key delete mints:2026-08-13 --binding TURN_BUDGET   # the daily key for today
```

or delete everything at once from the dashboard (Workers -> KV ->
`TURN_BUDGET`). Daily keys roll over on their own, so only `mints:total`
strictly needs the manual re-arm.

### Why not HMAC refresh tickets / an external rate-limit library?

Deliberately NOT doing: HMAC refresh tickets, per-room quotas, or external
rate-limit libraries. Complexity > value here: the credential TTL (10 min)
means extracted credentials self-expire, the in-worker counter stops
per-IP farming at the source, the zone rule survives isolate restarts, and
the budget kill-switch caps the account-wide worst case. Those layers bound
farming tightly enough for a party app — adding a third-party library or a
refresh-ticket scheme would add attack surface and operational complexity
for no measurable gain.
