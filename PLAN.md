# Nova remaining-work plan

Remaining work, owner decisions, and release gates for Nova.

## Goal and rules (owner direction)

1. **It must always work**: corporate networks, carrier NAT, school/hotel
   Wi-Fi, mixed networks. If a failure mode is plausible, handle it now.
2. **Simple yet robust.** Prefer deleting mechanisms to adding them.
3. **Use Trystero as much as it fits.** Keep it pinned; fix churn on upgrade.
4. **No paid always-on server.** Cloudflare Workers, Durable Objects and
   managed TURN only.

Working rules:

- Branch `nova`; one conventional commit per step; `npm run check` before
  every commit, plus `npm run test:e2e` for transport/party changes (WebKit
  needs the pinned Playwright 1.62.1 Podman image on this host).
- **Stop and ask the owner** before a first deploy of a Worker, any
  `wrangler delete`, a plan change, custom domains/DNS, or anything touching
  `rocketcrab.com`. Redeploys of an approved Worker are fine.
- Wrangler only via the npm scripts (`npx --yes wrangler@4.161.0`, absolute
  `--outdir`). Record changes made outside `wrangler.toml` in
  `deploy/cloudflare.md`.
- Tick boxes with one line of evidence (commit, test, or command output).

## Architecture

| Piece          | What                                                                    | Where                             |
| -------------- | ----------------------------------------------------------------------- | --------------------------------- |
| App            | `apps/nova/dist`                                                        | Worker `rocketcrab-nova` (assets) |
| Game runtime   | `apps/runtime/dist`, untrusted game HTML in an iframe, a different site | Worker `rocketcrab-runtime`       |
| Edge           | `/turn`, `/` Classic relay, `/signal/:room`, `/tunnel/:pair`, `/log`    | Worker `rocketcrab-edge`          |
| P2P            | Trystero 0.27 (`ws-relay`), `scale()` mesh up to 10, overlay beyond     | browser                           |
| Hard networks  | Cloudflare Realtime TURN, credentials from `/turn`                      | managed                           |
| WebRTC blocked | Per-pair encrypted WebSocket tunnel via `rtcPolyfill`                   | browser + `/tunnel`               |

Addresses until cutover are in `deploy/origins.json`. Cloudflare account
`f82d64d09da6cb5a0afa0120033a7e13`; `rocketcrab.com` still serves the legacy
site.

## Local verification (2026-11-17)

`npm run check` passed. All 84 app browser tests passed across Chromium,
Firefox, and WebKit, plus 7 dedicated Chromium transport tests. The edge
deploy dry run and built runtime header verification passed. The hosted
beta and physical-device checks are still pending.

## Nova UI polish (2026-11-21)

- [x] Align name entry actions and replace the setup spinner during a signaling
      outage. Party route tests and signaling recovery coverage in `d942d25`.
- [x] Use blue Molten Metal for Nova, soften the lobby waves, lighten shared
      surfaces, and confirm local game reloads. `npm run check` passed for `d0e915b`.
- [x] Streamline the prompt-to-editor handoff and defer the tutorial until the
      first game import. Build and editor tests passed.

## Before beta

- [x] Prefer self-contained games. Block workers and clipboard access in the
      deployed runtime policy. Creator prompt and runtime changes in `ac16264`.
- [x] Charge small tunnel frames against the existing rate budget and use
      Workers Logs for connection and readiness events (`fa0bcfe`, `9025080`).
- [x] Confirm the built runtime policy blocks workers in Chromium and Firefox.
- [ ] Check the deployed runtime headers and confirm that exiting a broken
      game returns to a usable lobby on iPhone. Headers verified live on
      2026-11-18. iPhone check pending.
- [x] Share transport reconnect setup and simplify admission timing. Keep Nova’s
      readiness acknowledgement and targeted delivery because Trystero’s room
      membership alone does not establish Nova compatibility or game readiness
      (`640d38c`).
- [x] Require peer confirmation before opening a tunnel. The transport regression
      covers a peer choosing native between the edge’s two pairing notifications.
      Trystero retries failures after a native channel has already opened.
- [x] Review native room broadcasts. Keep targeted delivery for now to
      preserve Nova admission and avoid a second state-sync path. Revisit
      small explicitly shared updates if host upload becomes a practical limit.
- [x] Replicate recent rejection results in the existing action history.
      The authority handoff regression drops the original acknowledgement.
- [x] Ignore stale wake-up probes after leaving or reconnecting.
      The lifecycle regression verifies that leaving keeps the app idle.
- [ ] Use the live iPhone checks to evaluate room, link, and game recovery
      before consolidating any other retry paths.
- [x] Audit Trystero shared-state checkpoints. Keep the current snapshot path.
      Trystero can reject records by timestamp before Nova’s validator runs,
      so one shared value cannot reliably choose across game terms.
