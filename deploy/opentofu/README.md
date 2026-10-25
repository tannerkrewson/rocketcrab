# OpenTofu Cloudflare root

This is the repository-managed OpenTofu root for the supported Cloudflare
infrastructure. It is intended to replace the old Wrangler deployment workflow
as the infrastructure source of truth. No command in this directory applies,
imports, deletes, or deploys anything automatically.

## Managed resources

- `cloudflare_workers_script.relay` manages the single deployed edge Worker
  (`rocketcrab-cors-relay`: Classic CORS relay + `/turn` TURN mint), its
  non-secret variables, and the `TURN_BUDGET` KV binding. The bundle entry point
  is `deploy/edge/worker.ts`, which imports the relay and TURN handler modules.
- `cloudflare_workers_kv_namespace.turn_budget` creates the `TURN_BUDGET`
  namespace holding the daily mint counter.
- `cloudflare_workers_script_subdomain.relay` enables the Worker's workers.dev
  hostname. The account-level workers.dev subdomain is a human prerequisite.
- `cloudflare_workers_route.turn` and
  `cloudflare_workers_custom_domain.turn` are mutually exclusive optional
  endpoint choices for the same edge Worker. `cloudflare_ruleset.turn_rate_limit`
  is optional and uses the provider-supported `http_ratelimit` phase, `ip.src`
  characteristic, 60-second period, and the configured `RATE_LIMIT_PER_MIN`
  default.
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

## Safe validation and planning

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
`worker.js`. OpenTofu supplies the real `TURN_BUDGET` binding after the
namespace exists. Do not commit any generated bundle.

Then validate and plan without applying:

```sh
tofu -chdir=deploy/opentofu validate
tofu -chdir=deploy/opentofu plan -refresh=false
```

`CLOUDFLARE_API_TOKEN` is read from the environment by the provider. Supply
the required account ID with an ignored tfvars file or `-var`; never put an
API token, Worker secret, state file, `.terraform` directory, or bundle in git.
`-refresh=false` is useful for a local shape/content review, but a real review
of imported state should use the normal refresh-enabled plan after import.

The repository workflow `.github/workflows/infrastructure-plan.yml` builds
both bundles with Wrangler `--dry-run`, then runs non-mutating `fmt`, provider
initialization with `-backend=false`, `validate`, and a `-refresh=false` plan
with a dummy account ID. It never runs `tofu apply` or a Wrangler deployment.
A plan with real credentials remains an explicit operator command until the
state and secret decisions below are resolved.

## State and import strategy

There is deliberately no backend block yet. The coordinator must answer which
encrypted remote backend, locking mechanism, retention policy, and CI identity
are approved before a shared state file is used. Local state is for an
operator's private migration rehearsal only; `*.tfstate*` is ignored and no
state is committed.

The relay is already live but has never been represented by OpenTofu. Do not
apply this root until the relay has been imported and its plan reviewed:

```sh
tofu -chdir=deploy/opentofu import \
  cloudflare_workers_script.relay \
  "<CLOUDFLARE_ACCOUNT_ID>/rocketcrab-cors-relay"
tofu -chdir=deploy/opentofu import \
  cloudflare_workers_script_subdomain.relay \
  "<CLOUDFLARE_ACCOUNT_ID>/rocketcrab-cors-relay"
```

That command is documented for the future migration only and was not run for
this bead. Both provider import IDs are `<account_id>/<script_name>`. The
bundle hash, bindings, and workers.dev setting must be compared with the live
resources before any write. `prevent_destroy` is set on the relay and every
managed persistent resource so a mismatch cannot silently become a
delete/recreate operation.

The TURN route and KV namespace are not live according to the inventory in
`deploy/cloudflare.md`; they should not be imported. If a human creates them
before the migration, stop and record their IDs, then use the provider's
documented import formats instead of allowing duplicate resources:

```sh
tofu -chdir=deploy/opentofu import cloudflare_workers_kv_namespace.turn_budget \
  "<CLOUDFLARE_ACCOUNT_ID>/<NAMESPACE_ID>"
tofu -chdir=deploy/opentofu import 'cloudflare_workers_route.turn[0]' \
  "<CLOUDFLARE_ZONE_ID>/<ROUTE_ID>"
tofu -chdir=deploy/opentofu import 'cloudflare_workers_custom_domain.turn[0]' \
  "<CLOUDFLARE_ACCOUNT_ID>/<DOMAIN_ID>"
tofu -chdir=deploy/opentofu import 'cloudflare_ruleset.turn_rate_limit[0]' \
  "zones/<CLOUDFLARE_ZONE_ID>/<RULESET_ID>"
```

The route, custom domain, and ruleset addresses exist only when their matching
variables are configured. The provider documents the ruleset import prefix as
`zones/<zone_id>` or `accounts/<account_id>`.

## Explicit gaps and human decisions

- **Worker secret values:** this root does not use `secret_text` bindings or
  `cloudflare_workers_secret`. The current provider documentation says the
  old secret resource is being removed and recommends the Workers Secrets API
  or Secrets Store. Passing secret values to a script binding would put them in
  OpenTofu state. `keep_bindings = ["secret_text"]` preserves existing Worker
  secrets when the script is uploaded, but does not create or rotate them.
  `TURN_KEY_ID`, `TURN_KEY_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `CLOUDFLARE_API_TOKEN`, and `ALERT_WEBHOOK_URL` therefore remain
  human-managed Worker secrets until the coordinator chooses a safe Secrets
  Store/API handoff.
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
- **State backend:** no backend or shared locking choice is assumed. This must
  be settled before CI is allowed to read or write shared state.

Questions for the coordinator/review bead are: which remote backend and lock
policy should be used; should TURN use `turn_custom_route` or
`turn_custom_domain`; what exact hostname, zone, DNS/proxy arrangement, and
Rules language expression should protect TURN POST requests; and which
approved mechanism will create/rotate the TURN key and populate Worker
Secrets without storing its bearer token in OpenTofu state?

## Provider references

The schemas were checked against the pinned Cloudflare provider v5.24.0:

- [Workers script](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/workers_script)
- [Workers KV namespace](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/workers_kv_namespace)
- [Worker cron trigger](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/workers_cron_trigger)
- [Workers script subdomain](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/workers_script_subdomain)
- [Workers route](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/workers_route)
- [Workers custom domain](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/workers_custom_domain)
- [Ruleset](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/ruleset)
- [TURN app](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/calls_turn_app)
- [Cloudflare Workers IaC and bundling guidance](https://developers.cloudflare.com/workers/platform/infrastructure-as-code/)
