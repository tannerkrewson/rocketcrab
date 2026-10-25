# OpenTofu Cloudflare root

This is the repository-managed OpenTofu root for the supported Cloudflare
infrastructure. It is intended to replace the old Wrangler deployment workflow
as the infrastructure source of truth. No command in this directory applies,
imports, deletes, or deploys anything automatically.

## Managed resources

- `cloudflare_workers_script.relay` manages the single deployed edge Worker
  (`rocketcrab-cors-relay`: Classic CORS relay + `/turn` TURN mint), its
  non-secret variables, and the Workers Rate Limiting binding (`RATE_LIMITER`).
  The bundle entry point is `deploy/edge/worker.ts`, which imports the relay and
  TURN handler modules. There is no KV, database, or Durable Object binding.
- `cloudflare_workers_script_subdomain.relay` enables the Worker's workers.dev
  hostname. The account-level workers.dev subdomain is a human prerequisite.
- `cloudflare_workers_route.turn` and
  `cloudflare_workers_custom_domain.turn` are mutually exclusive optional
  endpoint choices for the same edge Worker. `cloudflare_ruleset.turn_rate_limit`
  is optional, off by default, and uses the `http_ratelimit` phase with
  `ip.src`. Enable it only on a WAF plan that supports source-IP rate rules.
- Worker secrets (`TURN_KEY_ID`, `TURN_KEY_API_TOKEN`) are set outside
  OpenTofu. The root preserves existing `secret_text` bindings but never creates
  or rotates their values.

There is no second Worker and no application database. The historical script
name `rocketcrab-cors-relay` is kept so the live resource is not replaced; a
rename would be a separate approved migration.

The Worker source of truth remains TypeScript: `deploy/edge/worker.ts` plus the
handler modules `deploy/relay/worker.ts` and `deploy/turn-creds/worker.ts`.
Cloudflare does not transpile TypeScript on upload, so OpenTofu consumes the
generated JavaScript bundle rather than pretending that raw TypeScript is
deployable.

## Authentication safety

`wrangler login` uses Cloudflare OAuth and grants this machine a **write-capable**
session for the account; it is not a read-only token. For the initial inventory,
run only read commands (`wrangler whoami`, `wrangler deployments list`, `wrangler
kv namespace list`, `wrangler r2 bucket list`, `wrangler pages project list`) and
do not run `deploy`, `secret put`, `r2 bucket create/delete`, or any apply until
the owner explicitly authorizes it. Revoke the Wrangler session in the Cloudflare
dashboard when finished if desired.

