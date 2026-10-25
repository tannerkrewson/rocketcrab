# Cloudflare infrastructure - state and reproduction runbook

- **Status:** Live state last verified against the Cloudflare API 2026-08-14;
  re-verify before any import or apply.
- **Purpose:** the inventory and operator runbook for every Cloudflare resource
  Rocketcrab Nova uses. Supported resources are moving to the dedicated
  OpenTofu root at `deploy/opentofu/`; this file remains the live-state record
  and documents provider gaps and one-time account decisions.
- **Drift convention:** see §6. OpenTofu is the intended source of truth for
  supported resources. The validation workflow is format/validate-only; no
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
  - `POST /` — the scoped Classic CORS relay: 16 of the 22 prebuilt classic
    games create rooms through third-party endpoints that send no
    `Access-Control-Allow-Origin` headers, so the relay forwards only
    allowlisted room-creation requests and echoes the allowlisted Origin.
  - any other path — `404` JSON; nothing is forwarded.
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

  | Variable             | Default                                                                                                            | Meaning                                 |
  | -------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
  | `ORIGIN_ALLOWLIST`   | `https://rocketcrab.com,http://localhost:5173,https://localhost:5173,http://127.0.0.1:5173,https://127.0.0.1:5173` | Origins allowed to call either endpoint |
  | `RATE_LIMIT_PER_MIN` | `60`                                                                                                               | Platform per-IP limit for each endpoint |

- **Worker secrets:** `TURN_KEY_ID` + `TURN_KEY_API_TOKEN` (never committed;
  set out of band). The OpenTofu root preserves existing secret bindings but
  does not create or rotate their values. Local dev uses a gitignored
  `deploy/edge/.dev.vars`.
- **Rate limiting:** the Cloudflare Workers Rate Limiting binding
  (`RATE_LIMITER`) is primary; the in-memory counter is only a local-dev/test
  fallback. An optional provider-managed **zone-level Rulesets rate rule**
  (per-IP, block) can be added when a proxied custom route or Custom Domain is
  supplied and the WAF plan supports `ip.src` (not Free).
- **Deployment state (verified via API 2026-08-14):** the relay script exists;
  no KV namespace exists, and the `/turn` route plus TURN key have never been
  live. Re-check the inventory before importing.
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
2. **Create or choose the TURN key:** provider v5.24.0 has a
   `cloudflare_calls_turn_app` resource, but it cannot import an existing key
   and exposes the bearer key as sensitive state. Until the coordinator
   chooses that state tradeoff, create/rotate the key in Realtime dashboard or
   API and keep its ID/token as human-managed Worker secrets.
3. **Choose the edge endpoint and optional rate policy:** by default the edge
   Worker stays on its workers.dev origin. If you want a stable origin, select
   either a proxied `turn_custom_route` or `turn_custom_domain` plus the real
   zone ID. A custom domain provisions its DNS record and certificate through
   Cloudflare; a route requires the chosen hostname to be proxied. The Worker's
   `RATE_LIMITER` binding is independent of this choice. A zone-level
   `ip.src` rate rule additionally needs a WAF plan that supports it (not Free)
   and is off by default; supply the exact expression through
   `rate_limit_expression` on a route or `turn_rate_limit_expression` for a
   custom domain.
4. **Apply only after review:** import the live relay into OpenTofu first,
   then review the plan. The same script gains `/turn`; its key/secrets and
   optional route must be approved first. This runbook does not apply, import,
   or deploy anything.

## 4. Secrets table

| Secret                  | Scope    | Where set                                              | Needed by                                        |
| ----------------------- | -------- | ------------------------------------------------------ | ------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | Operator | Local environment (never committed)                    | OpenTofu refresh-enabled plan/apply              |
| `CLOUDFLARE_ACCOUNT_ID` | Operator | Ignored `terraform.tfvars` or `-var`                   | OpenTofu account variable                        |
| `TURN_KEY_ID`           | Worker   | `wrangler secret put TURN_KEY_ID` (edge Worker)        | TURN mint: Realtime credentials API path segment |
| `TURN_KEY_API_TOKEN`    | Worker   | `wrangler secret put TURN_KEY_API_TOKEN` (edge Worker) | TURN mint: `Authorization: Bearer` header        |

Recommended operator API token scope: **Workers Scripts → Edit**
(plan/import/apply) and **Zone → Config → Rulesets → Edit** (rate rule). The
state bucket uses a separate R2 S3 token. The edge Worker needs no analytics
permission; spend visibility is configured in the Cloudflare dashboard (budget
alerts / Billable Usage notifications). CI does not hold a Cloudflare token.

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
- **Emergency controls:** remove/rotate the TURN secrets to stop issuance;
  revoke a credential at Cloudflare
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
- KV namespaces on the account: **none** (Nova no longer uses KV; the old
  daily-counter design was removed because KV cannot enforce it atomically).
- Custom domains bound to Workers: **none** (both workers are
  workers.dev-only; the optional zone rate rule would need a custom domain or
  proxied route, but the Worker's platform rate-limit binding does not).
- Relay reachable at
  `https://rocketcrab-cors-relay.tannerkrewson.workers.dev`
  (`403` without an allowlisted `Origin`, `405` on a GET with one, and `404`
  JSON on unknown paths = alive; it is a POST-only endpoint).

Re-verify any time with:

```sh
curl -s https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts \
  -H "Authorization: Bearer <API_TOKEN>"
curl -s https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/storage/kv/namespaces \
  -H "Authorization: Bearer <API_TOKEN>"
```

## 6. Drift convention

- **OpenTofu is the intended source of truth for supported Cloudflare
  resources.** `deploy/opentofu/` models the single edge Worker, its
  workers.dev subdomain, and optional custom domain/zone route/rate-limit
  resources.
  `.github/workflows/infrastructure-plan.yml` builds the edge bundle with
  Wrangler `--dry-run`, then runs formatting, initialization without a backend,
  and validation. It never plans (that needs remote state), applies, or deploys
  with Wrangler.
- **Wrangler is a build input only.** Its committed edge Worker config and
  source files are used for a local `deploy --dry-run` bundle before an
  OpenTofu plan.
  The old relay deployment workflow was removed rather than left as a second
  infrastructure authority.
- **Anything changed in the dashboard or via MCP must be recorded here**:
  new Workers, env vars, secrets, rate rules, custom domains/workers.dev
  subdomain changes. If a change is made outside CI (dashboard edit,
  `wrangler var set`, rate-rule tweak), update this file in the same change.
- **Deletions:** removing a Cloudflare resource (e.g. an undeployed worker)
  also removes it from this inventory.

The OpenTofu migration details, import commands, state-backend questions, and
provider limitations are maintained in `deploy/opentofu/README.md`.
