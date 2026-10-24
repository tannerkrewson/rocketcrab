# Nova remaining-work plan

## Authorized simplification program — active execution plan

Work directly on `nova`, without subagents. Complete the following stages in
order; commit verified sections, update evidence here, then reread the next
section before continuing. Stop for owner clarification when necessary. No
infrastructure deployment or creation of billable resources is authorized.
Historical backlog below remains release evidence, not a requirement to preserve
obsolete architecture. This program supersedes four-letter/admission/greeter UI
and old theme work; keep physical-device and deployment gates explicit.

### 1. Dependency baseline

- [x] Review Trystero 0.25.3 → latest stable (at least 0.26.0): Nostr,
      reconnection, ICE, resource handling, transfers, and changed action wire
      format. Give incompatible clients a clear update/reload outcome.
- [x] Update relevant stable dependencies without unrelated complex major
      migrations; declare actual imports, remove unused Zustand/dependencies,
      update lockfile. Preserve behavior and prepare for React 19/Tailwind 4.
- [x] Run tests, typecheck, production builds, bundle-size checks; record
      removals/additions, significant deferred upgrades, and remaining risks.

### 2. Private invites replace discovery and admission

**Owner decision:** transfer shell controls to one deterministically selected
remaining participant when the creator leaves, separately from game authority.
Classic external iframe provider host roles do not generically migrate. Continue
without questions unless an urgent blocker requires owner input.

- [x] Generate one cryptographically secure high-entropy party secret in the
      fragment. Use Trystero room discovery/password; automatic joining, native
      sharing, copy fallback, displayed QR (no scanner, accounts, or approval).
- [x] Remove codes, adverts/rendezvous, discovery timers/collisions, greeter and
      migration, manual admission, and obsolete UI/protocol/tests/docs.
- [x] Preserve joinability while any participant remains, verified late-join
      HTML/state, returning identity/state, and end-on-empty. Never expose secrets
      in paths, queries, logs, or game frames. Explain reusable-invite kick limits.
- [x] Verify lifecycle/security/integration cases and commit with evidence.

Stage 2 evidence: replaced ~1,465-line rendezvous module with one private-room
session; removed code generation/routes, adverts, admission, greeter, approval UI,
phonetic/short-link UI and their obsolete tests/schemas. Original creator context
and current membership determine the shell host; sender/session checks protect
control routing. Host/authority are separate; classic provider host roles do not
migrate. All invite holders can rejoin after cooperative removal (UI explains it).
Fixed received-source caching to retain full metadata/current selection so any
remaining verified holder serves late joiners. Tests cover creator departure,
source delivery and successor selection, identity recovery, stale invites, invalid
and spoofed controls, and cleanup. Updated ADRs/threat model/README/device gates.

Verification: 961 unit/property tests; typecheck, format, production builds and
bundle check pass; initial JS 168.9 KiB gzip (220 KiB budget unchanged). Real
Nostr/WebRTC suite 4/4 passes on one machine. App Playwright: 41 host tests passed;
19 WebKit launch failures were missing Fedora system libraries, not app failures;
WebKit rerun in the existing Playwright Podman image: 20/20 passed. No deployment
or physical-device proof. Native-share/copy/QR behavior is unit-tested; full
multi-hour cross-network/device acceptance remains gated.

### 3. Thin Trystero adapter and source transfer

- [x] Replace duplicated chunking/throttling/ACKs/request-response/progress/
      retries/recovery with Trystero built-ins where simpler; prefer maintained
      relay defaults unless evidence requires overrides.
- [x] Preserve 2 MiB limit, hash verification and verified-acceptance confirmation,
      validation/resource bounds, action IDs/dedup/revisions/authority ordering,
      and in-memory/real transport parity. No generic reliability layer.
- [x] Test large/rejected/corrupt/slow/disconnected/reconnecting transfers;
      document custom mechanisms retained and why; commit evidence.

