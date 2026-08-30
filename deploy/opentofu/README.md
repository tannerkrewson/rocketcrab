# OpenTofu Cloudflare root

This is the repository-managed OpenTofu root for the supported Cloudflare
infrastructure. It is intended to replace the old Wrangler deployment workflow
as the infrastructure source of truth. No command in this directory applies,
imports, deletes, or deploys anything automatically.

## Managed resources

- `cloudflare_workers_script.relay` manages the deployed
  `rocketcrab-cors-relay` Worker and its two non-secret plain-text bindings.
- `cloudflare_workers_kv_namespace.turn_budget` creates the planned
  `TURN_BUDGET` namespace.
- `cloudflare_workers_script.turn` manages the planned
  `rocketcrab-turn-creds` Worker, all non-secret variables, and the
  `TURN_BUDGET` KV binding. Its `worker.ts` bundle includes the local
  `watchdog.ts` module.
- `cloudflare_workers_cron_trigger.turn_watchdog` manages the `0 9 * * *`
  UTC schedule for the Worker `scheduled` handler.
- `cloudflare_workers_route.turn` and
  `cloudflare_ruleset.turn_rate_limit` are optional. They are enabled only
  after a real zone ID and a coordinator-selected custom route object are
  supplied. The ruleset uses the provider-supported `http_ratelimit` phase,
  `ip.src` characteristic, 60-second period, and the configured 10/min default.

The Worker source of truth remains the existing TypeScript files:
`deploy/relay/worker.ts` and `deploy/turn-creds/worker.ts` plus
`deploy/turn-creds/watchdog.ts`. Cloudflare does not transpile TypeScript on
upload, so OpenTofu consumes the generated JavaScript bundles rather than
pretending that raw TypeScript is deployable.

## Safe validation and planning

From the repository root, use Wrangler only for a local compile dry run. The
`--dry-run` flag compiles and writes files without uploading or changing
Cloudflare. The commands pin the Wrangler release used for this migration.
These commands must run before `tofu plan` because the bundles are ignored
build output:

```sh
npx wrangler@4.127.1 deploy deploy/relay/worker.ts \
  --config deploy/relay/wrangler.toml \
  --dry-run --outdir deploy/opentofu/.build/relay
npx wrangler@4.127.1 deploy deploy/turn-creds/worker.ts \
  --config deploy/turn-creds/wrangler.toml \
  --dry-run --outdir deploy/opentofu/.build/turn-creds
```

The TURN dry run currently accepts the intentionally unresolved KV ID in the
legacy Wrangler config for bundling. OpenTofu supplies the real `TURN_BUDGET`
binding after the namespace exists. Do not commit any generated bundle.

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

The repository workflow `.github/workflows/infrastructure-plan.yml` runs the
non-mutating `fmt`, provider initialization with `-backend=false`, and
`validate` checks. It intentionally does not run `tofu apply` or a Wrangler
deployment. A plan with real credentials remains an explicit operator command
until the state and secret decisions below are resolved.

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
```

That command is documented for the future migration only and was not run for
this bead. The provider documents the import ID as `<account_id>/<script_name>`.
The bundle hash and bindings must be compared with the live script before any
write. `prevent_destroy` is set on the relay and every managed persistent
resource so a mismatch cannot silently become a delete/recreate operation.

The TURN Worker and KV namespace are not live according to the inventory in
`deploy/cloudflare.md`; they should not be imported. If a human creates them
before the migration, stop and record their IDs, then use the provider's
documented import formats for the namespace, route, ruleset, and cron trigger
instead of allowing duplicate resources.

## Explicit gaps and human decisions

- **Worker secret values:** this root does not use `secret_text` bindings or
  `cloudflare_workers_secret`. The current provider documentation says the
  old secret resource is being removed and recommends the Workers Secrets API
  or Secrets Store. Passing secret values to a script binding would put them in
  OpenTofu state. `TURN_KEY_ID`, `TURN_KEY_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN` therefore remain
  human-managed Worker secrets until the coordinator chooses a safe Secrets
  Store/API handoff.
- **Cloudflare Realtime TURN key:** provider v5.24.0 exposes
  `cloudflare_calls_turn_app`, which can create a TURN key but does not support
  import and returns its bearer key as sensitive state. That is not a safe
  migration path for an existing key or for attaching the value to Worker
  Secrets. This root intentionally does not create a TURN key. The coordinator
  must decide whether to create/rotate the key in the Realtime dashboard/API
  or explicitly accept that provider resource's state and lifecycle behavior.
- **Custom domains:** provider v5.24.0 documents Workers, routes, and the
  Worker domain references, but no `cloudflare_workers_domain` resource. A
  custom domain therefore remains a dashboard/API/Wrangler gap. The route
  resource here is only for a coordinator-selected proxied zone pattern; a
  workers.dev hostname cannot host the required zone-level rate rule.
- **GitHub Pages:** the repository's static origins are deployed by GitHub's
  `actions/deploy-pages`. The Cloudflare provider's Pages resource manages
  Cloudflare Pages projects, not GitHub Pages sites, so Pages deployment and
  custom-domain ownership remain outside this root.
- **Account workers.dev subdomain:** the account-level subdomain is already
  verified in the Cloudflare inventory, but the legacy script resource does
  not own that account setting. The value is an optional output-only input.
- **State backend:** no backend or shared locking choice is assumed. This must
  be settled before CI is allowed to read or write shared state.

Questions for the coordinator/review bead are: which remote backend and lock
policy should be used; should each Worker stay on workers.dev or use a custom
domain; what exact proxied route pattern and Rules language expression should
protect TURN POST requests; and which approved mechanism will create/rotate
the TURN key and populate Worker Secrets without storing its bearer token in
OpenTofu state?

## Provider references

The schemas were checked against the pinned Cloudflare provider v5.24.0:

- [Workers script](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/workers_script)
- [Workers KV namespace](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/workers_kv_namespace)
- [Worker cron trigger](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/workers_cron_trigger)
- [Workers route](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/workers_route)
- [Ruleset](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/ruleset)
- [TURN app](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs/resources/calls_turn_app)
- [Cloudflare Workers IaC and bundling guidance](https://developers.cloudflare.com/workers/platform/infrastructure-as-code/)
