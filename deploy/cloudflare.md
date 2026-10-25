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

**One Worker is defined and deployed; it is being extended to be Nova's only
server-side process.** Until the next approved apply it serves only the Classic
CORS relay; the same script gains the `/turn` TURN-mint route on apply.

### `rocketcrab-cors-relay` — the Nova edge Worker

- **Purpose:** one stateless Cloudflare Worker with two browser-only,
  allowlisted endpoints:
  - `POST /turn` — mints one 24 h Cloudflare Realtime TURN credential per
    party join by proxying the credentials API (task `rocketcrab-23s`; F5
    verdict "TURN required", ADR-0003 M3 addendum). Holds the TURN key secret.
  - every other path — the scoped Classic CORS relay: 16 of the 22 prebuilt
    classic games create rooms through third-party endpoints that send no
    `Access-Control-Allow-Origin` headers, so the relay forwards only
    allowlisted room-creation requests and echoes the allowlisted Origin.
  - Neither endpoint is an open proxy, executes game code, or stores rooms.
- **Live URL:** `https://rocketcrab-cors-relay.tannerkrewson.workers.dev`
  (relay verified 2026-08-14; `/turn` appears after the next approved apply).
  The historical script name is kept so the live Worker is not replaced; a
  rename is a separate approved migration.
- **Repo files:** `deploy/edge/worker.ts` (the deployment entry point importing
  the relay and TURN handlers), `deploy/edge/wrangler.toml`, `deploy/edge/README.md`,
  and the handler modules `deploy/relay/worker.ts` and
  `deploy/turn-creds/worker.ts` (each with its own tests). OpenTofu ownership is
  in `deploy/opentofu/`.
- **Env vars (non-secret; OpenTofu `plain_text` bindings):**

  | Variable             | Default                                                                                                            | Meaning                                               |
  | -------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
  | `ORIGIN_ALLOWLIST`   | `https://rocketcrab.com,http://localhost:5173,https://localhost:5173,http://127.0.0.1:5173,https://127.0.0.1:5173` | Origins allowed to call either endpoint               |
  | `RATE_LIMIT_PER_MIN` | `20`                                                                                                               | In-worker per-IP fixed-window limit for each endpoint |
  | `MINT_DAILY_CAP`     | `5000`                                                                                                             | Daily TURN-mint cap (KV-backed, fails open)           |

- **Worker secrets:** `TURN_KEY_ID` + `TURN_KEY_API_TOKEN` (never committed;
  set out of band). The OpenTofu root preserves existing secret bindings but
  does not create or rotate their values. Local dev uses a gitignored
  `deploy/edge/.dev.vars`.
- **KV namespace:** `TURN_BUDGET` holds only `mints:YYYY-MM-DD`. It is the
  account-wide daily issuance stop the per-IP limiter cannot replace; it bounds
  issuance, not already-issued traffic. The OpenTofu resource
  `cloudflare_workers_kv_namespace.turn_budget` owns it.
- **Rate limiting:** the in-worker fast-fail counter plus the optional
  provider-managed **zone-level Rulesets rate rule** (per-IP, block) when a
  proxied custom route or Custom Domain is supplied. A `workers.dev` host has
  no zone for that rule.
- **Deployment state (verified via API 2026-08-14):** the relay script exists;
  the `TURN_BUDGET` KV namespace **does not** exist, so the TURN route has never
  been live. The TURN key also does not exist yet.
- **How to manage:** `cloudflare_workers_script.relay` +
  `cloudflare_workers_script_subdomain.relay` model the live Worker and its
  workers.dev hostname. Import both before any write. OpenTofu consumes the
  Wrangler `--dry-run` bundle of `deploy/edge/worker.ts`; Wrangler is not the
  deployment source of truth.
- **Client wiring:** `apps/nova/src/lib/classic/relay.ts` (relay root) and
  `apps/nova/src/lib/party/turn-creds.ts` (`/turn`); the strict CSP adds the
  edge origin when either env var is set. A sync test keeps the classic client
  endpoint keys and the relay allowlist identical.

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
   paste an ID into the Wrangler config. No namespace exists in the verified
   inventory.
3. **Create or choose the TURN key:** provider v5.24.0 has a
   `cloudflare_calls_turn_app` resource, but it cannot import an existing key
   and exposes the bearer key as sensitive state. Until the coordinator
   chooses that state tradeoff, create/rotate the key in Realtime dashboard or
   API and keep its ID/token as human-managed Worker secrets.
4. **Set the repo CI secrets** (§4): `CLOUDFLARE_API_TOKEN` (scoped:
   Workers Scripts edit + KV + Zone Rulesets) and
   `CLOUDFLARE_ACCOUNT_ID`, under GitHub repo Settings → Secrets and
   variables → Actions.