Stage 3 evidence: replaced Nova's source framing (64 KiB chunk messages,
chunk indices, per-chunk ACKs, retry counts/backoff, cancel-message protocol,
recovery bookkeeping) with one Trystero binary request response per source.
`NovaTransport` gained `request`/`handleRequest`; the adapter maps them to
Trystero request actions (correlation, fragmentation, backpressure, progress,
timeout, receive admission, rejection, disconnect, abort) with 8 MiB shared
receive reservations, a 16 KiB request limit, and per-request 2 MiB response
admission. The in-memory counterpart reuses the hub's existing fault-injected
delivery/chunk/progress path and adds no production reliability layer; both run
the same contract scenarios.

Retained deliberately: 2 MiB hard limit and soft warning, exact UTF-8 byte count
and SHA-256 verification, bounded eight-document verified cache, runtime
compatibility checks, envelope/session/member validation, and one
`game.source.accepted` application decision — transport delivery is not
verified acceptance, and only validated HTML may open a start gate. Sender UI
now reports transfer start plus acceptance (Trystero exposes no
response-send progress callback). Cancellation aborts locally and suppresses
stale completions; no custom remote-cancel or negative-ACK loop was re-added.
Metadata/discovery remain small schema-validated shell controls; source traffic
never reaches game frames. `chunkCount`, the chunk/ack/cancel/request schemas and
their tests were deleted. `TRANSPORT_VERSION` bumped to 4 so pre-stage-3 clients
are rejected before acting.

Relays: pinned probe-era `GOOD_RELAYS`/redundancy defaults removed in favour of
Trystero 0.26 maintained defaults; explicit operator overrides remain. The F5
pin was stale (its own later re-probe recommended a different list) and the probe
spec now compares upstream defaults with the previously healthy four.

Verification: 977 unit/property tests; typecheck, format, lint (pre-existing
warnings only), production builds and bundle check pass; initial JS 167.8 KiB
gzip (220 KiB budget unchanged). In-memory suite covers 2 MiB byte-exact transfer,
progress, empty/BOM/multi-byte sources, wrong hash/size/length/encoding/type,
unavailable and oversized requests, dedup, slow cancellation, disconnect and
reconnect, cached re-acceptance, late-joiner service after creator departure,
cache cap, spoofed envelopes, cross-room isolation, and dispose. Real Chromium
Nostr/WebRTC suite 4/4 passes, including a verified 2 MiB source over public
relays with maintained defaults. App Playwright: Chromium+Firefox 40/40, WebKit
20/20 in the Playwright Podman image (one unrelated runtime-diagnostics test was
flaky once under 3 parallel workers; 3/3 isolated and 20/20 on full rerun).
Remaining risk: no physical-device, cross-network TURN or multi-hour proof;
maintained relay defaults were re-validated on this machine only. No deployment.

### 4. TURN reliability, security, and cost

- [ ] Recheck Cloudflare documented allocation/expiry behavior; choose lifecycle
      for multi-hour sessions and reconnects instead of unproven refresh machinery.
- [ ] Keep server secrets; review native issuance rate limiting, usage visibility,
      abuse response, budget notifications (not spending caps), and aggregate/raw
      traffic limits. Issuance limits do not bound already-issued traffic.
- [ ] Prefer direct ICE, retain appropriate TURN transports including TLS 443;
      simplify Worker/watchdog without a framework or room backend.
- [ ] Test failures, document operational risks/runbook changes; do not deploy.

### 5. Multiplayer resilience simplification

- [ ] Review party/state/simulation engines, membership, heartbeat/grace/reconnect
      timers, reload/Safari recovery, elections/migration, split-brain and errors.
- [ ] Consolidate redundant mechanisms without weakening serial authority, IDs,
      dedup, revision/snapshot validity, private views, catch-up, migration,
      ordered simulation inputs/restoration. Keep game-facing APIs unchanged.
- [ ] Review term/revision/hash voting conservatively: pause/recover rather than
      accept conflicting histories; no CRDT/state-machine framework.
- [ ] Strengthen authority-loss/partition/stale-action/reconnect/Safari/late-join
      tests; record simplifications and remaining protections; commit.

### 6. HeroUI v3 full replacement

- [ ] Follow current official HeroUI v3 docs (React 19+, Tailwind 4, React/styles
      packages, CSS setup, no legacy provider/plugin). Use standard components
      and light/dark styling, not recreation of bespoke Nova visuals.
