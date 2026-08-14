# Cloudflare infrastructure — state and reproduction runbook

- **Status:** Live state verified against the Cloudflare API 2026-08-14.
- **Purpose:** the single source of truth for every Cloudflare resource
  Rocketcrab Nova uses, and a recreate-on-a-fresh-account checklist that
  makes the infra reproducible **without Terraform** — `wrangler` plus
  documented one-time steps.
- **Drift convention:** see §6. CI workflows are the deploy source of truth;
  anything changed in the dashboard / via MCP gets recorded here.

## 1. Account facts

| Fact                  | Value                                             |
| --------------------- | ------------------------------------------------- |
| Account id            | `f82d64d09da6cb5a0afa0120033a7e13`                |
| Account name          | "Tannerkrewson@gmail.com's Account"               |
| workers.dev subdomain | `tannerkrewson`                                   |
| Worker URLs           | `https://<worker-name>.tannerkrewson.workers.dev` |

Where to find them in the dashboard:

- **Account id:** Workers & Pages → Overview → "Account ID" in the right
  sidebar; or `GET https://api.cloudflare.com/client/v4/accounts` (the id is
  the account-scope value used in every API URL and `wrangler`'s
  `--account-id` / `CLOUDFLARE_ACCOUNT_ID`).
- **workers.dev subdomain:** Workers & Pages → Workers → Settings →
  "Workers.dev" (the subdomain is account-wide; changing it re-roots every
  `<name>.tannerkrewson.workers.dev` URL).

## 2. Resource inventory (repo ⇄ Cloudflare, today)

Two Workers are defined in this repo. **One is deployed; the other is
designed but not yet deployed** (verified live 2026-08-14).

### a. `rocketcrab-cors-relay` — DEPLOYED

- **Purpose:** scoped CORS relay for classic room-creation endpoints. 16 of
  the 22 ported classic games create rooms by fetching third-party endpoints
  that send no `Access-Control-Allow-Origin` headers; the relay forwards
  those requests from the server side and returns the upstream JSON with
  permissive CORS headers (beads `rocketcrab-9fv.7.33`). It is an
  allowlist-only forwarder — never an open proxy.
- **Live URL:** `https://rocketcrab-cors-relay.tannerkrewson.workers.dev`
  (verified responding 2026-08-14).
- **Repo files:** `deploy/relay/worker.ts` (self-contained, zero imports;
  endpoint allowlist lives in `RELAY_ENDPOINTS`), `deploy/relay/wrangler.toml`
  (`name = "rocketcrab-cors-relay"`, `workers_dev = true`,
  `compatibility_date = "2025-01-01"`), `deploy/relay/README.md`, and the CI
  workflow `.github/workflows/relay.yml`.
- **Worker env / secrets:** **none.** The relay takes no environment
  variables and no Worker secrets. The only credentials involved are the repo
  CI secrets (§4). `VITE_CLASSIC_RELAY_ORIGIN` is a _client_ build-time var
  baked into the Nova app's CSP `connect-src` — it is not a Worker setting.
- **How to recreate:** push to `nova` touching `deploy/relay/**` (triggers
  `.github/workflows/relay.yml`) or run the workflow manually; equivalent
  manual path: `cd deploy/relay && wrangler login && wrangler deploy`.
- **Client wiring:** `apps/nova/src/lib/classic/relay.ts` +
  `apps/nova/vite.config.ts` (CSP); a sync test
  (`apps/nova/src/lib/classic/relay-worker.test.ts`) keeps the client keys
  and the worker allowlist identical.

### b. `rocketcrab-turn-creds` — DESIGNED, NOT YET DEPLOYED

- **Purpose:** TURN credential mint endpoint. Nova is backendless, so this
  Worker is the one tiny serverless endpoint that mints **short-lived TURN
  credentials** (TTL 600 s) at party-join time by proxying Cloudflare
  Realtime's credentials API (beads `rocketcrab-23s`; F5 verdict "TURN
  required", ADR-0003 M3 addendum). Stateless, no game code, with an origin
  allowlist, per-IP rate limiting, a KV-backed budget kill-switch, and a
  daily usage watchdog.
- **Deployment state (verified via API 2026-08-14):** the Worker **does not
  exist** on the account yet, and the `TURN_BUDGET` KV namespace **does not
  exist** either. Nothing to tear down; deploy when the party flow needs it.
  The GitHub Actions workflow for it is owned by the orchestrator and is not
  yet in-tree (see §6).
