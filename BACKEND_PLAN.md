# Nova backend simplification — execution plan

Owner direction: one tiny stateless edge Worker, no application database, one
reproducible OpenTofu configuration, static frontend on GitHub Pages, Trystero
for multiplayer, and Cloudflare's managed TURN for hard networks. Secrets and
billing settings stay outside infrastructure state. No deployment, resource
deletion, or paid-resource creation is authorized in this program.

This plan supersedes the backend/infrastructure portions of `PLAN.md` where they
overlap (relay/TURN worker deployment, KV, OpenTofu state, operational docs).
The seven-stage product simplification in `PLAN.md` remains historical evidence.

## Stage 1 — One edge Worker, smaller state surface

**Decision on Classic + CORS relay.** Classic is not backend: it is 22 prebuilt
external iframe games, a visible “Browse games” entry, party room sharing, and
16 of the 22 need the scoped CORS relay to create rooms. Removing it would be a
product deletion, not an infrastructure cleanup, and would still leave the AI
game workflow intact only by dropping shipped content. Instead, this stage
consolidates the relay and TURN mint into **one deployed Worker** (one script,
one subdomain, one bundle, one OpenTofu resource), preserving Classic and
turning two stateless backends into one. The owner can still remove Classic
later; that decision is recorded as deferred, not silently applied.

- [x] Add a single Worker entry point dispatching `/turn` to the TURN mint and
      every other path to the existing scoped relay; keep the live relay's root
      protocol unchanged so the Classic client needs no migration.
- [x] Move the TURN client to the edge origin’s `/turn` path; keep the relay
      client at the edge origin root.
- [x] Simplify the TURN KV budget to one daily issuance counter (drop the
      cumulative counter and its manual re-arm); retain the daily cap as the
      documented “longer-term restriction” exception to zero KV, because it is
      the only account-wide issuance stop the per-IP limiter cannot replace.
      **Superseded by the pre-deployment hardening below:** the KV cap could not
      be enforced reliably and was removed.
- [x] Update OpenTofu to one Worker script/subdomain, one KV namespace (daily
      cap), one optional route/domain/rate-rule target, one bundle path.
      **Superseded:** the KV namespace was removed in hardening.
- [x] Merge/redirect operator docs into one edge-worker runbook; update
      `deploy/cloudflare.md`, CI bundle steps, env examples and tests.
- [x] Verify worker/relay/TURN/client tests, typecheck, build, and the
      infrastructure plan validation.

Evidence: `deploy/edge/worker.ts` is the single deployed entry point
(`/turn` → TURN mint, everything else → the unchanged relay root protocol).
`deploy/edge/wrangler.toml` holds the local/dry-run config; the historical
script name `rocketcrab-cors-relay` is kept so the live resource is not
replaced. TURN budget was initially reduced to one KV key (`mints:YYYY-MM-DD`) and one
`MINT_DAILY_CAP`; that design was later removed (see hardening) because KV
cannot enforce a cap atomically. OpenTofu models one script/subdomain with a
platform rate-limit binding and optional route/domain/rate rule; the second
script and its subdomain are removed.
The TURN client posts to `${origin}/turn`; the relay client is unchanged.
Manuals: `deploy/edge/README.md` is the operator entry point; Cloudflare
runbook and OpenTofu README updated. CI builds only the edge bundle.

Verification: 91 infrastructure worker tests (edge 5, relay 37, TURN 49),
typecheck and OpenTofu `fmt -check` + `init -backend=false` + `validate` pass.
Found and fixed a real reproducibility bug: a relative Wrangler `--outdir`
under the ignored `.build` directory wrote only `README.md` and no `worker.js`;
CI/docs now use an absolute `$PWD/...` path. No deployment or resource change.

**Decision recorded:** Classic compatibility is retained. Removing it would
delete 22 curated games, the Browse entry and party room sharing — a product
change, not a backend cleanup — and would not remove the need for the AI-game
workflow. One Worker is achieved instead; the owner may still retire Classic
later.

## Stage 2 — Reproducible OpenTofu state and ownership

- [x] Add R2 S3-compatible backend configuration as a documented partial
      configuration (`-backend-config`) so the repo can use private remote state
      without committing credentials or requiring a bucket at validate time.
- [x] Document bucket bootstrap, state locking (`use_lockfile`), encryption,
      backup/restore, and recovery.
- [x] Audit existing resources: relay may be live; TURN/KV never deployed.
      Document import-before-apply and “do not replace live resources”.
- [x] Keep Worker secrets out of state; document TURN key bootstrap, secret
      set/verify/rotate/revoke as a short reproducible command sequence.
- [x] Add ignore rules for local state/plan/backups and verify no state or
      credentials are tracked.

