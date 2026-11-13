# Nova remaining-work plan

The single tracker for remaining work, owner decisions, and release gates
(see `AGENTS.md`). Completed programs are archived in
[`docs/history/nova-simplification-evidence.md`](docs/history/nova-simplification-evidence.md)
and in Git history. P0 = release blocker, P1 = high, P2 = normal.

## 1. Edge Worker live — P0

The backend is one Cloudflare Worker, `rocketcrab-edge` (`deploy/edge/`,
runbook `deploy/cloudflare.md`). Code, tests, and bundle check are done;
OpenTofu was removed in favour of `wrangler.toml` + `npm run edge:deploy`
(owner approved 2026-11-12).

- [ ] **Owner:** create a Realtime TURN key in the Cloudflare dashboard.
- [ ] Deploy `rocketcrab-edge`, `secret put` both TURN secrets, run the
      runbook smoke test (`403` without Origin, `iceServers` with one, Classic
      `spyfall-new` returns a code, 61st request/min returns `429`).
- [ ] **Owner:** add the Realtime usage-based billing notification and
      confirm a test email arrives; record the threshold in the runbook.
- [ ] Delete the superseded `rocketcrab-cors-relay` Worker once
      `rocketcrab-edge` is verified; update the runbook's live-state section.

## 2. Static hosting — P0, owner decision

- [ ] **Owner:** choose the two distinct HTTPS origins (app + runtime) and a
      host. One GitHub account's project sites share an origin, and GitHub
      Pages cannot send custom security headers; a header-capable host or two
      custom (sub)domains is needed. See `docs/architecture/deployment.md`.
- [ ] Deploy both origins and verify SPA deep links, CSP/frame behaviour,
      caching, and that invite fragments never reach a server.

## 3. Discovery relays — P1, owner decision

- [ ] **Owner:** approve replacing the seven pinned Nostr relays with the five
      that passed the 2026-10-24 burst probe (`nos.lol`, `relay.primal.net`,
      `nostr.mom`, `relay.snort.social`, `relay.nostr.net`), or keep the current
      list. Evidence: `docs/testing/trystero-connectivity-findings.md`.
- [ ] If approved, change the pinned list, re-run `npm run test:e2e:trystero`,
      and record console behaviour in the findings doc.

## 4. Real-device and real-network verification — P0

Needs physical devices; WebKit automation does not replace it. Record results
in `docs/testing/trystero-connectivity-findings.md` and
`docs/testing/mobile-safari-checklist.md`.

- [ ] Desktop Wi-Fi ↔ iPhone cellular, and two phones on different networks,
      connect and stay up for more than a minute (TURN required historically).
- [ ] Four mixed devices see and ping each other; a phone leaves and rejoins.
- [ ] A 5 MiB game transfer arrives with matching hash over cellular.
- [ ] iPhone Safari backgrounded 1–3 minutes recovers without re-minting.
- [ ] A party longer than an hour survives on one 24 h TURN credential.
- [ ] Airplane mode / failed signaling shows useful errors and recovers.
- [ ] Full create → prompt → paste → test → save → party → play flow on
      Mobile Safari, with the master prompt tried on two AI chat services.
- [ ] State, simulation, and raw sample games; authority migration; private
      link and QR joins.
- [ ] Measure time to interactive, discovery time, transfer time, and
      state-action latency on a real phone and network.

## 5. Release sign-off — P0

- [ ] Audit user-facing docs (README, API reference, game-author guide,
      deployment, mobile, security limitations) against the shipped behaviour.
- [ ] A friend beta without coaching, to find product and error-message gaps.
- [ ] Record release evidence here and mark Nova ready for review.

## Legacy branches (no action needed for Nova)

`security/node22-brotli`/`prod` (legacy live-service security fixes),
`deps`, `backup/deps-*`, `vitest-browser*`, `allbadcards`, `liesgame`, and old
Dependabot branches are pre-Nova lines of work, not unfinished Nova features.