- **Repo files:** `deploy/turn-creds/worker.ts`, `watchdog.ts`
  (+ `worker.test.ts`, `watchdog.test.ts`), `wrangler.toml`, and
  `README.md`. **The README is the full operator manual** (deploy steps,
  allowlist/CORS behavior, rate limiting, kill-switch, watchdog); this
  runbook summarizes the state and points at it rather than duplicating it.
- **`wrangler.toml` (as committed):** `name = "rocketcrab-turn-creds"`,
  `workers_dev = true`, the `TURN_BUDGET` KV binding (placeholder id
  `REPLACE_WITH_KV_NAMESPACE_ID`), and the daily 09:00 UTC watchdog cron:

  ```toml
  kv_namespaces = [{ binding = "TURN_BUDGET", id = "REPLACE_WITH_KV_NAMESPACE_ID" }]
  [triggers]
  crons = ["0 9 * * *"]
  ```

- **Env vars (non-secret; `[vars]` or `wrangler var set`):**

  | Variable             | Default                                                                                                            | Meaning                                                         |
  | -------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
  | `ORIGIN_ALLOWLIST`   | `https://rocketcrab.com,http://localhost:5173,https://localhost:5173,http://127.0.0.1:5173,https://127.0.0.1:5173` | Comma-separated origins allowed to call the mint endpoint       |
  | `RATE_LIMIT_PER_MIN` | `10`                                                                                                               | In-worker per-IP fixed-window rate limit (60 s)                 |
  | `MINT_DAILY_CAP`     | `5000`                                                                                                             | Daily mint kill-switch cap                                      |
  | `MINT_TOTAL_CAP`     | `50000`                                                                                                            | Cumulative mint kill-switch cap (re-armed by deleting counters) |
  | `WATCHDOG_GB_BUDGET` | `200`                                                                                                              | Monthly TURN egress budget (GiB) the watchdog alerts against    |
  | `ALERT_WEBHOOK_URL`  | _(unset → console.log only)_                                                                                       | Webhook for watchdog alerts                                     |