- [x] Replace simulation mode with ticking state games: `tick` + `tickRate`
      on the authority, `nova.controls.set` for held input, no per-player view
      copies without `selectView` (`7c51fdf`, `81748f5`). Spike: 8 players at
      20 Hz cost ~6% CPU for all sessions in one process; upload was the
      cost, about half of it view copies. NaN/Map state is stored as
      replicated (`b4fd922`).
- [x] Hand authority off when the host's page is hidden (`20530fc`).
- [ ] Test Drift on real phones: late join, a host that switches apps, and
      a host that leaves. Check that the puck keeps moving on every screen.
- [ ] Measure a ticking game's host upload over TURN on cellular with 4–8
      phones, and lower the default tick rate if it is too costly.

## 1. Owner actions

- [x] Approve the first deployment and create the Realtime TURN key. Set both
      Worker secrets. Deployed 2026-11-18 with both secrets
      (`deploy/cloudflare.md`, Live state).
- [ ] Configure the Realtime usage alert and Workers/Durable Objects spending
      controls. Confirm the notification destination.
- [x] Retire the old relay. `rocketcrab-cors-relay` deleted 2026-11-18 with
      owner approval (`wrangler delete`; no requests in the prior 4 weeks).

## 2. First deploy and smoke test

- [x] Deploy the edge and run the checks in [the runbook](deploy/cloudflare.md).
      Origin gate, TURN, Classic, sockets, and 429 all passed on 2026-11-18.
- [ ] Deploy the runtime and app, check headers, and test a game in the editor.
      Deployed, and live headers match `_headers`. Editor test pending.
- [ ] Play on the live stack with two devices. Confirm that Workers Logs shows
      lobby and game readiness alongside transport outcomes. Two Chromium
      browsers on one machine passed (`direct`, `lobby-ready`, `game-ready`).
      Two real devices are still pending.

## 3. Real-device checks

Record results here and in the [Mobile Safari checklist](docs/testing/mobile-safari-checklist.md).

- [ ] Desktop Wi-Fi ↔ iPhone on cellular; two phones on different carriers;
      up for more than a minute.
- [ ] A school/corporate network or a UDP-blocking VPN: lands on TURN or the
      tunnel. Also note whether that network blocks `*.workers.dev`.
- [ ] Four mixed devices; a phone leaves and rejoins.
- [ ] 2 MiB game source over cellular and over the tunnel.
- [ ] iPhone Safari backgrounded 1–3 minutes recovers.
- [ ] A party longer than an hour (one 24 h TURN credential).
- [ ] Airplane mode and a blocked `/signal` show the messages and recover.
- [ ] Full create → prompt → paste → test → save → party → play on Mobile
      Safari; master prompt on two AI chat services.
- [ ] Turn-based, ticking and raw sample games; authority migration; link and
      QR joins.
- [ ] WebGL backgrounds (React Bits, `apps/nova/src/vendor/react-bits`) on
      an older/low-end phone: home (site background plus the Nova card) and
      `/build` stay smooth, and the party lobby (site background plus the
      Welcome slats) doesn't heat the phone or drain the battery over a 10+
      minute wait. Headless SwiftShader checks held 60 fps on both. If a phone
      struggles, lower `PIXEL_BUDGET` in `SiteBackground.tsx` first.
- [ ] A friend beta without coaching.

## 4. Cutover (owner approval)

- [ ] Switch to Workers Paid ($5/month).
- [ ] Attach `rocketcrab.com` to `rocketcrab-nova`; add it to the edge
      `ORIGIN_ALLOWLIST`; rebuild the runtime with the new
      `VITE_MAIN_ORIGIN`; redeploy all three.
- [ ] Move the edge onto `rocketcrab.com` (for example `edge.rocketcrab.com`,
      or merged into the app Worker under `/api`). School and company
      filters often block `*.workers.dev`, and without signaling nothing
      connects.
- [ ] **Owner:** register a second domain for the game runtime and attach
      it to `rocketcrab-runtime`. It must be a different site from the app (a
      `rocketcrab.com` subdomain is the same site, so a looping game would
      freeze the app on desktop), and leaving it on workers.dev keeps the
      filter risk.

## Known limits and open decisions

- **Party size.** No `maxUsers`. Trystero's `scale()` overlay tracks at most
  2,048 peer descriptors. Practical capacity depends on the game and the
  authority’s connection. Local browser runs reached 50.
- **Peer-link messages are generic** ("Connecting to a player…"). Trystero
  exposes no named pre-connection event.
- **Networks that block WebSockets to Cloudflare** cannot connect at all. They
  can report a signaling failure only when the HTTP logging endpoint remains reachable.

## Cleanup for the owner

- [ ] Delete the 46 local `work/*` branches left by the earlier agents. Each
      one's changes are already on `nova` (checked with `git cherry`; the
      tunnel-server commits were squashed with identical content):
      `git branch --list 'work/*' --format='%(refname:short)' | xargs git branch -D`

## Legacy branches (no action needed for Nova)

`security/node22-brotli`/`prod`, `deps`, `backup/deps-*`, `vitest-browser*`,
`allbadcards`, `liesgame`, and old Dependabot branches are pre-Nova work.