- [ ] Migrate party/lobby/game shell, browser/details, editor/arena, navigation,
      dialogs/menus/popovers/forms/notifications/theme controls. Retain CodeMirror,
      runtime isolation, emergency leave, responsive/accessibility/Safari behavior.
- [ ] Remove daisyUI, obsolete theme/config/CSS/custom UI abstractions; no competing
      UI library. Simplify component composition and custom styling aggressively.
- [ ] Verify accessibility/mobile behavior, tests/build/bundle. Report material
      budget tradeoffs rather than silently raising limits; commit evidence.

### 7. Final focused cleanup

- [ ] Review use-party/use-arena/runtime-session subscriptions for
      useSyncExternalStore with stable subscriptions and immutable cached snapshots.
- [ ] Review Dexie useLiveQuery for local saved games/cross-tab consistency; retain
      TanStack Query only where useful. Remove stale dependencies/utilities/docs
      and infrastructure made obsolete by preceding stages, not another rewrite.
- [ ] Verify local library/editing, party lifecycle and arena; run final relevant
      tests/typecheck/build/bundle checks and summarize unresolved release gates.

### Execution evidence

- Initial state: clean working tree on `nova`; existing React 19 and Tailwind 4
  baseline already satisfies HeroUI prerequisites.
- Stage 1 complete: Trystero 0.26.0, React/DOM 19.3.1, Vite 8.3.5,
  TanStack/CodeMirror/Dexie/Zod and related stable packages updated; Vitest
  patched to 4.1.12 (5.x major deferred), daisyUI left for replacement in §6.
  Root concurrently/oxfmt security updates included; newer formatter required
  mechanical changes in nine existing files. Declared actual workspace, Zod,
  nanoid and CodeMirror view imports; removed unused Zustand and core's unused
  immer/nanoid. `npm audit`: zero vulnerabilities after updates.
- Stage 1 compatibility: pre-action handshake now requires transport version 2;
  missing/older/future peers are rejected with a local update/reload notice.
  Already-shipped old clients cannot retroactively show new wording. Added
  three incompatible-version tests; shared transport contracts still pass.
- Stage 1 verification: all 1,028 unit/property tests pass, typecheck and builds
  pass; real Nostr/WebRTC Chromium integration 4/4 passes (same machine only).
  Initial JS 173.6 KiB gzip versus previous ~175, below unchanged 220 KiB budget;
  editor 210.9 KiB gzip, runtime 60.0 KiB gzip. Lint passes with existing warnings.
  Updated router tests to assert the settled live 404 node rather than a detached
  transient node. Public pinned relays still emit policy errors: §3 owns defaults.
  `verify:deploy` requires explicit origin/base arguments; no deployment attempted.

This is the standalone work tracker for Nova. It preserves all 22 unfinished
records from the project tracker at migration: 13 actionable tasks/decisions and
9 project/phase tracking epics. The source database contained 224 records total;
202 were closed. Do not interpret an open phase epic as an unimplemented phase.

## Launch-readiness update (2026-10-24)

Completed without a deployment or physical device:

- Fixed the simulation-mode joiner defect and related mode/source transitions
  (§10), including hash-correct source replacement.
- Added TURN credential refresh with `setConfiguration()` (§6) based on
  Cloudflare's documented expiry behavior.
- Re-probed discovery relays with a stricter kind-spread/burst probe (§8–§9).
- Added a tested `VITE_TRYSTERO_RELAYS` build-time override and deploy input
  (default discovery path unchanged pending sign-off).
- Added Firefox and WebKit to the Playwright suite; 60/60 tests pass in
  Chromium, Firefox, and WebKit locally in the Playwright 1.62.1 container.
- Verified the **built static two-origin artifacts** on distinct local origins
  (no hosting): 16/16 static/runtime Playwright tests pass, covering SPA deep
  links, the CSP `frame-src` iframe bootstrap to the second origin, invite
  fragment secrecy, remote dependencies, isolation, and lifecycle cleanup.
  `verify:deploy` passes against the built output (`--pages` for the GitHub
  Pages fallback).