- **Worker secrets** (`wrangler secret put`, never committed — the TURN key
  is a long-term secret): `TURN_KEY_ID` + `TURN_KEY_API_TOKEN` (the Realtime
  TURN key), plus `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (Account
  Analytics permission — the watchdog queries the GraphQL analytics API).
  Local dev uses a gitignored `deploy/turn-creds/.dev.vars`.
- **KV namespace:** `TURN_BUDGET` — mint counters (`mints:YYYY-MM-DD`,
  `mints:total`) for the kill-switch plus the watchdog's alert watermarks
  (`last-alerted:<pct>`). Created once with
  `wrangler kv namespace create TURN_BUDGET`; the returned id goes into
  `wrangler.toml`. `wrangler deploy` fails until the placeholder id is
  replaced (by design — the kill-switch must exist in prod).
- **Cron trigger:** `0 9 * * *` daily — fires the `scheduled` handler
  (watchdog). Manual trigger for dev/smoke: `GET /__watchdog`.
- **Rate limiting:** two layers — the in-worker fast-fail counter
  (`RATE_LIMIT_PER_MIN`) and a durable **zone-level Rulesets rate rule**
  (per-IP, block 10/min on the mint route). `wrangler` cannot manage rate
  rules, so the reproducibility path is the Rulesets curl documented in
  `deploy/turn-creds/README.md` §"Rate limiting" — reference that, and keep
  the rule's `requests_per_period` in sync with `RATE_LIMIT_PER_MIN`. Note
  it needs a proxied zone hostname (custom route); the workers.dev host has
  no zone to hang the rule on.
- **Recreate:** follow `deploy/turn-creds/README.md` §Deploy step by step
  (login → KV namespace → secrets → `wrangler deploy`), then the one-time
  account steps below.

## 3. One-time account steps (recreate-on-fresh-account checklist)

1. **Enable the workers.dev subdomain.** Either the dashboard (Workers &
   Pages → Workers → enable Workers.dev, subdomain `tannerkrewson`) or:
   `POST https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/subdomain`
   with body `{"subdomain":"tannerkrewson"}`. The subdomain is the root of
   every `<name>.tannerkrewson.workers.dev` URL.
2. **Create the KV namespace:** `cd deploy/turn-creds && wrangler kv namespace
create TURN_BUDGET` → paste the returned id into `kv_namespaces` in
   `deploy/turn-creds/wrangler.toml` (replace `REPLACE_WITH_KV_NAMESPACE_ID`).
   Commit the id — it is not secret.
3. **Create the TURN key** in the Cloudflare Realtime dashboard (Realtime →
   TURN → Keys → Create). The **Token ID** becomes Worker secret
   `TURN_KEY_ID`; the **API token** becomes `TURN_KEY_API_TOKEN` (shown once
   at creation — copy it then).
4. **Set the repo CI secrets** (§4): `CLOUDFLARE_API_TOKEN` (scoped:
   Workers Scripts edit + KV + Zone Rulesets + Account Analytics) and
   `CLOUDFLARE_ACCOUNT_ID`, under GitHub repo Settings → Secrets and
   variables → Actions.
5. **Apply the rate-limit rule** once the mint endpoint is reachable on a
   proxied zone hostname — the Rulesets curl in
   `deploy/turn-creds/README.md` §"Rate limiting" (or Security → WAF →
   Rate limiting rules in the dashboard).
6. **Deploy:** relay first (existing CI workflow; or `wrangler deploy` in
   `deploy/relay`), then the turn-creds Worker via
   `deploy/turn-creds/README.md` §Deploy. Verify with the smoke tests in
   each README (relay: hit an endpoint key; turn-creds: curl with an
   allowlisted `Origin`, expect `200` + `iceServers`).

## 4. Secrets table

| Secret                  | Scope     | Where set                                                | Needed by                                                                  |
| ----------------------- | --------- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Repo (CI) | GitHub → Settings → Secrets and variables → Actions      | `relay.yml` (and the future turn-creds workflow): `wrangler-action` deploy |
| `CLOUDFLARE_ACCOUNT_ID` | Repo (CI) | GitHub → Settings → Secrets and variables → Actions      | `relay.yml` (and the future turn-creds workflow): `wrangler-action` deploy |
| `TURN_KEY_ID`           | Worker    | `wrangler secret put TURN_KEY_ID` (turn-creds)           | turn-creds mint: Realtime credentials API path segment                     |
| `TURN_KEY_API_TOKEN`    | Worker    | `wrangler secret put TURN_KEY_API_TOKEN` (turn-creds)    | turn-creds mint: `Authorization: Bearer` header                            |
| `CLOUDFLARE_ACCOUNT_ID` | Worker    | `wrangler secret put CLOUDFLARE_ACCOUNT_ID` (turn-creds) | turn-creds watchdog: GraphQL `accountTag`                                  |
| `CLOUDFLARE_API_TOKEN`  | Worker    | `wrangler secret put CLOUDFLARE_API_TOKEN` (turn-creds)  | turn-creds watchdog: GraphQL auth ("Account Analytics" permission)         |

Recommended repo-token scope for the CI token: **Workers Scripts → Edit**
(deploy), **Workers KV Storage → Edit** (KV namespace create/verify),
**Zone → Config → Rulesets → Edit** (rate rule), **Account Analytics →
Read** (watchdog parity). The relay itself needs no secrets at all.

## 5. Live-state verification (as of 2026-08-14)

Queried the Cloudflare API directly (not just this repo's files):

- Workers scripts on the account: `rocketcrab-cors-relay` (modified
  2026-08-13) and `curly-dream-16c4` (modified 2024-08-22 — a pre-existing
  account worker from before Nova; **not a repo resource**, listed so a
  future operator does not mistake it for ours).
- KV namespaces on the account: **none** (no `TURN_BUDGET` — confirms
  turn-creds is undeployed).
- Custom domains bound to Workers: **none** (both workers are
  workers.dev-only; the rate rule needs a custom route before it can be
  applied).
- Relay reachable at
  `https://rocketcrab-cors-relay.tannerkrewson.workers.dev`
  (405 `method not allowed` on `/` and structured `missing endpoint` errors
  on unknown paths = alive; it is a POST-only endpoint).

Re-verify any time with:

```sh
curl -s https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts \
  -H "Authorization: Bearer <API_TOKEN>"
curl -s https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/storage/kv/namespaces \
  -H "Authorization: Bearer <API_TOKEN>"
```

## 6. Drift convention

- **CI workflows are the source of truth for deploys.** Today that is
  `.github/workflows/relay.yml` (deploys on push to `nova` touching
  `deploy/relay/**`, or manual dispatch). The turn-creds workflow follows
  the same pattern and is owned by the orchestrator (see
  `deploy/turn-creds/README.md` §Deploy); when it lands it becomes the
  source of truth for that Worker.
- **Anything changed in the dashboard or via MCP must be recorded here**:
  new Workers, KV namespaces, cron triggers, env vars, secrets, rate rules,
  custom domains/workers.dev subdomain changes. If a change is made outside
  CI (dashboard edit, `wrangler var set`, manual KV delete, rate-rule
  tweak), update this file in the same change.
- **Deletions:** removing a Cloudflare resource (e.g. an undeployed worker,
  a dead KV namespace) also removes it from this inventory.