5. **Choose the edge endpoint and rate-limit policy:** by default the edge
   Worker stays on its workers.dev origin. If you want a stable origin and a
   zone-level rate rule, select either a proxied `turn_custom_route` or
   `turn_custom_domain` plus the real zone ID. A custom domain provisions its
   DNS record and certificate through Cloudflare; a route requires the chosen
   hostname to be proxied. Supply the exact expression through
   `rate_limit_expression` on a route or `turn_rate_limit_expression` for a
   custom domain. A workers.dev host cannot carry this zone rule.
6. **Apply only after review:** import the live relay into OpenTofu first,
   then review the plan. The same script gains `/turn`; its KV/key/secrets and
   optional route must be approved first. This migration task does not apply,
   import, or deploy anything.

## 4. Secrets table

| Secret                  | Scope     | Where set                                              | Needed by                                              |
| ----------------------- | --------- | ------------------------------------------------------ | ------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | Repo (CI) | GitHub → Settings → Secrets and variables → Actions    | OpenTofu plan/review credentials (when CI is approved) |
| `CLOUDFLARE_ACCOUNT_ID` | Repo (CI) | GitHub → Settings → Secrets and variables → Actions    | OpenTofu variable or operator plan input               |
| `TURN_KEY_ID`           | Worker    | `wrangler secret put TURN_KEY_ID` (edge Worker)        | TURN mint: Realtime credentials API path segment       |
| `TURN_KEY_API_TOKEN`    | Worker    | `wrangler secret put TURN_KEY_API_TOKEN` (edge Worker) | TURN mint: `Authorization: Bearer` header              |

Recommended repo-token scope for the CI token: **Workers Scripts → Edit**
(plan/import/apply), **Workers KV Storage → Edit** (KV namespace create/verify),
**Zone → Config → Rulesets → Edit** (rate rule). The edge Worker needs no analytics permission; spend visibility is configured in the Cloudflare
dashboard (budget alerts / Billable Usage notifications).

## 4b. TURN operations

- **Lifecycle:** each participant page mints one 24-hour credential per party
  join and never refreshes it. Cloudflare's 48-hour credential maximum is not
  binding; the TURN allocation itself has no maximum duration while the client
  keeps it alive with authenticated refreshes. A reconnect reuses the cached
  lease; a party started after expiry mints again.
- **Attribution:** one credential per participant (`username` dimension) plus
  the edge `turn_cred_mint` log line. `customIdentifier` is documented for the
  sibling `generate` endpoint, not `generate-ice-servers`, so it is not sent.
- **Cost visibility:** account budget alerts and Billable Usage notifications
  (dashboard; informational, not caps). TURN egress is $0.05/GB with a shared
  Realtime free allowance; per-allocation Cloudflare limits bound a single
  credential, not the account.
- **Emergency controls:** lower/remove `MINT_DAILY_CAP` or the TURN secrets to
  stop issuance; revoke a credential at Cloudflare
  (`POST /v1/turn/keys/<key>/credentials/<username>/revoke`); rotate the TURN
  key in the Realtime dashboard and update Worker secrets. Investigate spikes
  with the GraphQL analytics queries in `deploy/turn-creds/README.md`.
- **Diagnostics:** the app surfaces signaling failure, peer-connection failure,
  TURN-mint failure, disconnect, reconnect attempts/failure and party end as
  distinct notices/states; Worker logs cover mints and upstream failures.

## 5. Live-state verification (as of 2026-08-14)

Queried the Cloudflare API directly (not just this repo's files):

- Workers scripts on the account: `rocketcrab-cors-relay` (modified
  2026-08-13) and `curly-dream-16c4` (modified 2024-08-22 — a pre-existing
  account worker from before Nova; **not a repo resource**, listed so a
  future operator does not mistake it for ours).
- KV namespaces on the account: **none** (no `TURN_BUDGET`, so the `/turn`
  route is not live yet).
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
  resources.** `deploy/opentofu/` models the single edge Worker, the
  TURN_BUDGET KV namespace, its workers.dev subdomain, and optional custom
  domain/zone route/rate-limit resources.
  `.github/workflows/infrastructure-plan.yml` builds bundles with Wrangler
  `--dry-run`, then runs formatting, initialization without a backend,
  validation, and a static `-refresh=false` plan. It never runs `tofu apply` or
  a Wrangler deployment.
- **Wrangler is a build input only.** Its committed edge Worker config and
  source files are used for a local `deploy --dry-run` bundle before an
  OpenTofu plan.
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