OpenTofu does **not** use the Wrangler OAuth session. It reads a separate scoped
`CLOUDFLARE_API_TOKEN` from the environment. Create that token only when the
owner approves provisioning, with Workers Scripts edit (and Zone read/routes/
ruleset edit if a custom hostname or zone rule is chosen). The R2 state bucket
uses a separate R2 S3 access key (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`).

## Safe validation (no state)

From the repository root, use Wrangler only for a local compile dry run. The
`--dry-run` flag compiles and writes files without uploading or changing
Cloudflare. The commands pin the Wrangler release used for this migration.
These commands must run before `tofu plan` because the bundles are ignored
build output:

```sh
npx --yes wrangler@4.127.1 deploy deploy/edge/worker.ts \
  --config deploy/edge/wrangler.toml \
  --dry-run --outdir "$PWD/deploy/opentofu/.build/edge"
```

Use the absolute `$PWD/...` output path: with some Wrangler versions a relative
`--outdir` under the ignored `.build` directory writes only the README and no
`worker.js`. Do not commit any generated bundle.

Then validate without touching state:

```sh
tofu -chdir=deploy/opentofu init -backend=false
tofu -chdir=deploy/opentofu validate
```

`CLOUDFLARE_API_TOKEN` is read from the environment by the provider; supply the
account ID with an ignored tfvars file or `-var`. Never commit an API token,
Worker secret, state file, `.terraform` directory, backend config or bundle.

**Planning requires the remote backend.** After the R2 bootstrap below,
initialize with `-backend-config=backend.hcl` and run a refresh-enabled plan:

```sh
tofu -chdir=deploy/opentofu init -backend-config=backend.hcl
tofu -chdir=deploy/opentofu plan
```

The repository workflow builds the edge bundle with Wrangler `--dry-run`, then
runs non-mutating `fmt`, `init -backend=false`, and `validate`. It deliberately
does **not** plan: a backend-blocked configuration cannot plan without state,
and CI has no R2 credentials. Planning is an explicit operator step with real
state. CI never runs `tofu apply` or a Wrangler deployment.

## State, locking, and backups (R2)

State lives in a private Cloudflare R2 bucket, not in Git and not on a laptop.
`backend.tf` is a partial S3-compatible backend; bucket and endpoint come from
an ignored `backend.hcl` (copy `backend.hcl.example`). Credentials come from
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` for a bucket-scoped R2 token with
Object Read & Write. The provider token remains `CLOUDFLARE_API_TOKEN`.

One-time bootstrap (no OpenTofu apply; creates a billable R2 bucket only after
owner approval):

```sh
wrangler r2 bucket create rocketcrab-tofu-state
# R2 dashboard/API: create a bucket-scoped Object Read & Write token.
cp deploy/opentofu/backend.hcl.example deploy/opentofu/backend.hcl
# replace the account ID in backend.hcl
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
tofu -chdir=deploy/opentofu init -backend-config=backend.hcl
```

`use_lockfile = true` uses S3-compatible conditional writes for locking (R2
supports them; confirm on first use). If the bucket does not exist, init fails
loudly — do not fall back to a committed or shared local state.

Before any approved apply, take a backup:

```sh
tofu -chdir=deploy/opentofu state pull > "state-$(date -u +%Y%m%dT%H%M%SZ).json"
```

Keep the backup outside the repo. Restore only with an explicitly reviewed
`tofu state push <file>` after confirming the target workspace. Never hand-edit
state. The repository ignores `*.tfstate*`, `*.tfvars`, `backend.hcl`, and
`.terraform/`.

## Ownership and import strategy

The relay Worker is live; the TURN route, custom route/domain and optional rate
rule are not. Import the live relay and its workers.dev subdomain before any
write; do not import or create the rest until the owner approves provisioning.

```sh
tofu -chdir=deploy/opentofu import \
  cloudflare_workers_script.relay \
  "<CLOUDFLARE_ACCOUNT_ID>/rocketcrab-cors-relay"
tofu -chdir=deploy/opentofu import \
  cloudflare_workers_script_subdomain.relay \
  "<CLOUDFLARE_ACCOUNT_ID>/rocketcrab-cors-relay"
```

Both import IDs are `<account_id>/<script_name>`. Compare the live bundle hash,
bindings, secrets and workers.dev setting with the plan before applying.
`prevent_destroy` is set on the Worker and every persistent resource so a
mismatch cannot silently become delete/recreate. If a custom route/domain or
rate rule already exists, import it with the IDs below instead of letting the
plan duplicate it:

```sh
# Route:      <zone_id>/<route_id>
# Domain:     <account_id>/<domain_id>
# Ruleset:    zones/<zone_id>/<ruleset_id>
```

## Secrets (outside state)

Worker secret values never enter Git or OpenTofu state. The script resource sets
`keep_bindings = ["secret_text"]`, so an upload preserves existing secrets
instead of deleting them. After an approved apply, set or rotate them against
the edge Worker and verify the names exist:

```sh
wrangler secret put TURN_KEY_ID --config deploy/edge/wrangler.toml
wrangler secret put TURN_KEY_API_TOKEN --config deploy/edge/wrangler.toml
wrangler secret list --config deploy/edge/wrangler.toml
```

Create/rotate the Cloudflare Realtime TURN key in the Realtime dashboard or API;
revoke credentials at Cloudflare if issuance is abused. See
`deploy/cloudflare.md` for the full emergency procedure.

## Explicit gaps and human decisions

- **Worker secret values:** this root does not use `secret_text` bindings or
  `cloudflare_workers_secret`. The current provider documentation says the
  old secret resource is being removed and recommends the Workers Secrets API
  or Secrets Store. Passing secret values to a script binding would put them in
  OpenTofu state. `keep_bindings = ["secret_text"]` preserves existing Worker
  secrets when the script is uploaded, but does not create or rotate them.
  Only `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` are Worker secrets, set with
  `wrangler secret put`. `CLOUDFLARE_API_TOKEN` is a local operator credential
  and `CLOUDFLARE_ACCOUNT_ID` is a tfvars value; neither belongs in the Worker.
- **Cloudflare Realtime TURN key:** provider v5.24.0 exposes
  `cloudflare_calls_turn_app`, which can create a TURN key but does not support
  import and returns its bearer key as sensitive state. That is not a safe
  migration path for an existing key or for attaching the value to Worker
  Secrets. This root intentionally does not create a TURN key. The coordinator
  must decide whether to create/rotate the key in the Realtime dashboard/API
  or explicitly accept that provider resource's state and lifecycle behavior.
- **Custom domains:** provider v5.24.0 supports
  `cloudflare_workers_custom_domain`, and this root models it as the
  alternative to a zone route. The hostname, zone, DNS/certificate ownership,
  and exact Rules language expression remain human choices. A workers.dev
  hostname cannot host the required zone-level rate rule.
- **GitHub Pages:** the repository's static origins are deployed by GitHub's
  `actions/deploy-pages`. The Cloudflare provider's Pages resource manages
  Cloudflare Pages projects, not GitHub Pages sites, so Pages deployment and
  custom-domain ownership remain outside this root.
- **Account workers.dev subdomain:** the account-level subdomain is already
  verified in the Cloudflare inventory, but the provider resources here do not
  own that account setting. The value is an optional output-only input; the
  per-Worker subdomain resources only enable each script under it.
- **State backend:** the R2 bucket is chosen but must be created and initialized
  interactively; locking is `use_lockfile = true`. CI does not read or write
  state and never plans/applies.

Open decisions before the first apply: whether to use a custom domain (stable
origin) or stay on workers.dev; the DNS/zone details if a custom domain is
chosen; whether the WAF plan supports an `ip.src` zone rate rule (off by
default); and the Cloudflare Realtime TURN key ID/token, which are created in
the dashboard/API and set as Worker secrets outside state.

## Provider references

The schemas were checked against the pinned Cloudflare provider v5.24.0:

- [Workers script](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/workers_script)
- [Workers script subdomain](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/workers_script_subdomain)
- [Workers route](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/workers_route)
- [Workers custom domain](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/workers_custom_domain)
- [Ruleset](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/ruleset)
- [Cloudflare Workers IaC and bundling guidance](https://developers.cloudflare.com/workers/platform/infrastructure-as-code/)