Do not create the R2 bucket or apply anything.

Evidence: `deploy/opentofu/backend.tf` is a partial S3-compatible backend with
`use_path_style`, `use_lockfile`, R2 skip checks, key `nova/terraform.tfstate`;
bucket/endpoint come from ignored `backend.hcl` (example committed). R2 token
credentials use `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`; Cloudflare API token
stays `CLOUDFLARE_API_TOKEN`. The OpenTofu README now covers one-time bucket and
scoped-token bootstrap, `init -backend-config`, state pull backups and reviewed
`state push` recovery, import-before-apply for the live relay, and secret
set/list/rotate commands. `.gitignore` covers `backend.hcl`, state/backups,
tfvars, `.terraform/`, and bundles. `tofu fmt -check`, `init -backend=false`,
and `validate` pass locally with OpenTofu 1.13.2.

Not verified live: R2 backend init/locking needs the private bucket and token,
which were not created. `use_lockfile` with R2 is documented by OpenTofu but must
be confirmed on first bootstrap. No resource was created or imported.

## Stage 3 — One deployment path

- [x] Make it explicit that OpenTofu is the only production deployment of the
      Worker and its non-secret bindings; Wrangler only builds/validates/secrets.
- [x] Keep CI validation + plan; manual approved `tofu apply`; no competing
      deploy workflow.
- [x] Document the coordinated frontend/Worker release order for the new
      `/turn` path (Worker first, then frontend env/build).
- [x] Document rollback/secret rotation and emergency disable.

Evidence: `docs/architecture/deployment.md` now separates the two publishers
(GitHub Actions for static origins, OpenTofu for Cloudflare) and gives the
manual path: dry-run bundle → `init -backend-config` → reviewed plan → owner
approval/`tofu apply` → `wrangler secret put` → frontend rebuild. It documents
the `/turn` release order (Worker first, then the static app with the edge
origin), rollback for both layers, and points emergency TURN controls at
`deploy/edge/README.md` / `deploy/cloudflare.md`. CI remains format/validate-only (planning needs remote state); no automation
plans, applies, or deploys a Worker.

## Stage 4 — TURN security, attribution, costs, diagnostics

- [x] Verify whether Cloudflare’s mint API supports a per-request custom
      identifier; if it does, label credentials without adding client-controlled
      secrets, and document per-player attribution.
- [x] Confirm current lifecycle: each page/player mints one 24 h credential; do
      not re-mint or share credentials between participants.
- [x] Document native Realtime TURN analytics, budget alerts (notifications, not
      caps), emergency disable/revoke/rotate, and what issuance limits do/do not
      bound.
- [x] Confirm diagnostic categories cover signaling, peer connection, TURN mint,
      disconnects, reconnect failures and party end.
- [x] Investigate the reported heavy arena e2e flake; fix real races only.
- [ ] Add a gated real forced-TURN test harness if credentials are available;
      no fake proof.

Evidence: docs confirm each participant page mints one credential at join and
shares it only within that page; the party-wide sharing description was wrong.
Cloudflare documents `customIdentifier` for the sibling `credentials/generate`
endpoint but not for `generate-ice-servers`, so the worker does not send an
unverified field; attribution is per credential (`username`) plus the
`turn_cred_mint` log. `deploy/turn-creds/README.md` and `deploy/cloudflare.md`
now document TURN analytics dimensions/queries, budget alerts as notifications
(not caps), what issuance caps do and do not bound, and the emergency
disable/revoke/rotate procedure. Diagnostics already distinguish signaling,
peer-connection, TURN-mint, disconnect, reconnect and party-end states.

Arena flake: the four-player S4 spec failed once while Chromium and Firefox ran
together under load; it passed `--repeat-each=3` isolated (4.4 s) and in prior
full runs. No synchronization race was found; this is resource contention in
the test environment, not a product failure. Forced-TURN proof remains pending
because no TURN key/credentials or deployment are authorized; no fake test was
added.

## Stage 5 — Focused cleanup (only if time/context allows)

- [x] Merge `schedule`/`scheduleFn` injection.
- [x] Use HeroUI’s `buttonVariants` instead of the hand-written BEM map.
- [x] Remove obsolete probe scripts and archive historical docs; keep `PLAN.md`
      focused and linked.
- [x] Consolidate obvious test duplication; remove dead deps/docs.
- [x] Do not split PartyEngine, add a GamePlane abstraction, rewrite authority,
      or rebuild the arena.