- Enabled TanStack Router automatic code splitting; the initial JS bundle is
  **175 kB gzipped** with the editor route lazy-loaded (648 kB raw/210 kB gzip).
  Documented a 220 kB gzip budget in `scripts/bundle-size.mjs` and the README.

Everything still requiring a human decision, a deployment, or physical devices
is collected under **Blocked on humans, infrastructure, or hardware** at the end.

The backlog was last updated in August 2026. Revalidate historical observations
against the current code, providers, networks, and deployed resources before
acting. Completed implementation is not a substitute for deployment or physical
device evidence. P0 = release blocker; P1 = high priority; P2 = normal priority;
P3 = optional improvement. No infrastructure deployment is authorized by this
plan.

## Recommended sequence

1. Resolve the infrastructure ownership/secret/hosting decisions below.
2. Fix or revalidate the simulation-mode joiner bug; decide credential refresh.
3. Re-probe discovery relays and obtain approval for any signaling change.
4. Provision secrets, import the existing relay, review a refreshed plan, and
   deploy TURN only through the approved operator/CI process.
5. Run live endpoint smoke checks, then cross-network and physical-device tests.
6. Complete documentation, performance measurements, and release sign-off.

## 1. Infrastructure ownership and provisioning decisions — P0, blocked on owner

Implementation and provider review are complete in `deploy/opentofu/`. Before
any import, apply, or provisioning, the owner must record these decisions:

- [ ] Choose an encrypted remote state backend, lock mechanism, retention/backup
      policy, and operator/CI identity. No shared backend is configured yet.
- [ ] Decide when to import the already-live `rocketcrab-cors-relay`. Import both
      its script and workers.dev hostname as documented in
      `deploy/opentofu/README.md`, and review a refresh-enabled plan before writes.
      Never attempt to create a duplicate or blindly apply over the live relay.
- [ ] Choose exactly one TURN endpoint: a proxied custom route with its rate-limit
      expression, or a Workers Custom Domain with hostname, zone, and expression.
      A workers.dev hostname cannot host a zone-level rate-limit rule.
- [ ] Decide whether CI stays validate/plan-only or may apply. The current
      `infrastructure-plan.yml` is non-mutating and uses a dummy account ID.
- [ ] Confirm ownership of the two static HTTPS origins. GitHub Pages is managed
      by `actions/deploy-pages`, not the Cloudflare provider. Choose the actual
      app/runtime domains or an alternative host; project sites on one GitHub
      account do not provide separate origins.
- [ ] Choose manual/API creation or rotation of the Cloudflare Realtime TURN key,
      or explicitly accept the provider's bearer-key-in-sensitive-state tradeoff.
      The pinned provider cannot import an existing TURN key.
