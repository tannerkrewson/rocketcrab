# Nova remaining-work plan

This is the standalone work tracker for Nova. It preserves all 22 unfinished
records from the project tracker at migration: 13 actionable tasks/decisions and
9 project/phase tracking epics. The source database contained 224 records total;
202 were closed. Do not interpret an open phase epic as an unimplemented phase.

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

## 6. Mid-party TURN credential lifetime — P2, decision and possible code work

The client mints once at join with a 600-second TTL. Historical notes flag a risk
to long parties; verify actual provider/allocation behavior and transport APIs.

- [ ] Choose and document one policy: accept/document expiry, refresh around nine
      minutes/on disconnect, or increase TTL with an explicit abuse tradeoff.
- [ ] Prefer low-complexity refresh if feasible; verify what Trystero exposes
      rather than assuming access to `RTCPeerConnection.setConfiguration()`.
- [ ] If refresh is chosen, add tests and run a cross-network party for longer
      than ten minutes. Record the decision in the TURN runbook/ADR.

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

## 8. Discovery-relay remediation — P2, blocked on owner sign-off

The investigation is complete; changing the public discovery path requires
approval, not merely an implementation agent's choice.

- [ ] Re-probe candidates from the developer's and ideally the owner's networks.
      August 15 observations are not a current availability guarantee.
- [ ] Present the verified set and public-versus-private-relay tradeoffs for
      approval before changing the production discovery path.
- [ ] Historical recommendation: `nos.lol`, `relay.primal.net`, `nostr.mom`,
      `relay.snort.social`, and `relay.nostr.net`; remove `relay.damus.io`,
      `offchain.pub`, and `relay.nostr.info` if current tests confirm the finding.
- [ ] Keep nominal redundancy at five unless new evidence recommends otherwise.
      Verify behavior: pinned URLs historically all participated, so the default
      redundancy setting did not slice the pinned list.
- [ ] Consider an optional build-time `VITE_TRYSTERO_RELAYS` override in the
      transport factory, defaulting to the approved list; no runtime fetch needed.
- [ ] Apply only the approved remediation, add appropriate tests, and record
      probe evidence in `docs/testing/trystero-connectivity-findings.md`.
      Persistent old-relay failures should no longer flood the console.

## 9. Relay-quality observations to reconcile — P2

This is a separate unfinished investigation follow-up, dependent on section 8.
Do not discard its conflicting evidence when choosing a relay set.

- [ ] Reconcile the live-test observations: damus rate-limited; offchain rejected
      by policy; nostr.info rejected Trystero kinds 22919/22612; nos.lol and
      nostr.mom demanded 28-bit proof of work, despite appearing in a later
      recommended set.
- [ ] Verify actual Trystero event kinds and sustained bursts, not just socket
      connectivity. Same-machine success via host/mDNS candidates does not
      establish cross-network discovery reliability.
- [ ] Record sustained usability, redundancy, console behavior, and usable versus
      merely connected relay counts after the approved change.

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

## 11. Host name on join approval — P2, privacy decision

Current wording uses “the host.” Showing a name before admission would require
putting the greeter's display name in the public four-letter-code advertisement,
which anyone visiting/guessing the code could read (ADR-0004).

- [ ] Ask the owner whether publicizing the chosen name is acceptable, whether
      a reduced/first-name field is preferable, or whether to keep generic text.
- [ ] Implement “Waiting for <host name>'s approval” only with approval; update
      the public-advert threat/privacy documentation and tests if changed.

## 12. Distinguish creator from migrating greeter — P3, optional improvement

The lobby historically used `greeterMemberId` as the host-name signal. The
creator starts as greeter, but greeter migration after disconnect can make the
lobby label a different person as host.

- [ ] Revalidate the current state shape and displayed behavior.
- [ ] Add a creator member ID to `PartyEngineState` or an equivalent `isCreator`
      signal, and use the true creator where host/creator identity is intended.
- [ ] Test creator disconnect and greeter migration. Do not conflate the creator,
      greeter, and game authority roles.

## 13. Release validation and documentation — P0, gated by TURN and deployment

Some documentation and tests already exist. Audit and fill gaps instead of
rewriting completed work blindly.

- [ ] Choose and deploy the two distinct HTTPS origins; verify actual hosting
      support for security headers, SPA deep links, caching, and fragment-only
      invite secrets. A Pages workflow alone is not proof that `_headers` are
      enforced by the selected host. Publish only with owner approval.
- [ ] From a clean install run format, lint, typecheck, unit/property tests,
      runtime integration and IndexedDB tests, Chromium/Firefox where applicable,
      WebKit, production builds, bundle reports, and deploy verification.
- [ ] Run and record physical tests with at least two iPhones and a desktop:
      same-Wi-Fi and Wi-Fi/cellular parties, four-letter and QR joins, source
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
      four-letter codes. Confirm no obsolete application backend remains in Nova.
- [ ] Audit README, API reference, game-author/debugging/mobile/deployment guides,
      architecture diagrams, prompt docs, security limitations, browser support,
      contributing guidance, and non-goals. Keep media claims experimental where
      evidence requires it; don't promise per-game isolation on a shared origin.
- [ ] Document performance budgets and measurements: main initial bundle,
      runtime bootstrap, time to interactive, arena creation, room discovery,
      HTML transfer, state-action latency, and memory after repeated restarts.
      Investigate large regressions rather than inventing perfect-number gates.
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
      phones create/join/transfer/play, code guessing doesn't bypass admission,
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

## Source-of-truth documents

- `README.md` — application overview and documentation index.
- `deploy/cloudflare.md` — live versus planned infrastructure inventory.
- `deploy/opentofu/README.md` — safe plan/import process and provider gaps.
- `deploy/turn-creds/README.md` — TURN operation and verification.
- `docs/architecture/deployment.md` and ADR-0003 — origins/connectivity decisions.
- `docs/testing/trystero-connectivity-findings.md` — relay and device evidence.
- `docs/testing/mobile-safari-checklist.md` and
  `docs/testing/state-mode-vertical-slice.md` — release device checklists.
