# Cloudflare infrastructure - state and reproduction runbook

- **Status:** Live state verified against the Cloudflare API 2026-08-14.
- **Purpose:** the inventory and operator runbook for every Cloudflare resource
  Rocketcrab Nova uses. Supported resources are moving to the dedicated
  OpenTofu root at `deploy/opentofu/`; this file remains the live-state record
  and documents provider gaps and one-time account decisions.
- **Drift convention:** see §6. OpenTofu is the intended source of truth for
  supported resources. The validation workflow is plan/validate-only; no
  Wrangler deployment workflow is retained.

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
  CORS headers echoing the allowlisted origin (task `rocketcrab-9fv.7.33`,
  hardening `rocketcrab-9fv.3.5`). It is an allowlist-only forwarder — never
  an open proxy — with an origin allowlist (403 before forwarding) and
  per-IP rate limiting (429 + Retry-After), mirroring the turn-creds Worker.
- **Live URL:** `https://rocketcrab-cors-relay.tannerkrewson.workers.dev`
  (verified responding 2026-08-14).
- **Repo files:** `deploy/relay/worker.ts` (self-contained, zero imports;
  endpoint allowlist lives in `RELAY_ENDPOINTS`), `deploy/relay/wrangler.toml`
  (`name = "rocketcrab-cors-relay"`, `workers_dev = true`,
  `compatibility_date = "2025-01-01"`), `deploy/relay/README.md`
  (+ `worker.test.ts`). OpenTofu ownership is defined in
  `deploy/opentofu/`.
- **Worker env / secrets:** two optional non-secret vars, both with safe
  in-code defaults (see `deploy/relay/README.md`): `ORIGIN_ALLOWLIST`
  (comma-separated origins; default `https://rocketcrab.com` +
  localhost dev origins on `:5173`) and `RATE_LIMIT_PER_MIN` (default 20).
  No Worker secrets. The only credentials involved are the repo CI secrets
  (§4). `VITE_CLASSIC_RELAY_ORIGIN` is a _client_ build-time var baked into
  the Nova app's CSP `connect-src` — it is not a Worker setting.
- **How to manage:** `cloudflare_workers_script.relay` and
  `cloudflare_workers_script_subdomain.relay` in `deploy/opentofu/` model the
  live Worker and its workers.dev hostname. Import both before any write.
  OpenTofu consumes a local Wrangler `--dry-run` bundle of this TypeScript
  source; Wrangler is not the deployment source of truth.
- **Client wiring:** `apps/nova/src/lib/classic/relay.ts` +
  `apps/nova/vite.config.ts` (CSP); a sync test
  (`apps/nova/src/lib/classic/relay-worker.test.ts`) keeps the client keys
  and the worker allowlist identical.

### b. `rocketcrab-turn-creds` — DESIGNED, NOT YET DEPLOYED

- **Purpose:** TURN credential mint endpoint. Nova is backendless, so this
  Worker is the one tiny serverless endpoint that mints **short-lived TURN
  credentials** (one 24 h credential per party) at party-join time by proxying
  Cloudflare Realtime's credentials API (task `rocketcrab-23s`; F5 verdict
  "TURN required", ADR-0003 M3 addendum). Stateless, no game code, with an
  origin allowlist, per-IP rate limiting, and a KV-backed issuance kill-switch.
  Spend visibility uses native Cloudflare budget alerts / Billable Usage
  notifications instead of a custom watchdog; the client keeps the credential
  for the whole party and does not re-mint.
- **Deployment state (verified via API 2026-08-14):** the Worker **does not
  exist** on the account yet, and the `TURN_BUDGET` KV namespace **does not
  exist** either. Nothing to tear down; create it when the party flow needs it.
  The GitHub Actions workflow for this infrastructure is validation-only at
  `.github/workflows/infrastructure-plan.yml`.
