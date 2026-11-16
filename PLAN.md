# Nova remaining-work plan

The single tracker for remaining work (see `AGENTS.md`). The connectivity
program's full plan and evidence are archived in
[`docs/history/nova-connectivity-plan-2026-11.md`](docs/history/nova-connectivity-plan-2026-11.md).
Code comments that cite `PLAN.md §n` refer to that archive. Earlier programs
are in `docs/history/nova-simplification-evidence.md`.

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

## State (2026-11-15)

Everything above is built and tested locally, and nothing is deployed.
`npm run check` passes, and so does the real-browser tunnel test
(`e2e/party-tunnel.spec.ts`: one player's WebRTC forced off, three-player game
plays, pairing about 6 s after join). Large rooms: 10/25/50 real browsers
worked locally; 100–200 only in the in-process simulation.

## 1. Owner actions (blocking)

- [ ] Enable Workers Analytics Engine (Dashboard → Workers → Analytics
      Engine). The first `npm run edge:deploy` (2026-11-15) failed with API
      error 10089 because of the `CONNECTION_EVENTS` binding.
- [ ] Create a Realtime TURN key, then enter both secrets at the
      `wrangler secret put` prompts (`deploy/cloudflare.md`).
- [ ] Add the Realtime usage billing notification and, if offered, a
      Workers/Durable Objects limit notification; confirm a test email.
- [ ] Delete the old `rocketcrab-cors-relay` Worker (verified unused
      2026-11-15: no branch or the legacy site references it):
      `npx --yes wrangler@4.161.0 delete --name rocketcrab-cors-relay`, then
      drop it from "Live state" in `deploy/cloudflare.md`.

## 2. First deploy and smoke test (agent, after §1)

- [ ] `npm run edge:deploy`; runbook smoke test: 403 without Origin,
      `iceServers` with one, Classic `spyfall-new` returns a code, 121st
      `/turn` request in a minute returns 429, `/signal` and `/tunnel` upgrade.
- [ ] `npm run deploy:runtime` and `npm run deploy:nova`; open the app,
      create a game, run it in the editor; `curl -I` both for the headers.
- [ ] A two-device party on the live stack; confirm `/log` events arrive
      (`scripts/connection-stats.mjs`, needs an Account Analytics Read token).

## 3. Real-device checks

Record results in `docs/testing/trystero-connectivity-findings.md` and
`docs/testing/mobile-safari-checklist.md`, with the connection stats.

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
- [ ] State, simulation and raw sample games; authority migration; link and
      QR joins.
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
  2,048 peers, and real-browser runs stop at 50; "unlimited" means hundreds.
- **Peer-link messages are generic** ("Connecting to a player…"). Trystero
  exposes no named pre-connection event.
- **Networks that block WebSockets to Cloudflare** cannot connect at all. They
  appear in the stats as `failed` / `relay-failed` / `signaling_ok: false`.
- **Replayed action IDs** after an authority migration can report `accepted`
  for an action whose rejection ack was lost (archive §3.7). Rare; fixing it
  changes the wire format.
- **Owner decision:** `docs/api/nova-api-ai-reference.md` (embedded in the
  master prompt) implies raw reliable/ordered options hold on real parties
  (they degrade) and calls the minimal game "9 lines" (it is 5). Changing it
  changes the shipped prompt.

## Cleanup

Done 2026-11-15: Archived the superseded media-bridging spike; retained the runtime sandbox findings and matrix because current architecture and support-policy docs rely on them. Added the separate Chromium transport suite to CI.

## Cleanup for the owner

- [ ] Delete the 46 local `work/*` branches left by the earlier agents. Each
      one's changes are already on `nova` (checked with `git cherry`; the
      tunnel-server commits were squashed with identical content):
      `git branch --list 'work/*' --format='%(refname:short)' | xargs git branch -D`

## Decisions log

| Date       | Decision                                                                                |
| ---------- | --------------------------------------------------------------------------------------- |
| 2026-11-12 | OpenTofu removed; `wrangler.toml` + `wrangler deploy` is the only path.                 |
| 2026-11-12 | One `VITE_EDGE_ORIGIN` for all edge routes.                                             |
| 2026-11-12 | Static hosting on Cloudflare assets Workers; GitHub Pages removed.                      |
| 2026-11-12 | Runtime on a different site from the app (process isolation).                           |
| 2026-11-12 | Beta on workers.dev; saved games not migrated at cutover (accepted).                    |
| 2026-11-12 | Own signaling relay, one Durable Object per room; no Nostr.                             |
| 2026-11-12 | Tunnel fallback via `rtcPolyfill`, one Durable Object per pair; not proposed upstream.  |
| 2026-11-12 | Workers Free through beta; Workers Paid from the `rocketcrab.com` cutover.              |
| 2026-11-12 | No host-relayed star topology; Trystero mesh (+ tunnel) instead.                        |
| 2026-11-13 | Generic "Connecting to a player…"; no pre-connect discovery protocol.                   |
| 2026-11-13 | Log an explicit `unknown` outcome when the path can't be determined.                    |
| 2026-11-13 | No 100-browser runs; browsers ≤ 50, larger sizes by in-process simulation.              |
| 2026-11-13 | Authority fan-out: lean snapshots, targeted dispatch, then state deltas.                |
| 2026-11-13 | Keep Nova member IDs; Trystero persistent identity not adopted.                         |
| 2026-11-15 | A player who leaves may rejoin; the engine never auto-rejoins after a deliberate leave. |
| 2026-11-15 | Signaling outages are logged once each (`relay-failed`, `signaling_ok: false`).         |

## Legacy branches (no action needed for Nova)

`security/node22-brotli`/`prod`, `deps`, `backup/deps-*`, `vitest-browser*`,
`allbadcards`, `liesgame`, and old Dependabot branches are pre-Nova work.