- [ ] Approve human-managed Worker secrets: `TURN_KEY_ID`, `TURN_KEY_API_TOKEN`,
      `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and optional
      `ALERT_WEBHOOK_URL`. Keep values out of source, examples, and OpenTofu state.
      Existing `secret_text` bindings are preserved, not populated by OpenTofu.
- [ ] Update configuration and the runbooks to match the answers without an
      unreviewed apply.

Evidence: `deploy/opentofu/README.md`, `deploy/cloudflare.md`, and
`docs/architecture/deployment.md`. Infrastructure inventory was last live-verified
August 14, 2026; recheck it before planning mutations.

## 2. Cross-network TURN delivery and verification — P0, release blocker

Depends on section 1. The mint Worker and client wiring are implemented; actual
provisioning and device acceptance remain. Historical desktop Wi-Fi to iPhone
cellular tests repeatedly failed without TURN; same-Wi-Fi tests passed.

- [ ] Provision the approved managed TURN service and credential endpoint.
      Cloudflare Realtime TURN was selected under the free-options-first policy;
      verify current allowances and costs before proceeding. Do not silently
      introduce a paid service or replace Trystero.
- [ ] Verify short-lived join-time credentials, origin checks, per-IP limits,
      budget kill-switch, and monitoring. No reusable provider credentials may
      ship in public JavaScript. The endpoint executes no game code and stores
      no room-state database; budget counters are operational data.
- [ ] Re-run desktop Wi-Fi to iPhone cellular and two phones on different
      networks. Both must connect and survive more than one minute.
- [ ] Record discovery time, ping, a hash-verified 5 MiB game transfer over
      cellular, phone leave/rejoin, and observed TURN bandwidth/allowance usage.
- [ ] Record whether STUN alone suffices on tested networks versus full TURN;
      update ADR-0003 if new evidence changes the conclusion. Corporate/VPN
      connectivity remains an explicitly untested risk until measured.
- [ ] Record results in `docs/testing/trystero-connectivity-findings.md` and
      update the production provider/config recommendation.

### Recovered cross-device checklist

The original spike/checklist paths no longer exist. Use the maintained
`e2e-trystero/` harness and current app, with HTTPS on real LAN devices (WebCrypto
requires a secure context). Use the same app ID and room on each peer. Record
hardware, browser, network, date, discovery time, ping, transfer time, and outcome.

- [ ] Two separate desktops discover each other within approximately 30 seconds.
- [ ] Desktop and iPhone on the same Wi-Fi connect.
- [ ] Desktop Wi-Fi and iPhone cellular connect and survive over one minute.
- [ ] Two phones on different networks connect and transfer 5 MiB correctly.
- [ ] Four simultaneous mixed-device peers see and can ping one another.
- [ ] A phone can leave and rejoin; record recovery time.
- [ ] A 5 MiB transfer arrives with matching size/hash; record duration.
- [ ] Background iPhone Safari for 1–3 minutes; verify and record recovery.
- [ ] Airplane mode/failed signaling produces useful errors and recovers when
      connectivity returns. Record timeout, retry, and diagnostic behavior.

## 3. Approved deployment identity — P1, manual owner task

Depends on section 1; gates release validation.

- [ ] Document whether CI may apply or a controlled operator performs applies.
- [ ] Keep the current infrastructure validation workflow non-mutating.
- [ ] If CI apply is approved, configure least-privilege GitHub
      `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets and verify the
      approved deployment workflow succeeds. Do not grant apply credentials to
      the existing dummy-account plan workflow by default.
- [ ] Otherwise document controlled operator apply, identity, and token scopes.
      Worker secrets remain a separate human-managed concern.

## 4. TURN custom route and zone rate rule — P1

Depends on section 1. In-Worker rate limiting is implemented; zone-level
protection needs an approved custom route/domain, not workers.dev alone.

- [ ] Configure the selected hostname, zone/proxy arrangement, and exact POST
      rule expression through OpenTofu.
- [ ] Verify the zone rule protects the actual mint endpoint and agrees with the
      configured per-IP request limit. Record the live arrangement in the runbook.

## 5. Post-deployment TURN smoke checks — P1

Depends on approved provisioning/deployment in sections 1–4. This is verification
of that deployment, not authorization for another deployment path.

- [ ] Verify live `TURN_BUDGET` KV binding and the turn-creds Worker.
- [ ] Verify `/__watchdog` returns `ok: true`, confirming live GraphQL analytics
      schema and Account Analytics permissions.
- [ ] Mint once with an allowlisted Origin; verify usable `iceServers` and
      incrementing budget counters.
- [ ] Record results/fixes in `deploy/cloudflare.md` and
      `deploy/turn-creds/README.md`. Use OpenTofu, not a removed Wrangler deploy
      workflow or a placeholder KV ID.

## 6. Mid-party TURN credential lifetime — refresh implemented; device proof remains

Cloudflare documents that an expired credential stops billing immediately and
the allocation disconnects after a short delay; 48 hours is the maximum TTL.
Two options were invalidated by evidence: a longer TTL weakens abuse resistance,
and a session-level refresh cannot rescue an already-failed allocation. Trystero
exposes peer connections but has no renegotiation/ICE-restart hook.

- [x] Chose: re-mint at **8 minutes** (600 s TTL minus a 2-minute margin), apply
      to live peers via `RTCPeerConnection.setConfiguration()` while preserving
      non-TURN servers, refresh on foreground/reconnect against the wall clock,
      and never reuse a near-expiry credential for a new party. Single-flight,
      party-scoped, with tests for expiry, refresh, and injected factories.