- **Repo files:** `deploy/turn-creds/worker.ts` (+ `worker.test.ts`),
  `wrangler.toml`, and `README.md`. **The README is the full operator manual**
  (deploy steps, allowlist/CORS behavior, rate limiting, kill-switch, TTL,
  native usage alerts); this runbook summarizes the state and points at it
  rather than duplicating it.
- **`wrangler.toml` (as committed):** `name = "rocketcrab-turn-creds"`,
  `workers_dev = true`, the `TURN_BUDGET` KV binding (placeholder id
  `REPLACE_WITH_KV_NAMESPACE_ID`). There is no cron trigger.

- **Env vars (non-secret; OpenTofu `plain_text` bindings):**

  | Variable             | Default                                                                                                            | Meaning                                                         |
  | -------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
  | `ORIGIN_ALLOWLIST`   | `https://rocketcrab.com,http://localhost:5173,https://localhost:5173,http://127.0.0.1:5173,https://127.0.0.1:5173` | Comma-separated origins allowed to call the mint endpoint       |
  | `RATE_LIMIT_PER_MIN` | `10`                                                                                                               | In-worker per-IP fixed-window rate limit (60 s)                 |
  | `MINT_DAILY_CAP`     | `5000`                                                                                                             | Daily mint kill-switch cap                                      |
  | `MINT_TOTAL_CAP`     | `50000`                                                                                                            | Cumulative mint kill-switch cap (re-armed by deleting counters) |

- **Worker secrets** (`wrangler secret put`, never committed — the TURN key
  is a long-term secret): `TURN_KEY_ID` + `TURN_KEY_API_TOKEN`. The OpenTofu
  root preserves existing secret bindings but does not create or rotate their
  values.
  Local dev uses a gitignored `deploy/turn-creds/.dev.vars`.
- **KV namespace:** `TURN_BUDGET` — mint counters (`mints:YYYY-MM-DD`,
  `mints:total`) for the kill-switch. The OpenTofu resource
  `cloudflare_workers_kv_namespace.turn_budget` owns it; the placeholder in
  the legacy Wrangler config is not state.
- **Rate limiting:** two layers — the in-worker fast-fail counter
  (`RATE_LIMIT_PER_MIN`) and the optional provider-managed **zone-level
  Rulesets rate rule** (per-IP, block at the same configured limit on the mint
  route). Choose either a proxied custom route or a Workers Custom Domain and
  provide the exact route/expression choice; the workers.dev host has no zone
  to hang the rule on. The OpenTofu resource keeps `requests_per_period` in
  sync with the Worker binding.
- **Recreate:** use `deploy/opentofu/` after the state, route, TURN key, and
  secret decisions below are approved. This task does not apply or import.

## 3. One-time account steps (recreate-on-fresh-account checklist)

1. **Enable the account workers.dev subdomain.** Either the dashboard (Workers &
   Pages → Workers → enable Workers.dev, subdomain `tannerkrewson`) or:
   `POST https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/subdomain`
   with body `{"subdomain":"tannerkrewson"}`. The subdomain is the root of
   every `<name>.tannerkrewson.workers.dev` URL. OpenTofu separately enables
   each managed script's workers.dev hostname through
   `cloudflare_workers_script_subdomain`.
2. **Create the KV namespace:** the OpenTofu resource
   `cloudflare_workers_kv_namespace.turn_budget` owns `TURN_BUDGET`; do not
   paste an ID into the legacy Wrangler config. No namespace exists in the
   verified inventory.
3. **Create or choose the TURN key:** provider v5.24.0 has a
   `cloudflare_calls_turn_app` resource, but it cannot import an existing key
   and exposes the bearer key as sensitive state. Until the coordinator
   chooses that state tradeoff, create/rotate the key in Realtime dashboard or
   API and keep its ID/token as human-managed Worker secrets.
4. **Set the repo CI secrets** (§4): `CLOUDFLARE_API_TOKEN` (scoped:
   Workers Scripts edit + KV + Zone Rulesets) and
   `CLOUDFLARE_ACCOUNT_ID`, under GitHub repo Settings → Secrets and
   variables → Actions.