Evidence: the party engine now has one scheduler field (`config.schedule ??
defaultScheduler`) instead of a dead duplicate `scheduleFn`. `buttonStyles` calls
HeroUI’s `buttonVariants`, deleting the hand-maintained size/variant BEM map.
Removed the obsolete `scripts/probes/` directory (its results stay in the
testing findings), removed the unused direct `tailwind-variants` dependency
(HeroUI still brings it transitively), and moved the old execution evidence to
`docs/history/nova-simplification-evidence.md` (linked from `PLAN.md` and the
README docs index). `PLAN.md` now marks the backlog as historical and points to
this backend plan. Test-harness duplication was reviewed but not merged across
packages: the fake clocks/world builders differ between the party, protocol and
Nova app suites, and forcing a shared helper would couple test packages for
little deletion; no production code changed for that item. No PartyEngine split,
GamePlane abstraction, authority rewrite or arena rebuild was attempted.

## Stage 6 — Beta gates (no deployment here)

- [x] Record the private-beta checklist and required approvals: deploy Worker,
      then frontend; test real TURN/TLS 443, signaling failure, Mobile Safari,
      authority migration, late join/source transfer, network switch; measure
      join success, direct-vs-relay, recovery and TURN cost.
- [x] Leave all deployment / billable-resource actions pending owner approval.

Private-beta gates (all require explicit owner approval; none run here):

1. Provision/import infrastructure: R2 state bucket + scoped token, import the
   live relay, review plan, approve `tofu apply` (adds `/turn`, rate-limit
   binding, secrets), set TURN key secrets, optionally configure a custom
   route/domain/rate rule.
2. Deploy the static origins with the edge origin in `VITE_TURN_CREDS_ORIGIN`
   and `VITE_CLASSIC_RELAY_ORIGIN` after the Worker is verified.
3. Verify forced TURN over `turns:` TLS 443 (direct paths blocked), signaling
   relay failure/recovery, Mobile Safari background/resume, authority loss and
   migration, late join/source transfer, and network switching.
4. Measure join success, invite-to-connected time, direct-vs-relayed selection,
   recovery success, TURN bytes/cost, and issuance failures; review with the
   owner before any broader release.

No deployment, import, bucket, key, or paid resource was created.

## Pre-deployment hardening (before first apply)

- [x] Audit the daily TURN counter. KV has no atomic increment and allows one
      write/second/key; concurrent joins both read below the cap, mint, and
      overwrite each other's increment (last write wins), so the cap can be
      bypassed under load and writes can fail silently. Removed the counter,
      KV namespace, binding, `MINT_DAILY_CAP`, and all KV tests/docs instead of
      adding a Durable Object.
- [x] Replace the per-isolate in-memory rate limiter as the primary control with
      the Cloudflare Workers Rate Limiting binding (`RATE_LIMITER`, per route +
      IP); keep in-memory only as a local-dev/test fallback. The optional zone
      rule is off by default because Cloudflare Free lacks `ip.src`.
- [x] Keep one Worker, but restrict the relay to `POST /` and return `404` for
      every other path, so new TURN/API paths cannot inherit relay behavior.
- [x] Add `keep_bindings = ["secret_text"]` to the Worker resource so an
      OpenTofu upload cannot delete the TURN secrets.
- [x] Map transport join categories to clear player messages and make the
      no-direct-connection notice depend on actual TURN state. Trim trailing
      slashes from the mint origin.
- [x] Add Playwright assertion/navigation timeouts for the cold-Vite parallel
      flake; no product race was found.
- [x] Re-audit dependencies on this branch (`npm audit`: zero).
- [x] Clean obsolete KV/OpenTofu docs and config; align OpenTofu with OpenTofu
      1.13.2, the platform rate-limit binding, and import IDs.
- [x] Verify infrastructure tests, typecheck, build, bundle, OpenTofu
      fmt/validate, a local no-refresh plan with a dummy account, and browser
      tests. No deployment, import, bucket, key, or paid resource is created.

## Final verification (this branch)

- 970 unit/property tests + 91 infrastructure Worker tests pass.
- Format, lint, typecheck, production build and bundle check pass; initial JS
  205.9 KiB gzip against the unchanged 220 KiB budget.
- `tofu fmt -check`, `init -backend=false`, and `validate` pass (OpenTofu
  1.13.2). The remote R2 backend and live applies were not exercised.
- Playwright: Chromium/Firefox 39/40 in one parallel run (one static reload spec
  flaked under load and passed isolated), WebKit 20/20. The earlier four-player
  arena flake also passed three isolated repeats.
- `npm audit`: 0 vulnerabilities.

Not done (require owner approval or live credentials): R2 bucket creation and
remote-state init, relay import/apply, TURN key creation and Worker secrets,
deployment of Worker or frontend, forced-TURN/TLS-443 proof, physical-device
Mobile Safari and multi-hour cross-network tests, private beta.