- [ ] Run a **cross-network party longer than ten minutes** and record whether
      the refresh holds the connection; if it fails, add an ICE-restart path in
      the adapter or document the limitation and shorten the expected session.
- [ ] Re-test after an iPhone background/foreground cycle spanning the expiry.

## 7. Independent billing notification — P2, manual dashboard task

Depends on approval for account configuration in section 1. This tripwire is
independent of the implemented watchdog.

- [ ] Configure Cloudflare Notifications → Billing → Usage Based Billing for
      Realtime TURN (and SFU if used). The historical suggestion was about
      100 GB, well below the then-documented 1,000 GB allowance; verify current
      pricing/allowance and select an appropriate threshold.
- [ ] Receive a test email and optional webhook alert.
- [ ] Document the actual threshold and delivery verification in
      `deploy/turn-creds/README.md`.

## 8. Discovery-relay remediation — evidence refreshed; owner sign-off pending

Changing the public discovery path still requires owner approval. The current
pinned list is unchanged.

- [x] Ran the real adapter end-to-end on one machine through public Nostr
      relays and WebRTC (`npm run test:e2e:trystero`): 4/4 passed, including a
      game-source transfer and relay diagnostics. Same-machine only.
- [x] Re-probed on 2026-10-24 from the developer network with a stricter probe
      (`scripts/probes/probe-trystero-kinds.mjs`): nine kinds across Trystero's
      derived 20000–29999 range plus 12-event bursts, two runs.
- [x] Fresh result: `nos.lol`, `relay.primal.net`, `nostr.mom`,
      `relay.snort.social`, and `relay.nostr.net` accepted 9/9 kinds and 12/12
      bursts in both runs. `relay.damus.io` was unreachable then quota-limited;
      `offchain.pub` and `nostr.bitcoiner.social` accepted a first burst then
      hit web-of-trust rejection; `relay.nostr.info` rejected every event.
- [x] Implemented and tested the optional `VITE_TRYSTERO_RELAYS` build-time
      override (validated, deduplicated, invalid entries ignored) plus a deploy
      workflow input. Defaults are unchanged, so this does not alter signaling
      without an explicit deploy value.
- [ ] **Owner decision:** approve replacing the pinned seven with the five
      verified relays, or keep the current list. With pinned URLs all are used,
      so nominal redundancy is inert; the five-relay set trades absolute count
      for relays that actually carry traffic. A fresh probe from the owner's
      network would strengthen the decision.
- [ ] If approved, apply the list (or set the deploy input), re-run the browser
      discovery probe, and confirm the old per-relay console failures stop.
- [ ] Consider a private relay later; public arbitrary-kind relays are scarce
      and can change policy without notice.

## 9. Relay-quality observations reconciled

- [x] Re-read the conflicting observations: the August proof-of-work notices
      were relay-wide policy hints, not a per-event rejection for these kinds;
      the stricter October probe confirms `nos.lol` and `nostr.mom` accept both
      the sampled kinds and sustained 12-event bursts. `nostr.info` rejected
      every sampled kind in both October runs, matching the August finding.
- [x] Verified sustained bursts rather than socket reachability: accept-then-
      throttle relays (damus, offchain, bitcoiner.social) are distinguishable
      from healthy relays only under burst load, which the new probe measures.
- [ ] After any approved relay change, record post-change console behavior and
      usable-versus-connected counts in the findings doc. Same-machine discovery
      success still does not prove cross-network reliability.

## 10. Simulation-mode joiner session bug — P2, unresolved code defect

Historical report: the party engine constructs the joiner's session in
`establish()` before game metadata arrives, defaulting to `state`. Host setup was
fixed, but a simulation-game joiner could still get an inert `nova.simulation.*`
surface and an inappropriate `createInitialState` request.

- [x] Revalidated and fixed in `apps/nova/src/lib/party/engine.ts`: replace the
      immutable-mode session before a joiner's game boots and on host selection.
      Session/executor listeners are disposed without leaving the party transport.
- [x] Added deterministic two-peer party integration coverage for simulation
      registration/start/input delivery, state → simulation, raw messages,
      returning to cached state games, edited source under the same ID, and
      rejecting a joiner's attempt to select the host's game. Repeated identical
      metadata does not discard readiness. These are in-memory integration tests,
      not physical-device or deployed WebRTC evidence.
