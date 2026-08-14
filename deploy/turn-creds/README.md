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
- **Secrets stay secret**: `TURN_KEY_ID` / `TURN_KEY_API_TOKEN` are set as
  Worker secrets only — never in code, `wrangler.toml`, or the client build.

## Environment variables

| Variable           | Default                                                                                                            | Meaning                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORIGIN_ALLOWLIST` | `https://rocketcrab.com,http://localhost:5173,https://localhost:5173,http://127.0.0.1:5173,https://127.0.0.1:5173` | Comma-separated origins allowed to call the mint endpoint. Each entry may be a full origin (`scheme://host[:port]`); a trailing slash is tolerated. Matching against the request `Origin` is exact. |

A single-variable env override (unset = the default above). For example, to
allow a staging origin:

```sh
wrangler secret put ORIGIN_ALLOWLIST  # not a secret, but see note below
```

(`ORIGIN_ALLOWLIST` is not sensitive — it can live in `[vars]` in
`wrangler.toml` or as a plain `wrangler var set`; the two TURN secrets below
are the sensitive ones.)

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

## Deploy

`workers_dev = true`, deployed as `rocketcrab-turn-creds`:

```sh
cd deploy/turn-creds
wrangler login
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