5. **Choose the TURN endpoint and rate-limit policy:** select either a proxied
   `turn_custom_route` or `turn_custom_domain`, plus the real zone ID. A
   custom domain provisions its DNS record and certificate through Cloudflare;
   a route requires the chosen hostname to be proxied. If the
   zone-level rule stays enabled, supply its exact POST expression through the
   selected OpenTofu input (`rate_limit_expression` on a route or
   `turn_rate_limit_expression` for a custom domain). A workers.dev host
   cannot carry this zone rule.
6. **Apply only after review:** import the live relay into OpenTofu first,
   then review the plan. Create the planned TURN Worker only
   after the KV/key/secrets, route, and state-backend decisions are approved.
   This migration task does not apply, import, or deploy anything.

## 4. Secrets table

| Secret                  | Scope     | Where set                                             | Needed by                                              |
| ----------------------- | --------- | ----------------------------------------------------- | ------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | Repo (CI) | GitHub → Settings → Secrets and variables → Actions   | OpenTofu plan/review credentials (when CI is approved) |
| `CLOUDFLARE_ACCOUNT_ID` | Repo (CI) | GitHub → Settings → Secrets and variables → Actions   | OpenTofu variable or operator plan input               |
| `TURN_KEY_ID`           | Worker    | `wrangler secret put TURN_KEY_ID` (turn-creds)        | turn-creds mint: Realtime credentials API path segment |
| `TURN_KEY_API_TOKEN`    | Worker    | `wrangler secret put TURN_KEY_API_TOKEN` (turn-creds) | turn-creds mint: `Authorization: Bearer` header        |

Recommended repo-token scope for the CI token: **Workers Scripts → Edit**
(plan/import/apply), **Workers KV Storage → Edit** (KV namespace create/verify),
**Zone → Config → Rulesets → Edit** (rate rule). The relay and turn-creds Workers
need no analytics permission; spend visibility is configured in the Cloudflare
dashboard (budget alerts / Billable Usage notifications).

## 5. Live-state verification (as of 2026-08-14)

Queried the Cloudflare API directly (not just this repo's files):

- Workers scripts on the account: `rocketcrab-cors-relay` (modified
  2026-08-13) and `curly-dream-16c4` (modified 2024-08-22 — a pre-existing
  account worker from before Nova; **not a repo resource**, listed so a
  future operator does not mistake it for ours).
- KV namespaces on the account: **none** (no `TURN_BUDGET` — confirms
  turn-creds is undeployed).
- Custom domains bound to Workers: **none** (both workers are
  workers.dev-only; the rate rule needs a custom domain or a proxied custom
  route before it can be applied).
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

- **OpenTofu is the intended source of truth for supported Cloudflare
  resources.** `deploy/opentofu/` models both Workers, the TURN_BUDGET KV
  namespace, per-script workers.dev subdomains, and
  optional custom domain/zone route/rate-limit resources.
  `.github/workflows/infrastructure-plan.yml` builds bundles with Wrangler
  `--dry-run`, then runs formatting, initialization without a backend,
  validation, and a static `-refresh=false` plan. It never runs `tofu apply` or
  a Wrangler deployment.
- **Wrangler is a build input only.** Its committed Worker configs and source
  files are used for a local `deploy --dry-run` bundle before an OpenTofu plan.
  The old relay deployment workflow was removed rather than left as a second
  infrastructure authority.
- **Anything changed in the dashboard or via MCP must be recorded here**:
  new Workers, KV namespaces, env vars, secrets, rate rules,
  custom domains/workers.dev subdomain changes. If a change is made outside
  CI (dashboard edit, `wrangler var set`, manual KV delete, rate-rule
  tweak), update this file in the same change.
- **Deletions:** removing a Cloudflare resource (e.g. an undeployed worker,
  a dead KV namespace) also removes it from this inventory.

The OpenTofu migration details, import commands, state-backend questions, and
provider limitations are maintained in `deploy/opentofu/README.md`.