- [x] Fixed a related source cache defect: match verified content hashes rather
      than treating every version of a game ID as identical.

## 11–12. Superseded party-admission/greeter decisions

Closed by the private-invite program: no public adverts, approval, codes, or
greeter role. Shell controls use a deterministic successor independently of game
authority (owner approved). Original creator identity is context, not a public
advertisement or external game-provider host migration.

## 13. Release validation and documentation — P0, gated by TURN and deployment

Some documentation and tests already exist. Audit and fill gaps instead of
rewriting completed work blindly.

- [ ] Choose and deploy the two distinct HTTPS origins; verify actual hosting
      support for security headers, SPA deep links, caching, and fragment-only
      invite secrets. A Pages workflow alone is not proof that `_headers` are
      enforced by the selected host. Publish only with owner approval.
- [x] From a clean install: format, lint, typecheck, all unit/property tests
      (1,025 total), and production builds pass. Full Playwright suite passes in
      **Chromium, Firefox, and WebKit** (60/60) in the Playwright 1.62.1
      container. Firefox and WebKit are now in CI config (not yet observed on a
      GitHub runner).
- [x] Documented a gzip-based initial-bundle budget (220 kB; measured 175 kB)
      and route-level lazy loading of the editor.
- [x] Validated the built artifacts locally on two distinct origins (see the
      launch-readiness update and `docs/architecture/deployment.md`); this is
      not evidence about the eventual host's headers or CDN behavior.
- [ ] Run and record physical tests with at least two iPhones and a desktop:
      same-Wi-Fi and Wi-Fi/cellular parties, private-link and QR joins, source
      transfer, state-mode play, authority migration, reconnect, simulation/raw
      samples, remote dependencies, audio, and camera/microphone to the extent
      supported. WebKit automation does not replace these tests.
- [ ] Complete `docs/testing/mobile-safari-checklist.md` and the state-mode
      vertical-slice device checklist; record limitations and failures honestly.
- [ ] Verify the full create → prompt → paste → multi-player test → save → party
      → play flow on Mobile Safari. Test the master prompt with at least two
      major AI chat services, producing one pasteable HTML document.
- [ ] Verify state, simulation, and raw sample games, automatic authority
      migration, byte-identical peer-to-peer source transfer, and backendless
      private invites. Confirm no obsolete application backend remains in Nova.
- [x] Added `docs/game-author-debugging.md` (authoring loop, diagnostics,
      common failures, party debugging) and indexed it from the README.
- [ ] Audit README, API reference, game-author/debugging/mobile/deployment guides,
      architecture diagrams, prompt docs, security limitations, browser support,
      contributing guidance, and non-goals. Keep media claims experimental where
      evidence requires it; don't promise per-game isolation on a shared origin.
- [x] Documented the bundle budgets and measurements above. Historical baseline:
      runtime bootstrap 30.7 kB gzip; arena discovery ~2 s on loopback; state
      latency, 5 MiB transfer, and memory-after-restart numbers still need a
      real-network capture (below).
- [ ] Measure time to interactive, arena creation, room discovery, HTML
      transfer, state-action latency, and memory after repeated restarts on a
      real phone and real network. Investigate large regressions rather than
      inventing perfect-number gates.
- [ ] Record release evidence, resolve remaining blockers, and mark Nova ready
      for review. The owner-authorized tracker purge supersedes the old backlog's
      instruction to preserve every historical commit unchanged.

## Open tracking epics — 9 records, not nine additional implementations

Close these only after verifying their original outcomes and outstanding work:

- [ ] **Nova overall:** initial static/local-only scope, end-to-end creator/player
      flow, all six phases verified, and ready for review. Use npm workspaces,
      not the superseded pnpm scaffold instructions.
- [ ] **Phase 1 — Foundation and risk spikes:** implementation children closed;
      confirm CI, ADRs, threat model, schema package, and documented sandbox and
      connectivity spike outcomes. Historical risk gates feed release testing.
- [ ] **Phase 2 — Local creation/testing:** implementation children closed;
      verify phone paste/run, at least six desktop simulated players, IndexedDB
      reload persistence, and launching a tested game into a party.
- [ ] **Phase 3 — Party system:** implementation children closed; verify two
      phones create/join/transfer/play, invite secrets never enter requests or frames,
      byte-identical HTML/hash verification, and listener/connection cleanup.
- [ ] **Phase 4 — Multiplayer API:** implementation children closed; verify a
      small game registers simply and behaves across both transports, trivia/card
      games need no networking code, authority migration is transparent, the
      physical-phone state slice works, and election property tests run in CI.
- [ ] **Phase 5 — Advanced modes/prompt:** implementation children closed;
      verify real-party simulation (section 10), raw structured/binary data,
      prompts with two AI services, and accurate/experimental media claims.
- [ ] **Phase 6 — Mobile/release:** hardening/deploy configuration/TURN decision
      children closed; final deployment and release evidence remain in sections
      1–7 and 13, especially suspension recovery and actual security headers.
- [ ] **OpenTofu migration:** configuration and review complete; finish the
      owner decisions and approved adoption/import/ownership handoff in section 1.
- [ ] **Product polish/infrastructure coordination:** UI children and OpenTofu
      implementation/review were merged; remaining gates are owner decisions,
      TURN provisioning, and release evidence—not another UI rewrite.

## Unmerged branch review

No surviving unmerged Nova feature branch was found in the fetched branch set.
Merged feature/work branches can be retired. Preserve these unrelated lines of
work unless the owner separately decides to remove or port them:

- `security/node22-brotli` and remote `prod`: four later production/deployment
  security commits. Relevant to maintaining the legacy live service, not a direct
  Nova feature merge; review any applicable operational lessons at deployment.
- `deps`, four `backup/deps-*` branches, `vitest-browser`, and `vitest-browser-2`:
  older pre-Nova dependency/UI/router and browser-test experiments. Not missing
  Nova implementation; optional reference only, not merge-ready Nova work.
- Remote `allbadcards`, `liesgame`, and two old Dependabot branches: historical
  game integrations/dependency changes, not unfinished Nova work.

## Blocked on humans, infrastructure, or hardware (2026-10-24)

Cannot be completed from this workstation without one of: an owner decision, a
real deployment/credentials, or physical devices on real networks.

**Owner decisions**

- Approve (or reject) the five-relay discovery set in §8.
- Choose the remote OpenTofu state backend, locking, and retention; import
  policy for the live relay; TURN route versus custom domain and its rate rule;
  CI apply versus operator apply; TURN key creation/rotation and Worker secrets.
- Choose the two production origins/host. GitHub Pages cannot send custom HTTP
  security headers (documented limitation); a header-capable host is preferable
  if strict headers are a launch requirement.

**Deployment / live verification**

- Provision TURN key, KV namespace, Worker, secrets, budget caps, billing alert,
  and zone rate limit; verify live `/__watchdog`, mint, counters, and headers.
- Deploy the two static origins and confirm SPA routing, caching, CSP/frame
  behavior, invite-fragment secrecy, and CDN behavior on the real host.

**Physical devices / real networks**

- Cross-network parties (Wi-Fi ↔ cellular; two phones on different networks),
  four mixed devices, private-link and QR joins, a real 5 MiB transfer, and a party
  longer than ten minutes across the TURN credential refresh.
- iPhone backgrounding, low-power mode, airplane-mode recovery, audio gesture,
  camera/mic permission, safe areas, and the full Mobile Safari checklist.
- A real friend beta without coaching, to catch product and error-message gaps.

## Source-of-truth documents

- `README.md` — application overview and documentation index.
- `deploy/cloudflare.md` — live versus planned infrastructure inventory.
- `deploy/opentofu/README.md` — safe plan/import process and provider gaps.
- `deploy/turn-creds/README.md` — TURN operation and verification.
- `docs/architecture/deployment.md` and ADR-0003 — origins/connectivity decisions.
- `docs/testing/trystero-connectivity-findings.md` — relay and device evidence.
- `docs/testing/mobile-safari-checklist.md` and
  `docs/testing/state-mode-vertical-slice.md` — release device checklists.
