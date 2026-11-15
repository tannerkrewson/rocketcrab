# Nova remaining-work plan

The single tracker for remaining work (see `AGENTS.md`). Completed programs
are archived in `docs/history/nova-simplification-evidence.md` and Git
history. Written 2026-11-12 for hand-off to implementation agents who do not
share the planning conversation. **Read all of §0 before starting any
workstream.**

---

## 0. Read first

### 0.1 Goal and design rules (owner direction)

Rocketcrab Nova is a party-games web app: players create AI-generated HTML
games and play them together from phones and laptops. The owner's
non-negotiables:

1. **It must always work.** Corporate networks, 5G carrier NAT, school/hotel
   Wi-Fi, mixed networks. "Some players can't connect" ruins a party game.
   If a failure mode is plausible, handle it now — don't wait for evidence.
2. **Simple yet robust.** Prefer deleting mechanisms to adding them. Prefer
   one tool, one config file, one deploy path.
3. **Use Trystero as much as it fits.** Peer-to-peer via the Trystero
   library is the core of the design. Where a Trystero feature fits Nova's
   needs, use it and delete Nova's equivalent code. Library churn is
   acceptable; keep the version pinned and fix breakage on upgrade.
4. **No paid always-on server.** Cloudflare Workers / Durable Objects /
   managed TURN are fine (serverless, pay-per-use, mostly free tier).

### 0.2 Target architecture

| Piece                          | What                                                                                                              | Where                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Nova app (static)              | `apps/nova/dist`                                                                                                  | Cloudflare Worker `rocketcrab-nova` (static assets)    |
| Runtime origin (static)        | `apps/runtime/dist`, runs untrusted game HTML in an iframe                                                        | Cloudflare Worker `rocketcrab-runtime` (static assets) |
| Edge Worker                    | `/turn` TURN mint, `/` Classic relay, **new** `/signal` signaling, **new** `/tunnel/:id` fallback, **new** `/log` | `rocketcrab-edge` (`deploy/edge/`)                     |
| P2P                            | Trystero 0.27, signaling via our own `/signal` relay                                                              | browser                                                |
| Hard networks                  | Cloudflare Realtime TURN (credentials from `/turn`)                                                               | managed                                                |
| Networks that block all WebRTC | Per-pair WebSocket tunnel via `rtcPolyfill` (§5)                                                                  | browser + `/tunnel`                                    |

All Cloudflare config lives in `wrangler.toml` files; all deploys are
`wrangler deploy` through npm scripts. There is **no OpenTofu** (removed by
owner decision) and **no GitHub Pages** after §2.

Addresses (until the cutover in §9):

- App: `https://rocketcrab-nova.tannerkrewson.workers.dev`
- Runtime (permanent): `https://rocketcrab-runtime.tannerkrewson.workers.dev`
  — `workers.dev` is on the Public Suffix List, so this is a different
  _site_ from the app, which gives real browser process isolation.
- Edge: `https://rocketcrab-edge.tannerkrewson.workers.dev`

Cloudflare account `f82d64d09da6cb5a0afa0120033a7e13`, workers.dev subdomain
`tannerkrewson`. `rocketcrab.com` is a zone on this account (Free plan) and
currently serves the **legacy** live site — do not touch it before §9.

### 0.3 Rules for every workstream

- Work on branch `nova`. Commit after each numbered step with a
  conventional message (`feat(edge): …`, `refactor(party): …`). Do not
  squash unrelated steps together.
- Before every commit: `npm run check` must pass (format, lint, typecheck,
  unit tests including `deploy/edge`, build). For transport/party changes
  also run `npm run test:e2e`. If a test fails, fix the cause; never delete
  or weaken a test just to pass.
- UI rules in `AGENTS.md` apply (no `ghost` buttons, HeroUI components).
- Keep docs in sync in the same commit: `deploy/cloudflare.md` for anything
  on Cloudflare, `docs/architecture/deployment.md` for hosting, ADRs when a
  decision changes (add an "Amended YYYY-MM-DD" section, don't rewrite
  history). New docs need an owner link (README index or an ADR).
- Wrangler: always `npx --yes wrangler@4.161.0 …` (or the npm scripts).
  Pass absolute paths to `--outdir`; Wrangler resolves relative ones
  inconsistently and once caused committed build junk.
- **Stop and ask the owner** before: any first-time `wrangler deploy` of a
  new Worker, any `wrangler delete`, changing the Cloudflare plan, adding a
  custom domain/DNS record, or anything touching `rocketcrab.com`. Routine
  redeploys of an already-approved Worker are fine. Read-only Wrangler/API
  calls are always fine.
- Verify claims about Cloudflare pricing/limits and library behaviour from
  current official docs or source; write the date checked next to any number
  you record.
- Tick boxes here when a step is done and add one line of evidence (commit
  hash, test name, or command output summary).

### 0.4 Current state (2026-11-12)

- Edge Worker code is done and tested but **not deployed**
  (`deploy/edge/`, runbook `deploy/cloudflare.md`). The live account still
  has the old relay-only Worker `rocketcrab-cors-relay`.
- Client reads the edge origin from one env var, `VITE_EDGE_ORIGIN`
  (`apps/nova/src/lib/edge.ts`).
- Trystero is 0.26.0 (`packages/trystero-transport`), signaling over public
  Nostr relays.
- Static hosting is a manual GitHub Pages workflow
  (`.github/workflows/deploy.yml`) that cannot provide two origins or headers.
- Test reliability: `example-game.test.ts` uses manual hub delivery, waits for
  all question timers, and holds messages through the reveal deadline before
  asserting `stale_revision` from the real state engine. The original intermittent
  failure did not reproduce in 12 isolated runs; the manual-delivery test passed
  12 isolated runs. The initial synchronization still allowed automatic hub
  delivery; manual scheduling closes that gap. This fixes the uncontrolled race
  setup, not evidence of a product failure. `npm run
  check` passed; `npm run test:e2e` passed all 60 tests using the pinned
  Playwright 1.62.1 Noble Podman image (host WebKit dependencies are missing).

---

## 1. Edge Worker live — P0

- [ ] **Owner:** create a Realtime TURN key (Dashboard → Realtime → TURN
      Server → Create). Give the agent nothing; the owner pastes values into
      `wrangler secret put` prompts.
- [x] Add `https://rocketcrab-nova.tannerkrewson.workers.dev` to
      `ORIGIN_ALLOWLIST` in `deploy/edge/wrangler.toml` (keep
      `https://rocketcrab.com` and the localhost entries).
      Evidence: configuration updated; no deploy or live change performed.
- [ ] **Owner:** enable Workers Analytics Engine for the account
      (Dashboard → Workers → Analytics Engine). The first
      `npm run edge:deploy` on 2026-11-15 failed with API code 10089 ("You
      need to enable Analytics Engine") because of the `CONNECTION_EVENTS`
      binding; nothing was deployed. Re-run the deploy afterwards.
- [ ] With owner approval: `npm run edge:deploy`, then both
      `secret put` commands from `deploy/cloudflare.md`, then the runbook's
      smoke test (403 without Origin; `iceServers` with one; Classic
      `spyfall-new` returns a code; the 61st request in a minute returns 429).
- [ ] **Owner:** add the billing notifications and confirm a test email
      arrives: the Realtime usage-based billing notification (record the
      threshold in the runbook), and, while on Workers Free, a Workers and
      Durable Objects limit notification if the dashboard offers one
      (`deploy/cloudflare.md`, "Beta plan and pricing evidence", owner/account
      gates). This is the only owner item for usage notifications.
- [ ] With owner approval, delete `rocketcrab-cors-relay`; update the
      runbook's "Live state" section.

## 2. Static hosting on Cloudflare — P0 (owner approved 2026-11-12)

Replace GitHub Pages with two assets-only Workers. Owner accepted that games
saved on the workers.dev beta address will not carry over to `rocketcrab.com`
after the cutover (browser storage is per origin).

1. [x] Create `deploy/nova/wrangler.toml`: `name = "rocketcrab-nova"`, `[assets] directory = "../../apps/nova/dist"`, `not_found_handling = "single-page-application"`, no `main` script, `workers_dev = true`, `preview_urls = false`. Create `deploy/runtime/wrangler.toml` the same way for `rocketcrab-runtime` with `not_found_handling = "404-page"` (the runtime is not an SPA — check how `apps/runtime` routes before choosing).
       Evidence: assets-only configs added; runtime has a single `index.html` and uses 404 handling for unknown paths. No deployment performed.
2. [x] Security headers become real HTTP headers. Workers static assets read a `_headers` file from the asset directory (verify in current Cloudflare docs). Make the Vite builds **emit** `dist/_headers` from the same code that builds the CSP, so there is one source of truth:

   - Nova: extend the `nova-csp-meta` plugin in `apps/nova/vite.config.ts` to also write `_headers` with the identical CSP plus `frame-ancestors 'none'`, the other headers now in `deploy/nova/_headers`, and immutable caching for `/assets/*`. Keep the CSP `<meta>` tag too (harmless, protects file previews).
   - Runtime: add a small plugin in `apps/runtime/vite.config.ts` that writes the permissive policy from `deploy/runtime/_headers` with `frame-ancestors <main origin>` filled from `VITE_MAIN_ORIGIN`.
   - Delete the hand-written `deploy/nova/_headers`, `deploy/nova/_redirects`, `deploy/runtime/_headers`, `deploy/runtime/_redirects`.

   Evidence: Vite emits `_headers`; Nova uses the same CSP builder for meta and header. Cloudflare's static assets headers documentation was checked 2026-11-12; missing runtime main origin fails closed.

3. [x] Origins: production builds pin `VITE_RUNTIME_ORIGIN` (nova) and `VITE_MAIN_ORIGIN` (runtime) to the addresses in §0.2. Add npm scripts `deploy:nova` and `deploy:runtime` that build with those env vars (plus `VITE_EDGE_ORIGIN` for nova), run `node scripts/verify-static-deploy.mjs`, then `wrangler deploy --config deploy/<name>/wrangler.toml`. Put the production URLs in one place (e.g. a small `deploy/origins.json` read by the scripts) rather than repeating them.
       Evidence: deploy scripts use `deploy/origins.json` for both builds and verify before invoking pinned Wrangler; no deployment performed.
4. [x] Delete GitHub Pages machinery: `.github/workflows/deploy.yml`, the 404.html copy, `--pages` in `scripts/verify-static-deploy.mjs`, and project-site base-path support (`VITE_RUNTIME_BASE`, `apps/nova/src/lib/basepath.ts`, `runtimeBasePath()` in `apps/nova/src/lib/runtime-origin.ts`, base handling in `main.tsx` and `runtime-host.ts`). Both sites now live at their origin root. Keep the `runtime.` hostname derivation only if something still needs it; otherwise remove it and require the env pin in production.
       Evidence: removed Pages workflow, 404 fallback handling and base-path machinery; production origins are explicitly pinned and localhost development swaps ports.
5. [x] Update `scripts/verify-static-deploy.mjs` to check the emitted `_headers` (CSP present, `frame-src` = runtime origin, runtime `frame-ancestors` = main origin) and update `e2e/deployment.spec.ts`.
       Evidence: verifier checks matching Nova meta/header policies and runtime framing origin; deploy script passes both origins.
6. [x] Rewrite `docs/architecture/deployment.md` for Cloudflare (it is currently GitHub-Pages-specific). Amend ADR-0001 and ADR-0008: the runtime must be on a different **site** (registrable domain), not just a different origin — the repo's own finding (`docs/testing/runtime-sandbox-findings.md`) is that browser process isolation is per site, so a looping game on a same-site runtime can freeze the app. Record the workers.dev runtime decision.
       Evidence: Cloudflare runbook replaces Pages guidance; ADR-0001 and ADR-0008 amendments require different sites and record the permanent workers.dev runtime.
7. [ ] With owner approval, first deploy of both Workers; open the app, create a game, run it in the editor (proves the runtime iframe, CSP and `frame-ancestors`), and check response headers with `curl -I`.

## 3. Trystero 0.27 migration — P0 (owner approved)

- [x] Fix source acceptance when a joiner downloads from one holder while the
      host also announced the same source. Evidence: `game-source.test.ts`
      holds the holder response until the host announces, then verifies both
      holders receive acceptance; corrupt bytes receive no acceptance. The
      coordinator tracks connected announcers for one exact descriptor and
      acknowledges only after compatibility and byte/hash verification. Further
      regression tests cover holder disconnect before and after verification,
      reentrant cancellation and further holder loss during disconnect, and
      late acknowledgement failures after a selection change.

0.27.0 (released 2026-11-11) changes the wire protocol (0.26 and 0.27 peers
cannot talk) and much of the API. Read the release notes and
`MIGRATION.md` in the Trystero repo (`gh release view 0.27.0 -R dmotz/trystero`).
Nova is not launched, so no compatibility shim is needed — but bump the
Nova app IDs in `packages/trystero-transport/src/app-id.ts` so old and new
clients never share rooms.

Evidence: `trystero-transport.test.ts` covers reconnect/leave and suspend/leave
races, retry serialization and cancellation before stalled teardown finishes;
`identity-races.test.ts` covers admission ordering and broadcasts are restricted
to admitted peers. `npm run check`
passed; `npm run test:e2e` passed 60/60 and `npm run test:e2e:trystero`
passed 4/4 (Podman Playwright, 2026-11-13).

1. [x] Mechanical migration of `packages/trystero-transport` (and any other Trystero imports): `on*()` listener methods returning unsubscribe, `await room.getSelf()` instead of `selfId`, `room.onError` instead of `onJoinError`, `getPeers()` returning `PeerInfo`, suspend/resume kept as leave/rejoin (not `setRelayConnectivity`, which exists in 0.27 but is not called anywhere in `packages/` or `apps/`): `TrysteroTransport.suspend` tears the room down with `room.leave()` through the shared teardown barrier (`teardownRoom` and `releaseRoom`, `packages/trystero-transport/src/trystero-transport.ts:466`, `:1153`, `:1236`), and `resume` rejoins with `joinRoom` (`:490`). Adopting `setRelayConnectivity` for suspend is a possible later simplification, not done. `joinRoom` throwing on duplicate active joins (leave first), targeted `send` rejecting for disconnected targets. Pin `trystero` and `@trystero-p2p/*` to exact `0.27.0`. All existing tests green, including `npm run test:e2e:trystero`.
2. [x] Replace error-string matching with typed codes. Today `handleJoinErrorNotice` in `apps/nova/src/lib/party/engine.ts` and `apps/nova/src/lib/party/connection-errors.ts` parse messages; switch to `RoomError.code` (`peer-connect-failed`, `relay-failed`, `room-full`, `decrypt-failed`, …).

   Closed 2026-11-14 (coordinator): string parsing is gone and every `RoomError.code` is mapped (evidence below). The remaining gap, a real room-full through `TrysteroTransport.join` and the party UI, cannot happen in production because no `maxUsers` is configured (§3.3), so it is not a release gate; the raw room-full spec plus the unit and injected-report tests cover the mapping.

   Partial evidence: the unused pre-0.27 string parser was removed from the private transport package's public exports after a repository-wide consumer search; `errors.test.ts` verifies all nine typed codes, both decrypt stages, preserved fields and misleading wording. Adapter-owned timeout and admission tests remain. `npm run check` passed; `npm run test:e2e` passed 75/75 and `npm run test:e2e:trystero` passed 5/5 in the Playwright container against this worktree's servers. This does not establish real capped-room behavior or peer attribution. Party connection messages and deduplicated notices map all nine 0.27 `RoomError.code` values, with legacy category fallback; `connection-errors.test.ts` and `engine.test.ts` cover every code including room-full and decrypt-failed. No `maxUsers` is configured in the transport. `npm run check` passed (after a transient unrelated `nova-api` stale_revision test failure); `npm run test:e2e` passed 60/60 in the Playwright 1.62.1 Podman image against this worktree's servers. This is not end-to-end verification of a real room-full or wrong-invite flow; leave this step open.

   Real room-full evidence (2026-11-13): `e2e-trystero/e2e/room-full.spec.ts` drives a test-only raw Trystero page (`e2e-trystero/src/room-full-proof.ts`) with `maxUsers: 2`. Production sets no cap and the transport has no test-only option for one, so this spec does not use `TrysteroTransport.join` or `onJoinError`. A third joiner receives a real Trystero `room-full` RoomError, which the page maps with Nova's `fromRoomError` to category `room_full`; the first two stay connected and exchange a message. `npm run test:e2e:trystero` passed 6/6 with this spec in the Playwright 1.62.1 Podman image, and the spec passed in three separate runs. Not verified: a real room-full through `TrysteroTransport.join` and `onJoinError`, and the party UI's response to a real room-full. Leave this step open; the mapping function, not the transport's join path, has been exercised with a real error.

3. [x] Party size: **no cap** (owner wants arbitrarily large parties, 2026-11-12). Do not set `maxUsers`. Still handle `room-full` gracefully in case a cap is added later. Evidence (2026-11-13): `grep` finds no `maxUsers` in production source under `packages/` or `apps/nova/src/` (test files only). A real raw-Trystero `room-full` error maps to category `room_full`, which `errors.ts` treats as fatal (no automatic retry); see `e2e-trystero/e2e/room-full.spec.ts` (§3.2). The party UI's room-full notice is covered by unit tests and an injected-report browser test (§7). No real-flow UI check of a room-full exists, so the graceful-handling part is evidenced at the mapping and notice levels only.

4. [x] **Feature fit review — write it down before coding.** For each Trystero 0.27 feature below, read its doc in the Trystero repo (`docs/*.md`) and the Nova code it would replace, then record in this file: _adopt_ / _don't adopt_ + one-paragraph reason. Owner rule: if it fits Nova's needs, adopt it and delete Nova's code. Candidates:

   - `userId` identity (`docs/identity.md`) vs `apps/nova/src/lib/party/identity.ts`.
   - `makeUserState` (lobby presence: display name, ready) vs the party roster in `packages/party/src/session.ts` / `messages.ts`.
   - `makeState` (shared party state, e.g. selected game) vs party control messages.
   - Actions with `onReceiveProgress` for the up-to-2 MiB game source vs `packages/party/src/game-source.ts` (592 lines).
   - Trystero's authority module (`packages/core/src/authority.ts`, tests `scale-authority-*.spec.ts`) vs Nova's authority election and migration (ADR-0007, `packages/nova-api` session/state engines).
   - `roles()` / admins / ban vs Nova host controls. Check whether admin rights can pass to a successor when the host leaves (Nova needs a deterministic successor); if not, don't adopt.
   - `scale()` — adopt; see step 6.

   **Review evidence (checked 2026-11-13):** Trystero release `0.27.0`, tag
   commit `8d3f57ef42c3d622840eec479784c99deeeb2d05`; reviewed its
   `docs/identity.md`, `state.md`, `actions.md`, `roles.md`, `scaling.md`,
   `packages/core/src/authority.ts` and `test/node/scale-authority-{state,roles}.spec.ts`
   against Nova's identity, party session/messages, game-source coordinator,
   transport, ADR-0007 and nova-api session/state/simulation engines. These are
   design decisions, not implementation or proof of behavior under load.

   - **Identity — adopt**, replacing the generated/stored member ID with the
     verified persistent Trystero `userId`; keep display-name persistence and
     reset UX separately. Default identity is IndexedDB per appId, shared across
     tabs, unlike Nova's localStorage member ID; joining is asynchronous and
     storage fallback/reset semantics and multiple tabs must be tested. Preserve
     the stable game-facing player ID contract and handle existing stored IDs
     deliberately; no assumption that an old ID can be imported as a key.
   - **`makeUserState` — defer replacement pending an admission-safe design;
     the earlier equivalence claim was premature.** Re-reviewed 2026-11-13
     against [0.27 `docs/state.md`](https://github.com/dmotz/trystero/blob/8d3f57ef42c3d622840eec479784c99deeeb2d05/docs/state.md)
     and [`state.ts`](https://github.com/dmotz/trystero/blob/8d3f57ef42c3d622840eec479784c99deeeb2d05/packages/core/src/state.ts),
     `packages/trystero-transport/src/trystero-transport.ts`, and party
     `session.ts`/`messages.ts`. The transport already uses `makeUserState`
     for `nova.identity`, with ephemeral `identity: "none"`: a signed user
     slot is not Nova's stable member ID. It validates the slot against the
     connected peer, rejects changes to its identity **including displayName**,
     and exposes peers only after bilateral acknowledgements. State updates and
     Trystero user presence alone bypass that Nova admission boundary; simply
     changing the existing slot on rename causes rejection. A separate mutable
     slot or redesigned identity payload could carry names, but must bind each
     update to an admitted endpoint. On admission, read and validate the latest
     slot even if earlier callbacks were ignored; dropping callbacks without
     a current-value read loses the name. Discard rejected-peer values and
     guard against stale endpoint/room epochs.
     `party.rename` validates the session, member and connection envelope and
     the protocol display-name schema (1–32 characters); `renamedNames`
     overrides the initial peer name and clears on peer join/leave. Test the
     existing late-join/reconnect behavior rather than assume a slot preserves
     it: state coalesces writes and syncs current values, unlike event messages.

     Roster/host are not just presence slots: `members` deduplicates the local
     member and admitted connections by Nova member ID; host waits for creator
     context, prefers the connected creator, otherwise sorts member IDs. Peer
     events, context propagation and game authority/migration remain necessary
     unless their contracts are independently replaced. A per-user list can
     contain unadmitted peers or multiple ephemeral users for one member, so
     cannot directly replace that roster. No ready flag exists today.

     With persistent Trystero IDs shared across tabs, `docs/state.md` specifies
     one LWW slot per user, shared updates and eviction only after the last tab
     leaves; `state.ts` keys records by user ID and orders writes by HLC, user,
     peer and signature. The current `getMeta(userId).peerId === peerId` check
     and per-connection identity payload cannot admit both tabs reliably when
     their one slot is overwritten. Choose explicit member-vs-endpoint and
     simultaneous-name semantics before switching; keep endpoint admission,
     connection targeting and deterministic host/migration independent of
     user-slot lifetime. Legacy IDs and recovery need the decision in step 5.

     Required tests before deleting code: pre-admission, rejected and timed-out
     peers and queued updates; valid/invalid and rapid concurrent renames,
     late join, disconnect/reconnect and stale updates; duplicate member IDs
     over distinct connections; creator departure/rejoin, concurrent joins,
     deterministic host and game migration; persistent same-user tabs joining,
     renaming and leaving in both orders, including slot writer departure,
     plus identity reset/storage fallback. Exercise real 0.27 and scaled
     virtual peers as well as transport fakes. These are obligations, not
     evidence of equivalence; no presence replacement is implemented.

     **Incremental candidate:** retain the existing immutable identity slot,
     bilateral admission, per-connection peer map, member roster and host
     election; add a separate mutable user-state name slot under today's
     ephemeral per-connection identity. This does not depend on adopting
     persistent identities and might replace only rename messages and the
     name overlay. It is not a drop-in behavioral match: the upstream slot
     synchronizes current state to late joiners and coalesces writes, whereas
     `announceRename` sends an event only to connected peers and does not
     change the transport's original `displayName`. A temporary in-memory
     `session.test.ts` experiment (run 2026-11-13; one test passed, then
     removed) confirmed a current peer sees `New`, but a later joiner sees
     `Old` from the original identity. It also confirmed that a second
     connection with the same member ID clears the member's rename overlay;
     a rename from that connection wins until either connection leaves, which
     clears the overlay and falls back to the first remaining peer. A direct
     per-user slot lookup would instead retain separate current endpoint names
     and change these observations. Retaining an event-style overlay and
     reproducing its clear/order behavior could preserve more, but reduces the
     claimed deletion and coalescing still loses intermediate rename events.
     Decide whether improved late-join convergence and different duplicate-ID
     behavior are intended before changing the contract; do not imply those
     differences are required for an incremental slot design. Test event
     delivery/order and rename failure semantics as well as the cases above
     using real 0.27; the in-memory experiment tests current Nova behavior only,
     not the candidate or real transport. No candidate implementation is
     claimed safe on this evidence.

     **Real-network proof (2026-11-13):** `e2e-trystero/presence-e2e/presence.spec.js`
     runs a raw Trystero 0.27 page (`e2e-trystero/src/presence-proof.js`:
     `identity: "none"`, scale plugin, room-scoped relay URL from
     `signalUrl`) against the local edge Worker on 18787 in real Chromium with
     WebRTC. The page keeps a separate `makeUserState("proof.name")` slot and an
     admission map that the test drives directly through `admit`/`reject`.
     Names are applied only for admitted endpoints, and admission reads the
     slot's current value. Seven named tests ran three times in the Playwright
     1.62.1 container: 7/7 on every run, no retries, no flakes. Results:
     1. **Existing admitted peer sees a rename: yes.** `Alpha` then `Beta` were
        applied. In every run, a three-write burst applied only `three` on the
        admitted peer, so the intermediate renames were not applied.
     2. **Late joiner sees the latest name: yes.** A joiner after `original` then
        `latest` read `latest`, applied only at admission, and never applied
        `original`. Today's Nova shows late joiners the original name, so this is
        a behaviour change.
     3. **Update before admission: read at admission, yes.** The slot held
        `before admission` before admission. Admission applied that current value,
        and a later update applied normally.
     4. **Unadmitted or rejected writes: the proof page's own gate applied
        nothing.** This says nothing about Nova's real admission. Every peer
        could read the raw slot (`intruder` and `rejected` both appeared in
        `get()`), so the state layer does not enforce admission and every
        consumer must gate its reads.
     5. **Reconnect:** a departed endpoint's slot reads `null` after it leaves. A
        rejoin in a fresh browser context received a new user ID; only that case
        was measured, not identity persistence across reloads or contexts. Its
        name is applied only after re-admission. Reconnect over a relay socket
        drop without a leave was not induced.

     Logs for the three runs were kept outside the repository. Reproduce with
     two servers in Paseo terminals, from the worktree root:
     `TMPDIR="$HOME/.cache/tmp" npm run edge:dev -- --port 18787 --var ORIGIN_ALLOWLIST:http://localhost:5200,https://localhost:5200,http://127.0.0.1:5200`
     (`http://127.0.0.1:5200` is a non-default allowlist entry, because the
     proof page is served from that origin), and inside `e2e-trystero/`:
     `node ../node_modules/vite/bin/vite.js --port 5200 --strictPort`. Then, from
     the worktree root:
     `podman run --rm --network host --userns keep-id -v "$PWD:$PWD:Z" -w "$PWD" mcr.microsoft.com/playwright:v1.62.1-noble npx playwright test -c e2e-trystero/presence.playwright.config.js`.
     Not tested: Nova's real `PartyEngine`/transport bilateral admission (the
     test calls `admit`/`reject` directly); duplicate Nova member IDs across
     tabs; Firefox and WebKit; production signaling (only the local Worker, no
     TURN, no cross-network); more than three peers; all peers direct (two or
     three peers in a full mesh), so the scale virtual path was not exercised;
     the production join's `maxReceiveBytes`, `turnConfig` and `rtcConfig`.

     **Recommendation:** the incremental candidate is viable for names only.
     The mechanism works over real 0.27 WebRTC and passes all five checks when
     every read is gated and admission applies the current value. It is not yet
     safe to replace the name overlay: the real admission path, duplicate IDs
     and tabs are untested, and the raw slot exposes names before admission.
     Next step is a candidate test against the real transport's admission path;
     no application code changes until then. The owner would need to accept:
     - late joiners see the current name, not the original;
     - renamed names of unadmitted peers become readable from room state.
       Today's `nova.identity` already exposes the join-time `displayName`
       before acknowledgement, and acknowledgement gates only publication to
       the app; the candidate's new exposure is the mutable name, unless it
       hides or encrypts that value;
     - a rename made during admission applies once admission completes;
     - intermediate renames are not delivered, so only the final name applies;
     - a departed endpoint's name disappears from the slot immediately on leave;
     - a reconnect is a new endpoint, so the name returns only after re-admission
       and the peer resends it.

   - **`makeState` — adoption deferred after re-review; previous adoption
     recommendation was premature.** The 0.27 `docs/state.md` and installed
     `@trystero-p2p/core` `dist/state.mjs` describe/implement a signed,
     whole-value LWW slot, relayed even after its author leaves. In `commitEntry`,
     LWW comparison precedes the application validator, but rejected records
     are not stored. Nova's `session.ts` derives host from creator context and
     the current roster, and accepts classic room announcements only from the
     current host; `engine.ts` has the current host answer late-join requests.
     A validator requiring the current host rejects a legitimate cached
     selection authored by a departed host; accepting departed authors instead
     cannot by itself distinguish that selection from a stale/conflicting
     former-host write during migration. Roles do not transfer root authority
     (see below). Keep selection catch-up until a safer design is demonstrated.

     **Creator context is a separate candidate**, not inherently circular:
     `session.ts` accepts the first valid context from any admitted connected
     peer and retains it. A shape-validated, first-value-immutable slot could
     match that cooperative trust model. The transport currently publishes
     peers only after bilateral identity admission (`wireRoom` / `maybeReady`),
     whereas Trystero shared-state synchronization is gated on Trystero peer
     readiness, not Nova's acknowledgement (`dist/state.mjs`, `runWhenReady`
     and `applyIncoming`). The shared record's signed author may also
     have departed, while Nova's context message authenticates its currently
     connected forwarder; Nova member IDs are not Trystero user IDs and the
     adapter uses ephemeral identities (`buildConfig`, `identity: "none"`).
     A replacement must preserve the admitted-forwarder boundary, first-value
     behavior on conflicts, and creator persistence across late join and
     reconnect without depending on a departed author's identity mapping.
     These are design/test obligations, not proof that a replacement is
     impossible. A direct signed-record experiment against 0.27's
     `createStateManager` confirmed that a first-value validator keeps its
     first value, rejects a conflicting later value without storing it, and
     permits divergent first values on separate managers. Direct record
     application does not know Nova admission; this isolated test did not
     exercise the network or establish ordering relative to Nova's handshake.
     No creator-context implementation or equivalent end-to-end test has yet
     been completed. Review with concurrent first values, rejected peers,
     failed admission, late join, reconnect and identity mapping before deleting
     existing code. Keep game authority, transient commands and source
     verification unchanged. Reviewed
     against [upstream `docs/state.md` at tag commit
     `8d3f57e`](https://github.com/dmotz/trystero/blob/8d3f57ef42c3d622840eec479784c99deeeb2d05/docs/state.md)
     and the installed `@trystero-p2p/core@0.27.0` `dist/state.mjs`
     (`compareStateRecords`, `commitEntry`, `makeState`) on 2026-11-13. This is
     a reassessment of the earlier feature-fit recommendation, not a completed
     adoption or a claim that no possible authority protocol can use the slot.

     **Real-network proof (2026-11-13).** `e2e-trystero/scale-e2e/context-proof.spec.js`
     runs only through `e2e-trystero/context.playwright.config.js` (not in the
     scale config or any default suite) against the test-only scale relay on
     127.0.0.1:5199. The admitted Nova peer is the real `TrysteroTransport`
     harness page; the unadmitted writer is a raw Trystero page with
     `identity: "none"` that never passes Nova admission. Test 1 publishes a
     deliberately invalid `nova.identity` payload (`{v: 123}`,
     `e2e-trystero/src/context-proof.js`), which the transport rejects with
     `rejected: Identity handshake failed: peer sent an invalid identity.`
     (`trystero-transport.ts`, `rejectIdentity`). That rejection is the mechanism
     that keeps the writer unadmitted; a bare identity-`none` peer with a valid
     identity would be admitted, so this result is specific to that setup.
     Both tests passed in all 3 runs of the tightened spec (run 1, 2, 3; 2/2
     each time, about 4 s per run). Test 1: the raw page's first
     `makeState("proof.creator")` write, `"false-creator"`, stuck on the admitted
     peer's slot (the victim's roster admitted no writer); the valid admitted
     peer's `"real-creator"` write was accepted on its own page, and the victim
     kept `false-creator`, so the two admitted pages diverge (`false-creator` vs
     `real-creator`). The non-replacement check is bounded:
     after the valid page writes a second `proof.marker` key, the victim sees the
     marker and then reads `false-creator`. That shows the valid-to-victim state
     path delivers; it does not directly observe the `real-creator` record being
     received and rejected. The valid page's write is not gated on the attacker's
     record: if the attacker's value reached it first, `set` would reject and the
     test would fail rather than pass. Test 2: a value written by an author that
     then left reached a peer that stayed in the room, and a late joiner, plus
     that joiner's leave-and-rejoin, both read it. **Not tested:** mapping to
     Nova member IDs; concurrent first values over the network beyond the single
     divergence above; survival after every holder has left; true transport drops
     rather than leave/rejoin; the production signaling service; a valid identity
     from a non-Nova peer.
     **Conclusion:** in this configuration (first-value validator
     `prev === null`), an unadmitted peer can set the first value of the slot and
     it sticks on an admitted Nova peer, so the slot bypasses Nova's admission
     boundary. Adoption for creator context is **not safe without an additional
     admission check**; the existing code is kept, and no application code
     changed.
     **Run:** from the worktree root, start the relay in a terminal with
     `(cd e2e-trystero && ../node_modules/.bin/vite --config scale-server.mjs)`
     (check `ss -ltnp` shows 127.0.0.1:5199 free first), then run
     `podman run --rm --network host --userns keep-id -v "$PWD:$PWD:Z" -w "$PWD" mcr.microsoft.com/playwright:v1.62.1-noble npx playwright test -c e2e-trystero/context.playwright.config.js`,
     and stop the server afterwards.

   - **Action progress — already adopted for transfer; don't replace the
     coordinator wholesale.** `trystero-transport.ts` uses action request/receive
     progress and `game-source.ts` already delegates chunking, backpressure,
     correlation, cancellation and timeout to Trystero. Its remaining metadata,
     source size/UTF-8/SHA-256 checks, bounded cache, compatibility, acceptance
     and stale-selection handling are Nova requirements, not action features.
     Migrate listener syntax in §3.1; verify progress and multi-hop promotion in
     §3.6 rather than deleting those protections.
   - **Authority module — don't adopt as game authority.** Upstream
     `authority.ts` implements signed role certificates, root-admin permissions
     and moderation synchronization, not election of a game executor or
     reconciliation of state/action history. ADR-0007 and nova-api require
     heartbeats, deterministic election, buffered/replayed deduplicated actions
     and snapshot restoration for state and simulation; upstream authority and
     its scale tests do not replace those semantics.
   - **`roles()`/ban — don't adopt for host controls.** Root admins are fixed
     by the invite or configured IDs; `authority.ts` rejects granting `admin`
     to non-root users and moderation is root-only. Custom roles can be granted
     but cannot pass root ban/unban powers to a deterministic successor after
     an unexpected departure. Nova's creator-preferred, sorted-member successor
     and cooperative kick must continue; a persistent ban would also change the
     reusable-invite threat model.
   - **`scale()` — adopt as required in §3.6.** Upstream describes experimental
     multi-hop routing and promotion of transfers larger than 16 KiB to direct
     links, not a guarantee of arbitrary-size rooms. Preserve small-room mesh,
     test direct-promotion failure and chunk fallback with frame overhead, and
     complete the 10/25/50/100-player and phone gates before claiming scale.

5. [ ] Implement each remaining _adopt_ as its own commit, deleting replaced Nova code only after porting its behavioural assertions. `makeState` is deferred pending the authority/late-join design above; do not force it into this step. Keep `packages/nova-api` (the API games call) stable unless the review shows a clear simplification; games must not need changes.

   Identity migration decision needed: the installed `@trystero-p2p/core@0.27.0` `dist/identity.mjs` derives a 22-character `userId` from a domain-separated SHA-256 digest of the P-256 public key and validates custom identities against that key. Nova's existing `member-` IDs are independently random (`apps/nova/src/lib/party/identity.ts`), so they cannot simply be imported as Trystero identities. Replacing them changes existing game-facing player IDs; retaining them requires a separate mapping and is not full replacement. Recovery records also contain the old member ID. Ask the owner whether a one-time ID change is acceptable or legacy game-facing IDs must be retained, and specify recovery behavior before implementing. Separately, the current transport's per-user state contains a per-connection ID and admission requires its metadata's peer ID to match (`packages/trystero-transport/src/trystero-transport.ts`); shared identities across tabs need an explicit, tested per-endpoint admission design, not a blind substitution. IndexedDB failures fall back to ephemeral identity in upstream `identity.mjs`; test that and reset races as well. No adoption or migration has been implemented or verified.

6. [ ] Adopt `scale()` (required for unlimited party size; it is marked experimental, so test it hard). Keep normal parties on a direct mesh by setting `maxDirectPeers` so rooms up to ~10 players stay direct, and let larger rooms form the multi-hop network. Then:

   - Confirm game-source transfer still works for multi-hop peers. In installed Trystero 0.27.0 an action is sent inline only when its whole frame (36-byte header + metadata + payload) fits `maxActionFrameBytes` (16,384 bytes); larger actions are sent as offer and chunk frames, and those frames promote the target to a direct link. A peer reachable only via hops may therefore fail the up-to-2 MiB transfer. If it does, fall back to chunks small enough for their whole inline frame to fit (payload ≤ 16,348 bytes with no metadata) for that peer.
   - Load-test large rooms (step 7) before calling this done.

   Investigation (2026-11-13, installed `@trystero-p2p/core@0.27.0`):
   `scale/topology.mjs` selects the full mesh when `room size - 1 <=
   maxDirectPeers`, so 9 retains a mesh for 10 players. `action-wire.mjs`
   selects inline vs bulk using the complete frame size, including its 36-byte
   header and metadata, not just payload size. `scale/data-plane.mjs` asks
   for direct promotion for bulk transfer frames while also queuing routed
   unicast. Whether an interrupted or failed promotion preserves an entire
   game-source response must be tested on a real multi-hop route. Source transfer
   is currently a request/response (`packages/party/src/game-source.ts`), so any
   chunk fallback must coordinate both ends, cancellation, response limits,
   progress and existing hash/UTF-8 validation; it must not simply retry an
   already partially delivered response.

   Partial evidence: the scale proof exercises eight Chromium contexts with
   `maxDirectPeers: 4` and an in-memory WebSocket relay that drops signaling
   publishes after a virtual route forms. A raw 2 MiB request/response was
   byte-exact on a two-hop route without direct promotion; the Nova transport
   and game-source coordinator also received a verified 2 MiB source over a
   virtual route. This is a test-only strategy shim and not a large-room load
   test, proof of every failure mode, or phone validation. Existing coordinator
   cancellation and hash tests remain in place. The production setting is 9
   direct neighbors. After rebase onto the local-signaling client, both focused
   proofs passed; `npm run check` passed, `npm run test:e2e` passed 60/60 and
   `npm run test:e2e:trystero` passed 5/5 in the pinned Playwright container
   against this worktree's servers. §3.6–3.7
   remain open pending the large-room load tests and phone gate.

   **Owner decision / release blocker (verified 2026-11-13):** pinned
   `@trystero-p2p/core@0.27.0` `dist/scale/descriptors.mjs` sets
   `maxTrackedOverlayPeers = 2048`. Its descriptor count includes the local
   descriptor; for a new non-direct peer at that count, admission evicts an
   expired non-direct descriptor or refuses the new one if none is eligible.
   Eviction also disconnects the virtual peer (`scale/manager.mjs`). Direct
   peers bypass that admission check, so this is not a simple 2,048-user room
   limit, but it means complete rosters and routes at arbitrary scale cannot be
   promised, even without `maxUsers`. No boundary load test has been run.
   Owner must decide how to reconcile the unlimited-party requirement with
   upstream's bounded overlay (for example, a vetted upstream change/fork or a
   revised requirement); assess memory, abuse resistance, and other bounded
   caches before choosing. Do not claim unlimited support or close §3.6 until a
   solution is approved, implemented and tested.

   Additional source inspection (2026-11-13, installed 0.27.0 package): the
   public `ScaleConfig` in `dist/types.d.mts` exposes only `maxDirectPeers`;
   `scale/topology.mjs` validates it between 4 and 32, and `scale/index.mjs`
   passes no supported descriptor-cap override to the manager. Increasing
   direct peers therefore does not remove the virtual-descriptor bound.
   `scale/descriptors.mjs` separately applies a 16-peer-per-user admission
   check for non-direct descriptors. `scale/topology.mjs` also caps derived
   route hop limits at 64; routes exceeding that limit cannot be used.
   `scale/seq.mjs` uses a 2,048-origin replay-window eviction target and a
   4,096-message seen set; `signed-record.mjs` skips eviction when every
   tracked origin is pinned, so the former is not an absolute memory cap.
   `scale/data-plane.mjs` bounds its origin-buffer cache to 64 origins, with
   eight early frames and eight verified broadcasts per origin. These limits
   have different purposes and should not be
   misrepresented as one room-size cap; their combined behavior under large
   rooms or churn has not been measured.

   Potential no-fork directions requiring investigation, not approved fixes:
   a later upstream release or upstream-supported configurable limits; or
   partitioning parties across multiple rooms with an application-owned bridge
   and roster synchronization. The latter changes routing, failure, trust and
   resource semantics and does not itself prove arbitrary-scale full rosters.
   Disabling `scale()` instead returns to a direct mesh, not a demonstrated
   arbitrary-scale solution. No supported 0.27 setting removes the bound.

7. [ ] **Large-room load test.** Using headless browser contexts (several machines or CI shards if one machine can't hold them), run parties of 10, 25, 50 and 100 players with a state-mode sample game. Record per size: time until everyone sees everyone, message latency, CPU on the authority player's device (also try a real phone as authority at 25+), and any errors. Known risk to watch: the authority player sends state to everyone, so its upload grows with party size; if it becomes the bottleneck, propose a fix to the owner (e.g. state deltas or fan-out via `scale()` routing) rather than capping parties. Record results in `docs/testing/` and link them from ADR-0003.

   **Owner decision (2026-11-13):** a 100-headless-browser test is not reasonable on any machine. Real-browser runs stay at 50 or fewer, and larger rooms are measured by the in-process simulation (`npm run sim:large-room`). That simulation runs the real session and state engine in one Node process over the in-memory transport, with no browsers, WebRTC or servers. It measures authority traffic, convergence and whole-process CPU. It does not measure phone CPU, real WebRTC cost or `scale()` routing.

   Action payload regression: the peer `action.dispatch` schema accepts an omitted payload, matching the game API and JSON serialization of `undefined`; all other envelope and message validations remain in force. The session contract tests send omitted, explicit `undefined`, `null`, and `{}` from a non-authority via a JSON-round-tripping transport. Protocol version stays 1: existing defined-payload messages remain compatible and new receivers accept old senders; old receivers still reject omitted payloads, so mixed-version parties require updated authorities. Evidence: the protocol regression fails with the original schema; `npm run check` passed, and `npm run test:e2e` (60/60) and `npm run test:e2e:trystero` (5/5) passed in the pinned Playwright container against this worktree's servers. This does not complete the load-test gate. The fan-out work (§3.7) adds `state.resync`, and a required-by-default `historyMode` plus `baseStateHash` on `state.snapshot` (missing `historyMode` reads as `full`). The protocol version also stays 1, since Nova is not launched. New receivers accept old senders' snapshots. Old receivers do not understand `state.resync`. By reading their schema, they would merge an increment's IDs as they do a full snapshot; this is not tested. A member sends `state.resync` only after a detected gap, which an old authority never causes, because it never sends increments. Mixed-version parties therefore keep working without gap recovery; gap recovery needs updated members. `historyComplete` on full snapshots is optional and defaults to true, which is what older senders always sent.
   Known narrow residual, not implemented: a replayed action ID is acknowledged `accepted` even when the original was rejected (`timed_out`, `payload_too_large`, `superseded`, and so on). Snapshots carry IDs but not per-ID status. It needs all of these: a migration; the original rejection ack lost in transit; the dispatcher's retry reaching the new authority within the 10 s deadline; and the ID still inside the 256-ID window. The replayed promise then resolves as applied although the authority never applied the action, and the authority's state is unaffected. Fixing it means carrying a status for each rejected ID in every snapshot window, which changes the wire format and the replay semantics. That is larger than the optional-field changes and would need the party e2e.

   Partial evidence: `docs/testing/large-room-load.md` records local headless
   10/25/50-player state-mode runs and their limitations; real-phone authority
   remains open. Its [in-process simulation section](docs/testing/large-room-load.md#in-process-simulation-no-webrtc) ([samples](docs/testing/large-room-sim-2026-11-13.json)) measured authority traffic per action for 10, 25, 50, 100, 200 players in one process. Before the fan-out work, authority upload was about 121 KB per action at 10 players and 3.2 MB at 200, and 76.0–93.1% of each snapshot was the processed-action history. `action.dispatch` was broadcast to every peer, so a non-authority's upload also grew with N. Implemented on `work/lean-fanout`: per-commit snapshots carry only newly added action IDs (`historyMode: increment`, commit `dd40feb`); a receiver with a revision gap sends one `state.resync` and gets a full snapshot back (`22e8566`); late joins, restores, migration and resync keep full history; `action.dispatch` is targeted at the authority (`4a6f0a8`); a buffered dispatch is sent once and an unacknowledged dispatch is re-sent after `actionTimeoutMs` (`956ac1b`). Re-measured with `LARGE_ROOM_SIM_LABEL=lean npm run sim:large-room` ([after sample](docs/testing/large-room-sim-2026-11-14-lean.json), recorded before the lineage hash, which adds 1.9–4.9% bytes and changes no verdict; before/after tables in the load doc): authority bytes per action are 15.6 KB at 10 players, 45.8 KB at 25, 111.5 KB at 50, 298.9 KB at 100 and 898.4 KB at 200 (down 72–87%); messages per action are unchanged, since every commit still reaches every peer. Projected at 5 actions/s, excluding framing, the authority needs 0.6, 1.8, 4.5, 12.0 and 35.9 Mbit/s. **The authority is still a bottleneck at 50, 100 and 200 players**: 50 sits at the top of the 1–5 Mbit/s phone range before framing, and 100 and 200 are well above it. The remaining cost is the full canonical state (about 3.0 KB per copy at 200 players, 604 KB per action) and the per-player views, both sent on every commit; state deltas are the next proposal. Not measured: real WebRTC or phone uplink, phone CPU, and the real-phone authority run at 25+ players, which is still open. Evidence for the code: `npm run check` passed on the rebased branch before these changes and again on the final state (see the commit report); the party e2e suite (`npm run test:e2e`, Podman Playwright v1.62.1) passed 75/75 on the final code. The owner's decision on the proposal remains open. No cap is implemented.
   State deltas (branch `work/state-deltas`): a commit's broadcast carries a structural diff of the canonical state when it is smaller than the state, and the receiver verifies the result against the sender's hash before adopting it. Measured against the same code without deltas (`LARGE_ROOM_SIM_LABEL=delta`; the before/after table is in the load doc), authority bytes per action fall 5% at 10 players, 14% at 25, 28% at 50, 45% at 100 and 63% at 200 (919 KB to 341 KB). Messages per action are essentially unchanged (19.4 to 19.0 at 10 players, identical from 25 players). Projected at 5 actions/s, excluding framing, the authority needs 0.6, 1.7, 3.4, 6.8 and 13.6 Mbit/s at 10, 25, 50, 100 and 200 players (before deltas: 0.7, 1.9, 4.7, 12.4 and 36.8). **The authority is still a bottleneck at 100 and 200 players** (6.8 and 13.6 Mbit/s against a 1–5 Mbit/s phone uplink, before framing). At 50 it is inside the range but near the top (3.4 Mbit/s). Two causes remain. Each commit still sends a full envelope to every peer (about 700 bytes per copy, now the largest part of a snapshot), and every player still gets a view on every commit (about 680 bytes per message, of which the view payload is about 40). These are envelope costs, not state costs, so deltas do not reduce them.
   The result depends on the sample game. A counter with one score per player changes two leaves per commit, so its state diff is tiny. A game that rewrites a large share of its state per commit (a reshuffled deck, a rebuilt board) gets no benefit and falls back to full states. The numbers say nothing about such games. Compatibility: this is a wire change for mixed-version parties. An older receiver of a delta has no `state` to adopt, so a new authority and an older follower cannot share a party. Protocol version stays 1 because Nova is not launched; owner accepted 2026-11-14, because Nova is not launched.
   start-gate failure; separately an action with omitted optional payload failed
   wire validation. After both fixes landed, a 10-player create-with-game,
   no-payload browser run passed. A 100-player attempt stopped at 78 joined
   due to the host swap safeguard; it is incomplete, not a product failure.
   A two-browser-server 10-context local proof and concrete multi-host worker,
   security and resource-accounting prerequisites are recorded in the same
   findings; no remote-host proof or orchestration exists yet. Do not infer
   unlimited support or close the owner overlay decision in §3.6.

8. [x] Update ADR-0003 (transport abstraction) to describe what Trystero now owns and what Nova still owns.
       Evidence: ADR-0003 "Status update 2026-11-13: Trystero 0.27" (ownership table with code locations, and upgrade checklist), checked against source at `b760379`; docs only, no runtime behaviour change.

## 4. Own signaling relay — P0 (owner approved)

Public Nostr relays are the weakest link (the 2026-10-24 probe found 4 of
9 failing; corporate firewalls block unknown WebSocket hosts). Replace them
with Trystero's officially supported self-hosted relay protocol, served by the
edge Worker. Signaling availability then equals site availability (both on
Cloudflare).

1. [x] Read `@trystero-p2p/ws-relay@0.27.0` (`dist/protocol.mjs`, `dist/server.mjs`, ~240 lines). Protocol: client sends JSON `{type: "subscribe"|"unsubscribe", topic}` or `{type: "publish", topic, payload}`; server sends `{topic, payload}` to every subscriber of the topic. Server limits to copy: topic `^[A-Za-z0-9_-]+$` ≤ 256 chars, ≤ 128 subscriptions per socket, 200 msg/s with burst 400 per socket, 256 KiB max frame. Evidence: inspected the published npm package's `dist/server.mjs` and `dist/protocol.mjs`; contrary to the original plan, `publish()` includes the publisher if subscribed. It also defaults to 10,000 subscriptions across the relay; omit that aggregate cap by coordinator decision to honor the owner's no-party-cap requirement, while retaining per-socket limits.
2. [x] Implement it as a Durable Object class `SignalHub` in `deploy/edge/signal.ts` using the **WebSocket Hibernation API** (`state.acceptWebSocket`, `webSocketMessage`, `webSocketClose`) so eligible idle objects incur no duration charge (connections and messages are still metered). Keep per-socket subscriptions in `ws.serializeAttachment` so they survive hibernation. Store nothing else; signaling messages are transient.

   - Routing: **one Durable Object per room**, never one global instance (a single object can saturate its CPU on a viral day or in a 200-player party). The client connects to `/signal/<roomKey>`, where `roomKey` = hex SHA-256 of the Trystero app id + room id, truncated to 32 chars. Every peer in a room computes the same key, so they meet in the same object, and load spreads across rooms automatically. The Worker maps it with `idFromName(roomKey)`. The room id is secret-derived; only the hash ever reaches the server.
   - Free plan needs SQLite-backed DO classes: add `[[migrations]] tag = "v1" new_sqlite_classes = ["SignalHub"]` and the `[[durable_objects.bindings]]` entry in `deploy/edge/wrangler.toml`.

3. [x] Route `GET /signal/:roomKey` (WebSocket upgrade; validate `roomKey` is 32 hex chars) in `deploy/edge/worker.ts`. The current gate allows only POST; add a WebSocket branch that still enforces the Origin allowlist (browsers send Origin on WebSocket upgrades) and the per-IP rate limit on connection attempts (key `signal:<ip>`), then forwards to the DO. Reject non-upgrade GETs.
       Evidence for 2–3: `deploy/edge/signal.test.ts` tests hibernation attachments, publisher echo, fan-out, limits, and routing gates; `npm run test:edge` passes. `npm run test:edge:integration` passes against local Wrangler/workerd, covering real upgrades, origin rejection, subscriptions, echo, fan-out, room isolation, unsubscribe, and post-idle delivery; idle delivery does not prove eviction occurred. Cloudflare's WebSocket hibernation and class migration documentation is linked in the runbook. No live deployment made.

4. [x] Client: switch `packages/trystero-transport` from the Nostr strategy (`trystero`) to `@trystero-p2p/ws-relay` with `relayConfig.urls = [<edge origin as wss>/signal/<roomKey>]` (computed per `joinRoom` call), derived from `VITE_EDGE_ORIGIN` (no new env var). Delete Nostr-specific code: relay health monitor (`relays.ts`), `VITE_TRYSTERO_RELAYS`, the deploy input, relay diagnostics UI that only makes sense for many public relays (keep a single "signaling connected" indicator).
5. [x] Local dev and tests: `npm run dev` must also start the edge Worker (`wrangler dev`, port 8787) with `VITE_EDGE_ORIGIN=http://localhost:8787`. Playwright `webServer` (both configs) must start it too. Delete the public-relay discovery probe (`e2e-trystero/e2e/discovery-probe.spec.ts`) and update `e2e-trystero` to use the local relay. Unit-test `SignalHub` (subscribe/publish fan-out, limits, hibernation attachment) in `deploy/edge/worker.test.ts` style.
       Evidence after rebase onto nova: `npm run check`; local-relay `npm run test:e2e:trystero` 5/5; `npm run test:e2e` 60/60 in Podman Playwright. SignalHub unit and local workerd integration tests cover relay fan-out and limits. Deferred-digest tests cover cancellation and deadline for join/reconnect/resume; retry tests cover stalled teardown, retained barrier and shared deadline, and reentrant state listeners. Two Chromium pages joined over HTTPS dev signaling with the local certificate.

6. [x] Record the plan decision in `deploy/cloudflare.md`, with the limits that drive it: **stay on Workers Free during development and the workers.dev beta; switch to Workers Paid ($5/month) at the `rocketcrab.com` cutover (§9).** Reason: Free never bills for Workers/Durable Objects but hard-fails at its daily limits (100,000 Durable Object requests/day; incoming WebSocket messages count 20:1) until 00:00 UTC, which would stop all parties; tunnel usage can exhaust Free depending on traffic (the previously stated 1,000 parties/day is not supported without workload assumptions). TURN is billed separately on either plan. Evidence: `deploy/cloudflare.md`, section "Beta plan and pricing evidence" (the plan-decision paragraph, the dated limits checked 2026-11-12 and 2026-11-13, and the account gates). The owner usage-notification action is not repeated here; it is tracked only in §1's owner billing-notification item.
7. [x] Mark `docs/testing/trystero-connectivity-findings.md` relay sections as historical; update ADR-0003.
       Evidence: compared the adapter's `signal-url.ts` and WebSocket relay import with `deploy/edge/signal.ts`; dated ADR amendment and edge runbook describe staged room-scoped signaling without asserting deployment or device verification. `npm run check` passed (2026-11-13).

## 5. Connection fallback via `rtcPolyfill` — P0 (owner approved; prototype first)

**Problem:** some networks block all WebRTC, including TURN on 443 — mainly
corporate networks behind TLS-inspecting proxies (Zscaler, Netskope, Palo
Alto), some school/hotel Wi-Fi. Only a WebSocket to our own domain gets
through. Trystero's maintainer rejected a WebSocket data fallback as out of
scope (dmotz/trystero#173), so we add it _underneath_ Trystero.

**Design:** Trystero accepts `rtcPolyfill` — a replacement
`RTCPeerConnection` constructor (documented for Node). Nova passes a wrapper
class, `FallbackPeerConnection`, that delegates everything to the browser's
real `RTCPeerConnection`. If that pair has not connected within
`FALLBACK_AFTER_MS` (start at 8000, measured from actual pairing rather than
constructor time), or reports `failed`, the wrapper carries the data channel
through a WebSocket tunnel through the edge
Worker and reports `connected` to Trystero. Trystero and every feature on
top of it keep working, per pair; other pairs stay peer-to-peer.

Trystero 0.27 uses only this `RTCPeerConnection` surface (checked
2026-11-12 in `packages/core/src/peer.ts`; re-check on every upgrade):
`setLocalDescription()` (implicit), `setRemoteDescription`, `addIceCandidate`,
`localDescription`, `remoteDescription`, `signalingState`, `connectionState`,
`iceConnectionState`, `onicecandidate`, `onconnectionstatechange`,
`onnegotiationneeded`, `addEventListener`, `createDataChannel`,
`ondatachannel`, `close`, `addTrack`, `removeTrack`, `getSenders`, `ontrack`.
Data channel: `onopen`, `onmessage`, `onerror`, `onclose`, `close`,
`binaryType`, `bufferedAmountLowThreshold` (and so `bufferedAmount` /
`onbufferedamountlow`). Check `createDataChannel` options (ordered/reliable)
— a WebSocket is reliable and ordered, which must match.

1. [x] **Prototype (gate).** In `e2e-trystero/`, build the smallest version: two browser contexts, one with WebRTC forced to fail (e.g. its wrapper passes `iceServers: []` and `iceTransportPolicy: "relay"` to the real connection so no candidates exist). Show that Trystero reports the peer joined and actions flow both ways through the tunnel, and that the normal path is unchanged. **Stop and report to the owner** with what worked, what was awkward, and any Trystero behaviour that fought the wrapper. Do not build steps 2–6 until the owner approves.

   Evidence: `npx playwright test -c e2e-trystero/fallback.playwright.config.js` runs a local signaling/tunnel fixture against pinned Trystero 0.27: both contexts report peer join and exchange actions in both directions, with exactly one tunnel per side when one context has relay-only ICE without servers; the healthy case stays native past the timer. This is a viability experiment, not a production implementation: the fixture's tunnel is plaintext and unauthenticated, the 2.5 s timer is for testing, and it does not establish failure recovery, race safety, backpressure, media, encryption, or lifecycle completeness. The timer starts only after both descriptions exist, avoiding pooled-offer expiry; Trystero observes both connection and ICE states, and peer join requires channel `onopen`. The answerer needs a synthetic `ondatachannel` before that event. Regression evidence: `npm run check` passed and `npm run test:e2e:trystero` passed 6/6 using the pinned Playwright container and this worktree's server. After resolving a port collision, `npm run test:e2e` was rerun against verified servers from this checkout and passed 60/60 in the same container. Owner approval is required before continuing.

   Investigation (2026-11-12; `@trystero-p2p/core@0.27.0` package `dist/strategy.mjs` and `dist/peer.mjs`): initiator connections are created in an offer pool, before a remote description exists, so a constructor-based timeout can expire before a pair ID can be computed. The wrapper must also mask failure on `iceConnectionState` and its event listener, not just `connectionState`. The 15 s `iceTimeout` is an ICE-gathering timeout for non-trickle signaling, not a connection deadline. The browser prototype is now verified as above; production viability remains subject to the owner gate and the limitations recorded there.

2. [x] Tunnel server: Durable Object class `TunnelPair` in `deploy/edge/tunnel.ts`, route `GET /tunnel/:pairId` (WebSocket, same Origin + rate-limit gate, key `tunnel:<ip>`). It accepts **at most two** sockets per `pairId`, forwards binary frames from one to the other, closes both when either closes, and drops a lone socket after 30 s. Hibernation API; nothing stored. Add to the DO migration.
       Evidence (2026-11-14, branch `work/tunnel-server`; commits `feat(edge): add tunnel pair durable object`, `feat(edge): signal tunnel pairing and require binary frames`, `fix(edge): bound tunnel relay and stop stale close echoes`, and the docs commit `docs(edge): record tunnel relay limits and storage cost`): `TunnelPair` in `tunnel.ts`, route in `worker.ts`, `TUNNEL_PAIR` binding and `v2` migration in `wrangler.toml` (`v1` unchanged). Pairing: the second socket causes the server to send the text frame `paired` once to each side. Pairing state and the pairing generation live in socket attachments, so a woken object reads them from `getWebSockets()`. The token bucket is kept in memory and copied to the attachment at least once per second per socket, after every 512 KiB spent, and on close. A woken socket is over-credited by at most 512 KiB (about one second of rate); the budget is approximate across hibernation within that bound (see the runbook). Binary only: a client text frame closes both sockets with 1003. Relay budget: per-socket token bucket, 512 KiB/s sustained with a 4 MiB burst; an empty bucket closes both sockets with 1008 `rate limit`. Stale echoes: a server-started close is marked in the attachment, so the peer's echo is ignored; partners match only within one pairing generation. A newcomer to a lone paired socket whose partner is mid-close gets a retryable 409 `pair_closing`. Malformed or NaN bucket fields are an empty bucket (fail closed). Partner gone after pairing closes the sender with 1011; before pairing, frames are dropped. Frames over 262,208 bytes (256 KiB plus the 29-byte client framing, 64-byte allowance) close both with 1009. A failed `setAlarm` closes the accepted socket and rethrows; a failed `deleteAlarm` is ignored. 1010 is not server-sendable. Unit tests (`tunnel.test.ts`; 66 edge tests in total with `worker.test.ts`): `paired` once per side, including through a woken object; binary forwarded both ways; text closes both with 1003; a lone client's text closes it; frames dropped before pairing; partner gone closes with 1011; the frame limit boundary (262,173 accepted, 262,209 closed with 1009); the relay budget (under budget flows, a burst closes both with 1008, refill at the sustained rate, a persisted bucket survives a wake; at most two attachment writes for 100 frames within 1 s; a 4 MiB burst within 1 s causes 8 writes; a woken bucket is never more than 512 KiB over-credited; a close persists the bucket; malformed buckets fail closed); close and error propagation with closing sockets answered; close codes 1006 and 1015 map to 1000; a lone socket's error clears the alarm; 1010 not sendable; the 409 third socket; the 30 s alarm closing a lone socket with 4408; no alarm once paired; setAlarm failure; deleteAlarm failure still pairs; stale echoes from alarm-closed and joined-while-closing sockets do not touch later joiners; matching is by generation. `worker.test.ts` covers the route: 64-hex pair ID, GET only, upgrade required, Origin (including a missing one), `tunnel:<ip>` rate key, 429, and 503 without the binding. `npm run check` passed (exit 0); `npm run edge:check` passed with `TUNNEL_PAIR` bound to `TunnelPair`. Integration: `signal.integration.mjs` runs four tunnel scenarios against local workerd on port 18790 (`SIGNAL_TEST_ORIGIN=http://127.0.0.1:18790`): pairing (`paired` once per side, binary both ways, a refused third socket, close propagation, a text frame closing both with 1003); a frame at the limit forwarded, one byte over closing both with 1009; a 6 MiB burst closing both with 1008 `rate limit`. All four passed; the port was released. Observed on local workerd only: the partner's TCP close event can lag after its close frame arrives, so the test checks the received frame via `ws` internals. Not verified: the 30 s alarm on real workerd (unit test with a fake alarm only), behaviour under concurrent connects on real Cloudflare, alarm billing (see the runbook), and any deployed Worker. Not deployed. The client wrapper (§5 step 5) does not exist yet; it must wait for `paired` and send only binary frames within the relay budget.
3. [x] `pairId`: both sides compute it without extra signaling as SHA-256 of the two DTLS fingerprints (`a=fingerprint` lines from `localDescription` and `remoteDescription`), sorted, plus the room id.

   Evidence (helpers only; the wrapper §5.5 and wiring §5.6 are pending): `computeTunnelPairing` and `extractDtlsFingerprints` in `packages/trystero-transport/src/tunnel-crypto.ts`, unit-tested in `tunnel-crypto.test.ts` (Chrome- and Firefox-style SDP, symmetry, opposite roles, room and fingerprint sensitivity, a known-answer check of the canonical string). **Canonical format** (the wrapper and any server-side check must reproduce it exactly): each `a=fingerprint:` value, session- and media-level, is normalised to `<algorithm lowercased> <hex uppercased>` and deduplicated; each side's values are sorted and joined with `,`; the two side strings are sorted and joined with `|`; then `|` + roomId. pairId is the lowercase hex SHA-256 (64 characters) of that UTF-8 string. **localRole** is the index (0 or 1) of the local side string in that sorted pair, so the two peers always get opposite roles. Identical side strings throw, and so does an SDP without a fingerprint. The §5.1 prototype's pairing (first fingerprint line only, no room id, no normalisation) is superseded and must not be copied. The first version of this helper gave both peers one shared key with no direction, which allowed reflection and replay; the directional-key fix is `fix(transport): use directional tunnel keys with sequence AAD`. `npm run check` passed (2026-11-14).

4. [x] Encryption: frames are AES-GCM encrypted with a key derived (HKDF) from the party secret Nova already derives in `packages/party/src/secrets.ts`, so the relay never sees plaintext. Frame = 12-byte IV + ciphertext. Pass the key into the wrapper via a closure when the transport creates the class.

   Evidence (helpers only; the wrapper §5.5 and wiring §5.6 are pending): `deriveTunnelKeys`, the `TunnelCipher` class (`seal` and `open`), `encodeTunnelMessage`, `decodeTunnelMessage` and `TUNNEL_FRAME_OVERHEAD_BYTES` (29) in `tunnel-crypto.ts`. **Canonical parameters:** HKDF-SHA-256, IKM = UTF-8 bytes of the `SessionSecret` string (the same string `secrets.ts` hashes; validated with the protocol's `sessionSecretSchema`), salt = UTF-8 bytes of the pairId, output AES-GCM-256, non-extractable. Info is `"rocketcrab tunnel v1 dir 0"` or `"rocketcrab tunnel v1 dir 1"`. A peer's send key is `dir <localRole>` and its receive key is `dir <1 - localRole>`, so each direction has its own key. Send keys carry only `encrypt` and receive keys only `decrypt`. `secrets.ts` uses SHA-256 with its own labels, so these info strings keep the tunnel keys domain-separated. **Frame** = 12-byte random IV ‖ AES-GCM ciphertext with its 16-byte tag. The wire carries no counter. **Sequence:** each direction counts frames from 0 as a 64-bit big-endian value, used as the AES-GCM additional data (AAD). `open` expects the next receive number. **Ordering:** each direction runs its operations strictly one at a time, in call order. A call starts only after the previous one in its direction has settled, and claims its number when it starts. So promises resolve in call order, and `ws.send(await cipher.seal(x))` transmits frames in sequence even when a large frame finishes encrypting after a small one. **Failure is fatal by design:** a replayed, reflected, reordered, skipped or corrupted frame, or a short frame, throws `TunnelFrameError` with code `auth-failed`. A failed seal also poisons the cipher, because its number is spent and the peer would see a gap. After that, every later `open` and `seal` on the cipher is refused (queued operations included), and the caller must close the tunnel. The tunnel is ordered and reliable, so a lost or reordered frame is treated as a broken or hostile tunnel, not recovered. **Message** = 1-byte tag (0 UTF-8 string, 1 binary) applied before encryption. A binary payload of N bytes is exactly N + 29 bytes on the wire. `decodeTunnelMessage` throws `malformed-message` for empty input, an unknown tag or invalid UTF-8. Tests (44 in `tunnel-crypto.test.ts`) cover role symmetry, identical-side rejection, in-order delivery both ways, reflection, replay, reordering, skipping, failure poisoning, a flipped byte at every frame position, wrong key or secret, short frames, IV uniqueness, concurrent seals and opens, call-order resolution for seals and opens (four of these fail against the unserialised cipher), a failed seal poisoning the cipher, empty and 256 KiB binary payloads, emoji strings, and a view with non-zero `byteOffset`. `npm run check` passed (2026-11-14). Not verified: no e2e run, since nothing calls these helpers yet.

5. [x] `FallbackPeerConnection` in `packages/trystero-transport/src/fallback-peer-connection.ts`:

   - Pass-through mode: delegate every member listed above; forward events. Unknown members fall through to the real connection.
   - Switch rule: at `FALLBACK_AFTER_MS` without `connected`, or on `failed`, open the tunnel. While switching, **do not** expose `failed`/`disconnected` to Trystero (report `connecting`). Report `connected` only after the server's text frame `paired` arrives (both sockets present). Send only binary frames: a text frame closes the pair with 1003 `binary only`.
   - Data channel facade returned from `createDataChannel` and emitted via `ondatachannel` (the answering side must get a synthetic `ondatachannel` in tunnel mode). Implement `send` for string and `ArrayBuffer`/views, `readyState`, `binaryType`, `bufferedAmount` (bytes queued on the WebSocket), `bufferedAmountLowThreshold` + `onbufferedamountlow`, and the open/message/close/error events.
   - Once on the tunnel, stay on it for that connection's lifetime (no mid-session switching).
   - Media (`addTrack`) is not tunnelled. Nova's media features must show "audio/video isn't available with this player" for tunnelled pairs.

   Evidence (2026-11-14, branch `work/fallback-pc`): `createFallbackPeerConnectionClass` and `isTunnelledConnection` in `fallback-peer-connection.ts`; `fallback-peer-connection.test.ts` has 28 unit tests (node environment; fake native connection, channel, WebSocket pair and injected clock, real `tunnel-crypto` for the tunnel). `npx vitest run src/fallback-peer-connection.test.ts` passed 28/28; `npm run check` passed (format, lint, typecheck, all unit tests, build). No e2e, since nothing is wired. Covered: pass-through; no timer before both descriptions; timeout and native `failed` switches, with `failed`/`disconnected` masked on `connectionState`, `iceConnectionState`, `on*` handlers and `addEventListener`; synthetic answerer `ondatachannel` with an open facade; backpressure (`bufferedAmount`, `bufferedamountlow` fires once after a drop); 200 mixed-size sends in order; close propagation both ways; terminal failure once per side on a tampered frame, a text frame other than `paired`, and a socket drop; idempotent close; no switch back; the 262144-byte frame limit; open retry for the transient 409 (5 attempts, 250 ms doubling, never scheduled past switch + `FALLBACK_AFTER_MS`) and the deadline cut-off. Mutation check: removing the per-connection serial send chain makes the 200-message ordering test fail. Interpretation: "the overall fallback deadline" is the switch time plus `fallbackAfterMs`.

   Review round 2 (independent review of `50c3a7a`; fixed in `fix(transport): harden fallback wrapper teardown and pacing`). Close codes: a failed tunnel closes with 4011, not 1011, because browsers reject codes other than 1000 and 3000–4999 (`close()` throws `InvalidAccessError`, which skipped teardown and left a zombie channel). `socket.close` errors are caught, and teardown runs in a `finally`: native close, channel close, `connectionState` `closed` and `onTerminalFailure`. The fake socket throws for invalid codes. Health: "healthy" means the native data channel has opened, and nothing else. The deadline timer is cleared only on that open. At the deadline each side switches iff its channel is not open. This bounds the close-before-open hold by the deadline, and it also covers a connected peer connection whose channel never opens (for example SCTP blackholed). Trade-off: a pair whose channel takes more than 8 s to open tunnels. Pacing: a client token bucket in the send chain, 448 KiB/s with a 3.5 MiB burst (`TUNNEL_PACE_BYTES_PER_SECOND`, `TUNNEL_PACE_BURST_BYTES`), below the edge's 512 KiB/s and 4 MiB; it charges wire bytes (payload + 29). Waiting bytes count toward `bufferedAmount`, so Trystero's backpressure waits. Other: a send before pairing throws `InvalidStateError`, like a native channel while connecting; `bufferedAmount` is 0 and pending bytes are reset after close; `binaryType` "blob" delivers a `Blob`; every event carries `type` and `target`; `connectionState` reads `closed` after a terminal failure even when no channel exists yet (an answerer before pairing). Tests (28): close during pairing (socket closed with 1000, no failure); close during key derivation (no socket); connected peer connection with no open channel switches; a pre-open channel close is held until the deadline, then switches; the asymmetric lone socket tears down both sides; an answerer failing before pairing reports `closed`; a send before pairing throws; `bufferedAmount` reset after close; Blob delivery; a tampered frame and a text frame each give one failure per side and close both native connections; three back-to-back 2 MiB transfers never drive the simulated server bucket negative (the minimum is checked) and take the expected time at 448 KiB/s (±2%). Mutation checks: reverting the close code to 1011 fails the tampered-frame and text-frame tests; disabling the pace check fails the pacing test (the simulated server bucket reaches about −2.07 MB).

   Review round 3 (`fix(transport): keep fallback alive until channel opens and flush on close`): `everConnected` is set only when the data channel opens. Until then a native `disconnected` is masked on both properties and listeners, so Trystero's 5 s grace cannot close the peer before the 8 s deadline. A caller's close (Trystero leaving) flushes frames already queued on a ready tunnel for at most `GRACEFUL_FLUSH_MS` (2 s) and then closes with 1000. The flush stays paced, so the pacer's burst goes out at once and anything beyond it moves at 448 KiB/s. An unpaced flush of up to 3.5 MiB could empty the server's bucket (4 MiB, refilled at 512 KiB/s) when the pacer had just spent its burst, and the pair would close with 1008. Terminal failures drop queued frames at once. A partner's clean 1000 close waits for the frames it already sent to finish decrypting; any other close is immediate. Pacing and open retries have separate pause slots. The default clock is `performance.now()` (falls back to `Date.now()`). Tests: masking until open; a 2 MiB graceful flush delivers everything and closes with 1000; a 6 MiB backlog closes after about 2 s, delivers about 60–80 frames and never drives the simulated server bucket negative; `bufferedamountlow` fires during a paced transfer. Mutation checks: no flush fails the flush test; an unbounded flush window fails the 6 MiB test; setting `everConnected` on native `connected` again fails the masking test. Known limit (review 2026-11-14): Trystero's `destroyAfterFlush` waits only 150 ms, but the wrapper keeps draining for up to 2 s afterwards; a leave or kick notice queued behind more than about 2 s of paced backlog is dropped. Accepted trade-off.

   Not verified, for step 6 (real browsers and the real edge):
   - Real Chrome and Firefox behaviour of pooled offers, and the event order of native `connectionstatechange`, `iceconnectionstatechange` and channel `close`.
   - A native channel that closes after opening is forwarded at once. An ICE failure that also closes the channel can tear the peer down before the fallback runs. Pre-open channel closes are suppressed; a remote close before open is noticed only after the fallback timer and the 30 s lone-socket timeout.
   - Asymmetric switch: sides switch on their own deadline, so one side can open its channel just as the other switches. The tunnelled side then waits for a partner that stays native; the 30 s lone timeout closes it, and that close reaches the native partner through the channel. Recovery is bounded at about 30 s plus one retry, and step 6 must measure it. A mutual switch signal was considered and not built.
   - Mid-session `disconnected` after the pair has connected is passed through to Trystero, which closes the peer after its 5 s grace. There is no mid-session switch, by design (§5 rule: switch only on the deadline or a native `failed`).
   - Native `failed` after the channel opened switches the pair, even though the partner may still be native. The same asymmetric recovery applies.
   - The native connection is left open at the switch, on purpose: closing it would send DTLS close and tear down a native partner.
   - The edge enforces a 512 KiB/s per-socket budget with a 4 MiB burst and closes the pair with 1008 when it is empty. The wrapper paces itself to 448 KiB/s with a 3.5 MiB burst, so it never empties that bucket, but the pacing is only unit-tested against a simulated bucket. Step 6 must check it against the deployed edge, and check that the 1008 close path is not reached. The edge's 409 `pair_closing` is retried (see above). Frame cap: the wrapper keeps 262144 bytes, below the edge's 262208.
   - Close codes 4011 (failure) and 1000 (local close) are both sendable and forwarded by the edge; a partner's close with 4xxx reaches Trystero as `socket-closed` with that code. Confirm on the deployed edge.
   - Not covered by unit tests: a real Trystero `peer.mjs` driving the wrapper. Step 6's Playwright run is the first such test.
   - One data channel per connection; a second `createDataChannel` throws. Non-default `createDataChannel` options (unordered, unreliable) throw.
   - Nova has no "audio/video isn't available" UI yet (§7); `isTunnelledConnection` is exposed for it.
   - Not wired into the transport (§5.6), no Trystero upgrade check, no ADR/runbook update (§5.7).

6. [x] Wire it in `packages/trystero-transport` (`rtcPolyfill`). Unit tests with a fake `RTCPeerConnection` and fake WebSocket covering: normal pass-through, timeout switch, `failed` switch, answerer synthetic channel, backpressure events, close propagation, encryption round trip. Playwright e2e (in CI): forced-failure player joins a 3-player party and plays a sample game; this test is what catches breakage on Trystero upgrades.
       Evidence (2026-11-14, branch `work/fallback-wire`; commits `feat(transport): wire fallback peer connection` on top of `633e0d1`, and `test(e2e): exercise forced tunnel fallback`). **Was `[ ]` until the party-level proof passed (see the paragraph below, which supersedes this one):** at that point the party-level proof did not pass. Wiring: `rtcPolyfill` is passed to `joinRoom` once per join (no secret or no WebRTC means no polyfill). The party secret reaches the transport through the factory identity. `isPeerTunnelled(connectionId)`, and the `onTunnel` / `onTunnelFailure` options. `forceRelayOnlyNoServers` is set only from `window.__NOVA_TEST_FORCE_TUNNEL__` in dev or `MODE=test` builds (`forceTunnelForTests` in `apps/nova/.../transport-factory.ts`; production folds it to false). Unit tests: `npm run check` passed on the rebased tree (exit 0). Transport e2e, run on the rebased tree with the pinned Playwright container (`npm run test:e2e:trystero`): the new `tunnel-fallback.spec.ts` ran 3× (12 of 12, all four tests on each repeat); the full transport suite passed 10 of 10. Before the teardown assertion was fixed, the closing test failed 3 of 3: the host saw no terminal failure, so the test now asserts that the tunnel socket closes. Passing before the wrapper's last fixes (`pre-633e0d1`): full suite 10 of 10. Party e2e (root `npm run test:e2e`, dev stack): `arena-s4` passes on chromium, firefox and webkit (confirms the helper move). The new `party-tunnel.spec.ts` is `test.fixme`: "Start game" never enables, in 3 of 3 chromium runs and in a control with three native players, so the tunnel is not the cause. Runtime frames do emit `game.registration` and the ready call on each page, so the gap is in the session's `game.ready` propagation between players. Not isolated. Firefox and webkit cannot grant clipboard permissions, so that spec also needs a different invite path. Measurements: the switch fires at `FALLBACK_AFTER_MS` (8 s) by design, but join-to-`paired` latency was NOT measured. The asymmetric case (one side tunnelled, the other native) was NOT run. Not verified: a blocked corporate network, Firefox/WebKit for the transport suite (chromium only), phones, and TURN behaviour under the tunnel.
       Party-level findings (2026-11-14, branch `work/fallback-wire`). **Bug, fixed on this branch: the lobby never re-rendered when a peer became ready.** A `game.ready` changed the session's roster but emitted no event, so the engine's snapshot kept the old readiness and "Start game" stayed disabled for every real multi-player party (it affected all of them, not only tunnelled ones). Fix: a host-side `ready` session event (`packages/nova-api/src/client.ts`), emitted once per change in `session.ts` `case "game.ready"`, re-renders the lobby in `engine.ts` `handleSessionEvent`, and is ignored by the game client and `toApiEvent`. Tests: `session.test.ts` (one event per member, none for a duplicate) and `engine.test.ts` (the snapshot updates with no other event; mutation-checked). **Bug, fixed on this branch (`fix(nova-api): let the elected authority honour a start request`): the start deadlocked whenever the host was not the lowest member id, which affected real parties about half the time.** The authority-elect is the lowest eligible id (`state-engine.ts` `lowestEligibleMemberId`), and the elect accepted `game.start` only from its own authority. A non-elect host's start request was ignored, so the host stayed in "starting". Fix: the elect honours any admitted member's `game.start` request by calling `start()` (cooperative trust; the UI gate stays host-only). The authoritative `game.start` then reaches everyone through the existing path. Election and the protocol are unchanged. Tests: `start-request.test.ts` (higher-id start in state and simulation mode, lowest-id start, duplicate request, late joiner), mutation-checked (four of five fail without the fix). **Bug, fixed (`fix(nova): replay start to a game frame rebooted after the game began`): a follower's game frame rebooted after the game began never received `start`, so every action it sent was refused as `not_started`.** The engine replayed `start` only when `session.isStarted()`, which is set only by the starter, so followers were skipped. The fix uses the engine's `gameStarted`, as the phase logic already does. The control run (no tunnel) reproduced it and passes with the fix. Test: a follower's rebooted frame receives `start` (mutation-checked). **Separate, not a bug in the fix: an answer can still be refused as `stale_revision`.** The authority commits a newer revision (the start) while a player's view is one revision behind; the sample quiz does not retry a stale answer. The party spec re-clicks answers until the quizmaster sees both (a real player does the same); changing this in the game or protocol is a design decision and was not made here. Review follow-up: a start request is honoured only from the party host, once every member has the game source (`acceptStartRequest`; a rejected request is reported as a session error). Each frame instance receives `start` exactly once, after its first state event for state-mode games. Start-request retry: the host re-sends its start request every 2 s until the authority starts the game, and gives up after 30 s with a notice (`START_RETRY_*` in `engine.ts`). The arena is multi-member (the S4 arena runs four simulated players in one page, `e2e/arena-s4.spec.ts`), so its nova-api session keeps the accept-all default for start requests; the party engine supplies the host gate. **Party proof: runs, with an open bug.** `party-tunnel.spec.ts` runs in the default suite on chromium with one retry, and passes 3x run alone on chromium and once each on firefox and webkit. The default suite was green twice in the foreground (76 passed, 2 skipped by design). **OPEN BUG (not flakiness): under three-browser parallel load (firefox reproduces it; webkit once), a party stalls before the game starts.** Traced with temporary logging (reverted). Two signatures, both failing at the join steps: (1) **identity admission**: one pair's handshake times out. The joiner sent its identity acknowledgement and never received the host's, although the host logged that it sent it (`acknowledgement.send` resolved), and both sides' native connections stayed healthy (connected, data channel open, not tunnelled). The admission timer (`handshakeTimeoutMs`, 30 s) then rejects the peer, and a rejected peer is never retried, so the lobby stays at 2 of 3. The lost acknowledgement is inside the transport path; the cause is not yet identified. (2) **source verification**: the elected authority keeps one member's game source at `waiting`, so it rejects every start request; the host's retry then gives up after 30 s with the lobby notice. Known: the local rate limiter is not enforced (70 `/signal` upgrades returned 101) and the edge log shows no 429s, so the limiter is not the cause. The chromium-only guard and `retries: 1` can hide this stall, so a green default suite is not evidence it is fixed. A fix would be a retry of the identity acknowledgement, but it would mask the loss rather than explain it, so it was not applied. **Results after the retransmit fixes (2026-11-14, branch `work/fallback-wire`).** The identity-ack and source re-request fixes are committed and unit-tested, but they did **not** fix the stall. The full party suite, run twice in the foreground: run 1 had 79 passed and 2 failed (firefox control lobby at 2 of 3; webkit tunnel proof no play view); run 2 had 76 passed and 5 failed (both 3-player tests on firefox, webkit and chromium). The two 3-player tests are therefore `test.fixme` again, with the open bug in their comments, so the default suite stays green. §5.6 stays unchecked. The retransmit proves only that a lost ack is re-sent; it cannot help when the pair never reaches Trystero's `active` state, which is the next suspect (`handshake.mjs:153, 183`, the `hsdata`/`hsready` exchange, not yet traced). **Root cause of signature 1 (found, time-boxed).** Two facts in Trystero 0.27 (`node_modules/@trystero-p2p/ws-relay/node_modules/@trystero-p2p/core/dist`): (a) a message for an action whose listener is not registered yet is **buffered** (`action-wire.mjs:469-486`, up to 32 per peer and type, 10 s), so an unregistered listener alone does not lose it. But the peer gate runs **before** that buffer: `action-wire.mjs:1015` returns without buffering when `canReceiveFromPeer` is false, which is `room.mjs:379` (`isPeerActive || hs.canReceiveFromPeer`) and `handshake.mjs:229` (`phase === "active"` unless the action is `receiveWhilePending`). Only Trystero's internal actions set `receiveWhilePending` (`room.mjs:586-595`); the public `makeAction` takes only `kind` and `roles` (`actions.mjs:205, 215`), so our `nova.identity.ack` cannot opt in. So an action from a peer whose handshake is not yet active at the receiver is **dropped silently**. (b) Our code sends the ack as soon as the peer's identity is readable, from `accept` (`trystero-transport.ts:910`) which runs in `room.onPeerJoin` and `state.onChange` (`trystero-transport.ts:951-980`), with no check that the receiver is active, and it sent exactly once (`sendAck` marks the ack sent on resolve, but nothing re-sent it). Conclusion: a clear ordering-and-robustness bug in our code, not a Trystero bug: we relied on one delivery of an action that Trystero is allowed to drop. Fix (this branch): identity acks are re-sent every 2 s until admitted (`IDENTITY_ACK_RETRANSMIT_MS`, `armAckRetransmit`), the admission deadline restarts once while the peer is present (`ADMISSION_RESTARTS`), and the stop conditions are admission, leave and teardown. Tests in `trystero-transport.test.ts` (fake clock): a dropped first ack is recovered; duplicate acks admit once; retransmission stops on leave; the existing timeout test now expects the restarted deadline. Signature 1 is therefore addressed by retransmission; the signature-2 source-verification retransmit is a separate change. **Handshake trace of the stalled pair (2026-11-14, `[HS]` logs in Trystero's `handshake.mjs`/`room.mjs`, temporary, reverted; the same run's Nova log).** Lobby of three (firefox, one repeat of the control). Pair: the joiner (Trystero `whCY`) and the third player (`rC0S`). Initiator: the third player (`role … initiator=true`); the joiner was the responder. Trystero's handshake completed on both sides: each side logged `activate-local` and `onActivate` for the other, and no `fail-handshake`, `kickPeer`, `rejectPeer` or `onFailure` was logged for the pair. Trystero did not retry the pair: there is one `addPeer` for it on each side. Nova layer: the joiner admitted the third player (`onPeerJoin`, `ack-send-ok`, then `ack-in` from the third player every 2 s) and stopped sending its own ack, because it considered itself admitted; its one ack to the third player was lost. The third player kept re-sending its ack every 2 s (each `ack-send-ok`) and never received the joiner's ack, so it never admitted the joiner: the third player's member list lacked the joiner. The 30 s admission deadline was not logged in this build, so the outcome (timeout, restart, or rejection) is not confirmed from the trace. **Root cause:** a side that has admitted its peer stopped answering that peer's retransmitted ack. A peer re-sends its ack until it is admitted, so an admitted side must answer each re-send; once it stops, a single lost ack leaves the other side waiting forever. This is our bug, not Trystero's (Trystero's drop of an action from a non-active peer is what made the first ack lossy). **Fix (committed, `b245f47`):** an ack from an already-admitted peer is answered with our ack again; test: an admitted peer's re-sent ack is answered once more (mutation-checked). Full party suite after this fix, both 3-player tests un-fixme'd, run in the foreground: run 1 had 79 passed and 2 failed (both firefox 3-player tests at `party-play-view`, membership already complete); run 2 had 81 passed and 0 failed (the 3-player tests passed on chromium, firefox and webkit). The result is not stable, so the two tests are `test.fixme` again and §5.6 stays unchecked; the play-view failure is a separate step to trace (start, or the authority's source view). Answers refused as `stale_revision` are expected API behaviour (ADR-0007 rejects an action based on an old revision): `docs/api/nova-api.md` and `docs/api/nova-api-ai-reference.md` already tell games to retry from the newest view, and the sample quiz (`examples/games/nova-quiz.html`, copied by authors) now retries once on `stale_revision`. The test re-clicks answers until the quizmaster sees both. Measured join-to-`paired` for the forced player (two tunnels, each from its join to the `paired` frame), across the chromium runs: 8374-8481 ms per tunnel (the 8 s fallback timer is included); firefox 5741-5745 ms and webkit 8656-8657 ms, one run each. That includes the 8 s fallback timer.

**Party proof passes (2026-11-14, branch `work/fallback-wire`; item 6 is `[x]`).** The stall was signature (2), the source view, and it is fixed. Diagnosis from the per-page dump (`b918b24`: `window.__NOVA_PARTY_DEBUG__`, a dev and test build hook that reads engine state, and each page's console saved to `PLAY_TRACE_DIR`). At the stall the third player, the lowest id and so the elected authority, showed the joiner's source as `waiting`, while the host and the joiner showed it `complete`. The third's console logged the rejected start (`Ignored a start request from … only the host can start the game, once every player has the source`). Its only byte fetch was from the host. The joiner's console logged `Player … received the game` for the third, which is the third accepting the joiner's announcement without fetching its bytes. The third already held the same verified source, so the announcement took the cache path, or folded into the transfer already pending, and the coordinator emitted no receive event for the announcer. The engine marks a member verified only from a receive event, so the joiner stayed `waiting` and the start gate never opened; the host's retry then gave up after 30 s. Note: the dump's `authority` field is a lobby fallback (the first ready member), not an election, so it is not evidence on its own. **Fix (`21d6664`):** the coordinator emits `holds` for each announcer it accepts (only while the verified source is current), and the engine marks that member verified. Tests: two coordinator tests, one for the cache path and one for the folded path, both failing without the event. **Evidence:** before the fix, the firefox probe of the two 3-player specs (`--repeat-each=8`, stop at the first failure) failed at repeats 1, 2 and 5. After it, the same probe passed 16 of 16 in 58.6 s. The full default suite (`npm run test:e2e`, all three browsers, both 3-player specs un-fixme'd), run twice in the foreground, passed 81 of 81 in each run with no retries, and all six 3-player tests passed each time. **Not verified:** the repeat-2 failure of the tunnel spec before the fix was not captured under a unique label, so it is assumed to share this signature; the post-fix passes are the evidence for that. The rebuilt-frame and start-retry paths are unchanged.

**Final runs on the final code (2026-11-15, branch `work/fallback-wire`).** Two review fixes landed after the runs above: an admitted peer never answers an ack reply (`d31aa24`, which ends a ping-pong between two admitted peers), and source verification is keyed by the source hash (`0a97aff`, so an edited game under the same id must verify again before the start gate opens). The full default suite (`npm run test:e2e`, dev servers on 5173, 5174 and 8787, all three browsers), run twice in the foreground: run 1 passed 81 of 81 and run 2 passed 81 of 81. The six 3-player tests passed in each run, with no retries and no flaky results. `npm run check` exits 0 on the same tree.

7. [ ] Document the design and its upgrade check in ADR-0003 and `deploy/cloudflare.md`.

## 6. Per-player game bandwidth cap — P1

Nova limits game message counts and sizes (`packages/protocol/src/limits.ts`)
but raw mode allows 120 msg/s × 1 MiB per player — effectively unlimited
bandwidth. Over TURN or the tunnel that costs money. Add a byte budget that
game code cannot bypass.

1. [x] Add `gameBytesPerSecond = 256 * 1024` and a burst of 1 MiB to `limits.ts`. Enforce with a byte token bucket at the single point where game-originated messages (state actions, simulation inputs, raw messages) leave Nova for the transport. Find it by following `rawRatePerSecond` / `actionRatePerSecond` usage in `packages/nova-api/src/session.ts` and `client.ts`. Nova's own traffic (game-source transfer, control messages) is exempt.
2. [x] Over budget: reject the send with the same structured error the existing rate limits use, and surface it in the editor diagnostics (`apps/nova/src/lib/editor/diagnostics.ts`) so game authors see it while testing. Warn at 80 % like the other limits.
3. [x] Tests in `packages/nova-api` (contract suite) and a doc line in `docs/api/nova-api.md` + `docs/api/nova-api-ai-reference.md` (the AI prompt must tell models about the budget).

Evidence: shared-budget contract and editor diagnostic tests; `npm run check` passed; `npm run test:e2e` passed 60/60 in Playwright 1.62.1 container against this worktree's dev servers.

## 7. Fast, plain failure messages — P1

1. [ ] Define stages with timeouts and one message each, driven by typed Trystero errors (§3.2) and the fallback wrapper (§5):

   - Signaling not connected within 5 s → "Can't reach Rocketcrab's servers. Check your internet connection." (retry automatically).
   - A peer seen but not connected → per-player "Connecting to {name}…".
   - Pair on tunnel → no alarm; optional small "relayed" badge in the diagnostics panel.
   - Pair failed even after fallback → "Couldn't connect to {name}." with a retry button.
   - `room-full`, `decrypt-failed` (wrong/old invite) → their own screens.

   Investigation (2026-11-13, installed `@trystero-p2p/core@0.27.0` `dist/signal-handler.mjs`, `strategy.mjs`, `peer.mjs`, `room.mjs`, `types.d.mts`, and Nova `packages/trystero-transport/src/trystero-transport.ts`): signaling internally discovers a peer ID, but the room's public API exposes no discovery callback. Data-channel `onopen` triggers strategy connection; only then does the room start its verified identity handshake and activate the peer. Nova publishes its display name in `nova.identity` user state and accepts it only for a peer in `room.getPeers()`, then waits for identity acknowledgements before `peer:joined`. Thus neither a first-time peer's name nor a public per-peer connecting event is available before the connection. Previously admitted names may be cached for reconnect, but can be stale and do not establish identity of a new attempt. Scale virtual peers and direct upgrades require separate treatment.

   `peer-connect-failed` includes a peer ID, but is reported for particular SDP-exchanged close/error/expiry paths, not as a guarantee that fallback was attempted or exhausted; an offer can fail before the reporting conditions. `handshake-failed` is later and distinct; `onPeerLeave` concerns an activated peer. The §5 wrapper is only a prototype: native RTC failure must be hidden while fallback is pending, and a bounded tunnel failure/deadline must be reported exactly once as terminal, correlated with the correct peer attempt. Constructor time/close is insufficient because initiator offers are pooled; wrapper-to-peer correlation, cancellation, retry semantics, stale callbacks and signaling loss remain design and test preconditions. A wrapper deadline alone is not proof that the peer has left.

   Decision needed: consider an honest generic connection indication based on locally known join/retry intent or an actually observed error, using a previously verified name only when safely correlated; or introduce a separate authenticated, encrypted pre-connection presence/discovery protocol to satisfy named first-connection UI. Generic per-peer connecting itself still needs an observable and correlatable discovery event; it cannot be inferred from the current public callback API. The latter needs peer-ID/attempt binding, replay and stale-presence handling, authorization, disclosure and metadata/privacy review (the signaling service must not learn names), plus explicit retry and cleanup. Do not expose names via plaintext signaling or claim a terminal fallback failure from a generic room error. Tests must cover unknown names, simultaneous attempts, pooled offers, timeout/recovery races, retry, and virtual peers.

2. [x] Remove the old TURN-status-specific notices in `engine.ts` that the new stages replace. Keep `PartyDiagnostics.tsx` as the detailed view.

   Evidence (2026-11-14, branch `work/stage-messages`): removed from `engine.ts`: (a) the lobby warning "TURN credentials unavailable (…) — the party will connect without a TURN relay." after a failed mint. Blocked networks now fall back to the tunnel, and the TURN state stays in diagnostics (`diagnostics.turn`). (b) The `peer_connection_failed` lobby notice and its three TURN-status variants ("…may be blocking peer-to-peer connections…", "TURN relay credentials were unavailable…", "TURN is not configured…"). Trystero's peer-connect-failed is not a reliable terminal signal for a pair (§7 investigation), and a real failure after fallback now reaches the peer-link alert. The raw code stays in diagnostics `joinErrors`. Kept: the other room-error notices and the qualified `room-full`/`decrypt-failed` notices. `PartyDiagnostics` shows the TURN state and a per-peer `relayed` badge.

3. [x] Unit tests per stage with fake timers; one e2e for the signaling-down message (block `/signal` in Playwright).

   Evidence for stages 2–4 (2026-11-14, branch `work/stage-messages`): the transport factory forwards `onTunnel`/`onTunnelFailure` to `TrysteroTransport` (`transport-factory.test.ts`). The engine keeps one generic `peerLink` state: "connecting" on a switch, "failed" on a terminal tunnel failure, which stays until retry or leave. Retry is the existing `engine.reconnect()`. Trystero's hooks name no peer, so neither alert names a player. Engine tests in `engine.test.ts` ("peer-link alert", 6 tests, fake clock) cover: three simultaneous switches produce one state change; a quiet switch expires after `handshakeTimeoutMs`, and a later switch restarts that window; a failure persists through repeated failures and later switches, and retry clears it at once; a failure survives a native join; callbacks after leave are ignored; a healthy native pair shows nothing. A mutation that removes the `peer:joined` clear makes the coalescing test fail. `PeerLinkAlert.test.tsx` covers the alert copy, retry wiring, and the `relayed` badge on tunnelled peers only. `npm run check` passed (exit 0; all unit suites, build included). Stage 5 (media): Nova has no per-peer audio/video UI. `nova.media` (`packages/nova-api/src/media.ts`) is a probe that fails with `media_unsupported`, so there is nothing to hide; recorded here and skipped. **E2E: run and passing (2026-11-14, rebased on `work/fallback-wire`; see the results paragraph below).** Those runs are recorded in the results paragraph below.

   Review round (2026-11-14): (1) **Retry is outside play only.** `PeerLinkAlert` takes the party phase; during `playing` a failure shows the same copy with no button. Trystero re-attempts a failed pair without help (installed `@trystero-p2p/core` 0.27, `node_modules/@trystero-p2p/ws-relay/node_modules/@trystero-p2p/core/dist/signal-handler.mjs`): `resetOfferState` (L163) returns the pair to idle after a close, error or offer expiry, so the next announcement starts a fresh attempt (`handleAnnouncement` L387, announcement dispatch L697–712). Announcements repeat every 5333 ms (`strategy.mjs` L12). Dial attempts are throttled by `dialBackoffs` (2 s doubling, 60 s cap, cleared on connect at L294 and L544). Verified by code reading only. The live re-attempt is not yet observed. (2) **Silent drops had no notice.** `memberJoined`/`memberLeft` only re-rendered. Added: `{name} left the party.` (info) on a leave with a real name. The name now rides on the party event, because a departed peer no longer resolves it. Kicked members are skipped (the kick already says "was removed"). A rejoin removes the notice. Tests: "a silent native drop gets one info notice…" and "a member removed by a kick…". (3) **Joining gap.** A tunnel failure during `joining` used to be ignored, so a join that admitted another peer would show no alert for the failed one. It is now recorded, and setup failure clears it. The join still ends at the existing join-timeout screen (`waitForPeerConnect` → `peer_unreachable`), covered by "a tunnel failure during joining still ends in the join-timeout screen, with no stale alert". The 5ae test "keeps a joiner on loading then errors when no peer can be reached" covers the timeout alone. (4) Every switch emits, so diagnostics' relayed flags refresh even while an alert or failure shows. (5) **Trade-off:** any admitted peer clears both "Connecting to a player…" and "Couldn't connect to a player.". The hooks do not identify the pair, and playing has no retry, so a failure must clear when a peer is admitted. A different player's admission can therefore hide a still-pending failure; the member list still shows who is missing. (6) The party e2e records whether the connecting alert was seen (`connecting-alert-seen` annotation) but does not assert it until a run measures the window. E2E run: see the results paragraph below.

   **Results (2026-11-14, `work/stage-messages` rebased on `work/fallback-wire`; ports 5173/5174/8787 held exclusively; servers stopped afterwards):**
   - `npm run check` passed (exit 0) after the rebase.
   - New §7 test `e2e/party-tunnel.spec.ts` "a tunnelled pair joins with no alarm and shows a relayed badge": 3 of 3 passed on Chromium (`--repeat-each=3`). The first attempt failed because the host page needed a "Start a party" click first, which the test now does. Firefox and WebKit were not run for this test alone; the full suite below ran it on all three.
   - `e2e/signaling-outage.spec.ts`: 3 of 3 passed (Chromium, Firefox, WebKit).
   - Full party suite: 77 passed, 4 skipped, exit 0 (81 tests, all three browsers). The 3-player tunnel proof (`party-tunnel.spec.ts`) ran on Chromium and passed, with join-to-paired at 8466 ms and 8477 ms. It is skipped on Firefox and WebKit by design. The other two skips were not identified from the line reporter.
   - The connecting alert was observed only as an annotation (`connecting-alert-seen`, not asserted), and its value was not recorded in the line-reporter output, so the window remains unmeasured.
   - Final full party suite (2026-11-14, `work/stage-messages` at `a8ca57e` rebased on `work/fallback-wire` 36351e7; one foreground run, podman Playwright 1.62.1; dev stack on 5173/5174/8787, stopped afterwards): **84 passed, 0 failed, 0 skipped** (84 tests across chromium, firefox and webkit). This supersedes the 77 passed / 4 skipped run above: the 3-player tunnel proof now runs on all three browsers after 36351e7, so its earlier skips are gone. Log: `$HOME/.cache/tmp/party-full-final.log`.
   - Not verified: Trystero's re-attempt of a failed pair (code reading only); a live failure → retry path and its alert in any browser; blocked corporate networks; phones.
   - Checked: **§7.2** (superseded notices removed and documented; full suite passes) and **§7.3** (fake-timer tests per stage; signaling-down e2e passes). **§7.1 stays open**: the failure-alert path has no e2e, the re-attempt is unverified in a live run, and the connecting window is unmeasured. The definitive `room-full`/`decrypt-failed` screens were already recorded as open earlier in this section.

   Partial typed-error evidence: `engine.test.ts` covers attempt-scoped `room-full`/`decrypt-failed` reports, retry, stale callbacks and established-party notices. `e2e/connection-errors.spec.ts` injects typed transport reports while exercising real signaling, peer timeout, retry and cancel in Chromium, Firefox and WebKit; an uncontacted invite remains a generic timeout. Trystero's installed 0.27 `signal-handler.mjs` reports `decrypt-failed` per peer for either an incorrect password or corrupted signal; `room.mjs` also reports `room-full` per peer. Neither proves why the local join ultimately failed. The timeout screen therefore preserves its generic failure and qualifies these as potentially unrelated peer reports, not definitive diagnoses. Established-party notices also describe only the affected peer connection or message, without claiming that the whole party is full or the local invite is wrong; unit tests cover both codes, per-party notice deduplication across leave/rejoin and stale callbacks in a healthy lobby, and the browser test injects both reports in a live lobby (75/75 party e2e passed in the Playwright Podman image). One prior run exposed a runtime diagnostics test race (waiting for one error before asserting two); the test now waits for both expected errors and console output without weakening assertions. This does not verify a real room-full or wrong-secret report (there is no configured cap and a different secret can select a different room). Definitive screens, per-player and fallback stages remain open. Follow-up: `npm run check` passed and `npm run test:e2e` passed 72/72 in the Playwright 1.62.1 Podman image.

   Partial signaling-down evidence: `signaling-outage.test.ts` and party engine tests cover the five-second delay, recovery, setup retry and cancellation. Follow-up regressions cover shared teardown barriers across failed joins, leave, reconnect and suspend, fail-closed handling of rejected pending and established-party teardown, prompt cancellation while waiting for teardown, late reconnect failure and pausing peer discovery during signaling outages. `e2e/signaling-outage.spec.ts` blocks `/signal` past the initial join deadline and checks automatic recovery. `npm run check` passed; `npm run test:e2e` passed 63/63 in the Playwright 1.62.1 Podman image against this worktree's servers. The host run passed Chromium and Firefox but WebKit could not launch due to missing system libraries. Other stages, fallback-dependent behavior, and removal of their superseded notices remain open.

## 8. Connection logging — P1 (keep it small)

1. [x] Implement locally: edge route `POST /log` (same gate; rate-limit key `log:<ip>`) writes one Workers Analytics Engine point per validated event to `CONNECTION_EVENTS`. Evidence: `deploy/edge/log.test.ts`; schema and official Free/Paid limits rechecked 2026-11-13 in `deploy/cloudflare.md`. No deploy or live verification; owner must confirm actual account plan and access before deployment.
2. [x] One event per peer connection attempt, sent by the client with `navigator.sendBeacon`:

   - `outcome`: `direct` | `turn` | `tunnel` | `failed` | `unknown` (`direct`/`turn` from the real connection's selected candidate pair via `getStats()`; `tunnel` and `failed` from the wrapper), - `error_code` (Trystero `RoomError.code`, or empty), - `ms_to_connect`, - `signaling_ok` (bool), - `browser` (family only, e.g. `safari-ios`, `chrome-android`), - `network` (`navigator.connection.effectiveType`/`type` where available, else `unknown`), - `app_version`. **Never** names, invite/room ids, peer ids or IPs. The Worker must not write the IP into the data point.

   Client implementation (2026-11-14, `work/conn-events`): `FallbackPeerConnection` takes `onOutcome` and reports at most one outcome per wrapper instance. `TrysteroTransport` forwards it as `onOutcome`. `apps/nova/src/lib/party/transport-factory.ts` sends each one through `reportConnection` with `error_code` empty and `signaling_ok: true` (both descriptions existed, so signaling worked). Decisions, made for this item: the start is when both descriptions exist (the fallback timer's start); an unclaimed pooled offer never starts, so it reports nothing. The first success or failure claims the outcome synchronously, so a native open followed by a native failure and tunnel pairing reports only the native outcome. A native open whose selected pair is null or throws reports `unknown`. `failed` reports `ms_to_connect` 0, because the edge requires an integer and the stats script medians only success outcomes. A switched attempt (on the tunnel) closed before any outcome reports `failed` (0 ms). A native-mode close before the deadline reports nothing, because Trystero destroys superseded answered offers that way (`transitionOutboundToAnswered`). Nothing is reported during a deliberate local teardown: `isTearingDown` is true from the start of `leave()`, `suspend()` and `reconnect()`'s teardown until the next room join begins (see the review-fix paragraph below). `ms_to_connect` is rounded and capped at the edge's 3600000 ms. Counting: one instance is one physical attempt. A scale virtual peer has no RTCPeerConnection, so it reports nothing, and its later upgrade to direct is the first instance, reported once. A reconnect creates a new instance, so it counts as a new attempt. Evidence: `npm run check` passed. Unit tests: `packages/trystero-transport/src/fallback-peer-connection.test.ts`, describe `FallbackPeerConnection connection outcome` (11 cases: native direct with a fractional clock, turn, stats rejects → unknown, stats with no selected pair → unknown, tunnel once per side, failed after OPEN_ATTEMPTS, pooled offer never claimed, closed while connecting, closed during tunnel pairing, native open racing a native failure with stats pending, failure after a tunnel pairs). `trystero-transport.tunnel.test.ts` (forwards `onOutcome`; none without a party secret). `apps/nova/src/lib/party/transport-factory.test.ts` (the beacon carries exactly the schema fields and no member, room, name, password, secret or user-agent text; no-op without `VITE_EDGE_ORIGIN`; a throwing beacon never reaches the transport). Real browser (2026-11-14, Playwright 1.62.1 in Podman against this worktree's servers on 5200 and 18787): `e2e-trystero/e2e/tunnel-fallback.spec.ts` passed 4/4 three times in a row (`npm run test:e2e:trystero -- e2e/tunnel-fallback.spec.ts`). Its forced pair asserts exactly one `tunnel` outcome per side, and its healthy pair asserts exactly one `direct` or `unknown` per side. The full transport suite (`npm run test:e2e:trystero`) passed 10/10 once. The trystero harness has no `/log` beacon path, so these checks cover the transport event, not the beacon POST. The servers were stopped and ports 5200 and 18787 released afterwards. Still open (owner/deploy, not client work): live ingestion, meaning a real browser's `/log` POST writing to `CONNECTION_EVENTS` on a deployed edge, has not been verified. The box is checked because the client side is complete and the real-browser outcome assertions pass. Original gap list, now resolved: wire one event per peer attempt, determine direct/TURN from the selected candidate pair, obtain tunnel/failed from the wrapper, and define the timing boundary, reconnect/upgrade counting and missing-duration policy.

   Review fixes (2026-11-14, `work/conn-events`, commit `fix(transport): report failed for unclaimed attempts and bound stats wait`): (1) an attempt that has switched to the tunnel and is closed before any outcome reports `failed`, which covers Trystero's ~23 s TTL destroying a stuck peer before the tunnel's 30 s timeout (a native-mode close before the 8 s deadline reports nothing, since Trystero destroys superseded answered offers that way); the exception is a close during a deliberate local teardown (`isTearingDown`, set at the start of `leave()`, `suspend()` and `reconnect()`'s teardown, cleared when the next room join begins: `join()`, `resume()`, or `reconnect()`'s new room), which reports nothing. (2) The native selected-pair read is bounded by `STATS_TIMEOUT_MS` (2 s): a read that has not settled, or a close while it is pending, reports `unknown`, and no timer outlives the read or the connection. The outcome is still claimed synchronously at open. (3) The e2e outcome checks wait `OUTCOME_SETTLE_MS` (1.5 s) after both lists match and assert still exactly one entry per side. Evidence: `packages/trystero-transport/src/fallback-peer-connection.test.ts` describe `FallbackPeerConnection connection outcome` now has 16 cases (the count of 11 above is superseded). New cases: native-mode close before the deadline, not tearing down → nothing; closed during pairing, not leaving → `failed`, while leaving → nothing; Trystero-TTL-style destroy after the switch before pairing → `failed`; a stats read that never resolves → `unknown` at exactly 2000 ms with no timer left; close during a pending read → `unknown` with no timer left. The stats-pending native-failure case now expects `unknown` (its read outlasts the timeout), and a late answer adds nothing. `trystero-transport.tunnel.test.ts` checks the gate is false during a join and true from `leave()` until the next join. Owner decision (2026-11-14, after the first review round): `suspend()` and `reconnect()` are deliberate local teardowns too, so the same gate covers them; `trystero-transport.test.ts` describe `local teardown gates connection outcomes` checks that the gate is set during the suspend and reconnect teardowns and cleared when the next room join starts (a removed suspend flag fails it). `npm run check` passed (exit 0; a single run first failed in `packages/nova-api`'s randomized authority-election property test with a settle timeout, passed on two reruns and on the full rerun; that package does not import the transport). Real browser (2026-11-14, Playwright 1.62.1 in Podman, this worktree's servers on 5200 and 18787): `tunnel-fallback.spec.ts` passed 4/4 on three consecutive runs; the full `npm run test:e2e:trystero` passed 10/10 once. Servers were stopped and ports 5200 and 18787 verified released. Not verified: a real browser's `/log` beacon POST (the trystero harness has no beacon path), and any mobile or cross-browser run. Accepted (owner, P3): an uncancellable pending `getStats` can retain its peer connection until the browser resolves it. The close settles the outcome as `unknown` and clears our timer, but cannot cancel the browser's read.
   Still open: none of the review questions remain open for this item.
   Investigation (2026-11-13, installed `@trystero-p2p/core@0.27.0` `dist/types.d.mts`, `room.mjs`, `peer.mjs`, `strategy.mjs`, `offer-manager.mjs`): after direct peer activation, `room.getPeers()[peerId].connection` is the actual `rtcPolyfill` instance (native without a polyfill); `onPeerJoin` supplies the peer ID, not the connection. Scale virtual peers have `direct: false` and `connection: null`, so a virtual join is not a physical connection attempt and must not produce a direct/TURN event. A virtual-to-direct upgrade activates without another peer-join event; join-only instrumentation misses it. `peer.mjs` signals connection on data-channel open, while room activation also waits for the handshake. A native `getStats()` report can be resolved through each transport's `selectedCandidatePairId` to the candidate-pair and its local/remote candidate IDs; classify TURN if either selected candidate is `relay`, direct only if both candidate types are known non-relay. Missing/ambiguous selections, unavailable candidate records or rejected `getStats()` are unknown, not direct or failed. Never emit reports, candidate addresses, IDs, or SDP.

   Follow-up/blockers: composing instrumentation inside the planned fallback `rtcPolyfill` can observe the real native connection before failure and retain a monotonic start/end per physical attempt; it must explicitly expose native stats and terminal tunnel/failure state rather than fabricate RTC stats, and deduplicate races, cleanup, retries and reconnections. However, Trystero constructs initiator offers before a remote peer is known and closes/reclaims unused offers, so construction time is not a per-pair start and closing an unclaimed offer is not a failed attempt. Establish the start boundary and correlate a claimed connection with a peer, including pre-activation failures and direct upgrades, without relying on undocumented internals; room errors alone do not identify the corresponding connection instance. Owner chose an explicit `unknown` outcome for unknown/unavailable stats on 2026-11-13, now implemented in edge validation, the client reporter and the stats script. Timing boundary, reconnect/upgrade counting and missing-duration policy are defined in the client implementation paragraph above (2026-11-14). Validate selected-pair availability across browsers, wrapper races and virtual peers with real-browser tests. The isolated `selected-candidate-outcome.ts` helper and unit tests classify only resolvable native selected pairs; they do not wire reporting or resolve those lifecycle and schema decisions. `reportConnection` has no production caller yet, so the `unknown` meaning documented in `deploy/cloudflare.md` (connection opened, path undeterminable) must be enforced when the transport is wired. Evidence: `npm run check` passed; `npm run test:e2e` passed 60/60 in the Playwright 1.62.1 Podman container against this worktree's servers. Unknown-outcome checks (2026-11-13, `work/log-unknown`): `npm run check` passed (includes edge tests 25/25 and script tests); `node --test scripts/connection-stats.test.mjs` 5/5; `npm run edge:check` dry-run exit 0.

3. [x] `scripts/connection-stats.mjs`: queries the Analytics Engine SQL API (needs an API token with Account Analytics Read — owner creates it, passed via env var) and prints outcome percentages and median connect time for a date range. Document it in `deploy/cloudflare.md`.
       Evidence: `node --test scripts/connection-stats.test.mjs`; schema assumes `connection_events` with outcome in `blob1` and successful connect milliseconds in `double1`. The owner must supply a token; live verification is blocked on §8.1–8.2 ingestion. End-to-end logging remains incomplete.

## 9. Real-device verification, then cutover — P0

Needs physical devices; WebKit automation does not replace it. Record
results, with the §8 stats, in `docs/testing/trystero-connectivity-findings.md`
and `docs/testing/mobile-safari-checklist.md`.

- [ ] Desktop Wi-Fi ↔ iPhone on cellular; two phones on different
      carriers. Connect and stay up for more than a minute.
- [ ] A laptop on a corporate or school network (or a VPN that blocks UDP)
      joins a party; confirm whether it lands on TURN or the tunnel.
- [ ] Four mixed devices see and ping each other; a phone leaves and rejoins.
- [ ] 2 MiB game-source transfer arrives intact over cellular and over the
      tunnel.
- [ ] iPhone Safari backgrounded 1–3 minutes recovers.
- [ ] A party longer than an hour survives on one 24 h TURN credential.
- [ ] Airplane mode and blocked `/signal` show the §7 messages and recover.
- [ ] Full create → prompt → paste → test → save → party → play flow on
      Mobile Safari; master prompt tried on two AI chat services.
- [ ] State, simulation and raw sample games; authority migration; private
      link and QR joins.
- [ ] A friend beta without coaching.
- [ ] **Owner approval**, then switch the account to **Workers Paid** (§4.6), then cutover: attach `rocketcrab.com` as a custom
      domain to `rocketcrab-nova` (this replaces the legacy site), add it
      to the edge `ORIGIN_ALLOWLIST`, rebuild the runtime with the new
      `VITE_MAIN_ORIGIN`, redeploy all three. Keep the runtime on workers.dev.

## 10. Code review of the core — P2 (after §3–§5 settle)

The Trystero feature adoption (§3.4) will rewrite parts of these; review what
remains. Goals: real bugs first (reconnect, authority migration, listener and
timer cleanup, races on leave/rejoin), then simplification without behaviour
change. One commit per area, `npm run check` + `npm run test:e2e` each time.

- [ ] `apps/nova/src/lib/party/engine.ts` (~2,700 lines; ~390 comment lines,
      many describing history instead of current behaviour — trim those).
- [x] `packages/trystero-transport/src/trystero-transport.ts`. Evidence: four
      failing-first unit tests were proven and fixed, one commit each: `join()`
      refused a re-join from `disconnected`, which left the engine's reconnect
      retry unable to recover after a failed `reconnect()`; an invalid
      `handleRequest` channel stayed registered and failed every later join; a
      send that threw (unknown target or unserializable payload) still consumed
      a delivery sequence number; and a targeted send to a peer that left
      mid-send surfaced a raw Trystero error instead of `not_connected`. A
      clean leave stays re-joinable, as the in-memory twin defines it, and a
      test pins that. The trim commit removed a write-only peer-join map, an
      unused parameter and a one-line wrapper, and corrected a stale appId in a
      doc comment (233 adapter tests pass, `npm run check` exit 0). Not done:
      e2e was not run (the coordinator runs it); the
      rejoin-with-same-peer-id path is unreachable with Trystero 0.27.0 here,
      since each room gets a fresh endpoint identity, so it was not changed;
      the per-sender `deliverySeq` scope differs from the in-memory twin's
      per-pair scope and is recorded as suspected, not changed, because it
      touches wire semantics; `fallback-peer-connection.ts` was checked for
      timer and listener cleanup only and needed no change.
- [x] `apps/runtime/src/nova-bridge.ts` and `runtime-instance.ts`. Proven by
      failing-first tests and fixed: bootstrap accepted from any window on the
      main origin (now requires the embedding page as `event.source`); raw
      channel and pending-action maps keyed by `constructor`/`__proto__`; a
      repeated `start` re-ran `onStart` in the frame; one viewer's async
      `selectView` rejection failed the whole state request, and a failing
      view was dropped silently (now reported per member); undeliverable
      messages were dropped silently (now a non-fatal `remote_load` error,
      because no non-fatal author-error category exists and a fatal one fails
      the arena run; a dedicated category would be a protocol change, left to
      the owner). Trimmed history comments and unexported
      dead symbols (no behaviour change). Not verified: e2e (run by the
      coordinator), stale frame reports after removal (suspected, not proven).
      Open, outside this area: `apps/nova/src/lib/party/engine.ts` does not
      re-send `start` to a frame rebooted by `reloadMyGame`/`reloadAll` or a
      runtime restart (`frameStartDelivered` resets only in `maybeBootFrame`);
      a throwaway probe test got 0 new start events after reload.

  Early targeted review: bootstrap player identity was JSON-encoded but not
  escaped for an HTML script element; a display name containing `</script>`
  could break the bootstrap and inject markup into that player's runtime game
  frame. Escape `<` without changing the decoded identity. This is not a
  demonstrated host-origin escape or cross-player injection. Runtime source
  inspection found no other JSON embedded in a script element; game HTML is
  intentionally executable. A regression checks the script boundary and the
  recovered value; `npm run check` passed, and `npm run test:e2e` passed
  63/63 in the pinned Playwright container against this worktree's servers.
  This partial review does not close the area or §10.

- [x] `packages/nova-api/src/session.ts`, `state-engine.ts`,
      `simulation-engine.ts`. Proven and fixed (tests failed before, pass
      after): `session.leave()` left the simulation clock and snapshot cadence
      running, so a left session kept emitting ticks and queued snapshots in
      its outbox (`37d464b`); the dispatch buffer kept deadline-expired
      entries during a long election (`f071a41`) and had no hard bound, so it
      now holds at most 256 and refuses overflow with `rate_limited`
      (`9c9aa66`). Trimmed history comments and
      an unused export (`7a4a74b`). Checked and found correct: in-flight
      dispatches settle once (client map), delta base-hash mismatch repairs
      rather than applies, history is bounded. Gapped increments adopt the
      state and resync (the existing test documents this design), so not
      changed. Suspected, not proven: `leave()` does not unsubscribe transport
      listeners; a leave-then-attach would double-wire them. In-flight
      dispatches are dropped on leave, so their game promises time out with
      `timed_out` rather than an ended error. `runQueue` shifts the queue
      after an await, which can drop the wrong entry if the queue was cleared
      and refilled mid-action (the retry timer heals it). Per-revision state
      observations have no hash cap. `npm run check` passed; `npm run test:e2e`
      was not run here (the coordinator runs it).
- [ ] UI components and e2e tests: lighter pass.
- [ ] Audit user-facing docs (README, API reference, game-author guide,
      deployment, mobile, security limitations) against shipped behaviour.

## Decisions log

| Date       | Decision                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------- |
| 2026-11-12 | OpenTofu removed; `wrangler.toml` + `wrangler deploy` is the only path.                        |
| 2026-11-12 | One `VITE_EDGE_ORIGIN` for relay + TURN (+ signal, tunnel, log).                               |
| 2026-11-12 | Static hosting moves from GitHub Pages to Cloudflare assets Workers.                           |
| 2026-11-12 | Runtime stays on workers.dev permanently (separate site = isolation).                          |
| 2026-11-12 | Beta on workers.dev; saved games not migrated at cutover (accepted).                           |
| 2026-11-12 | Migrate to Trystero 0.27; adopt every feature that fits Nova.                                  |
| 2026-11-12 | Own signaling relay replaces public Nostr relays (no Nostr backup).                            |
| 2026-11-12 | Fallback for WebRTC-blocking networks via `rtcPolyfill` tunnel, per pair; prototype first.     |
| 2026-11-12 | Unlimited party size: adopt `scale()`, no `maxUsers`, load-test large rooms.                   |
| 2026-11-12 | Signaling: one Durable Object per room (`/signal/<roomKey>`); tunnel: one per pair.            |
| 2026-11-12 | Workers Free through beta; Workers Paid ($5/month) from the `rocketcrab.com` cutover.          |
| 2026-11-12 | No host-relayed star topology; Trystero mesh (+ tunnel) instead.                               |
| 2026-11-12 | Do not propose the fallback upstream (maintainer rejected in #173).                            |
| 2026-11-13 | §7: generic "Connecting to a player…" for unknown peers; no pre-connect discovery protocol.    |
| 2026-11-13 | §8: log an explicit `unknown` outcome when the connection path can't be determined.            |
| 2026-11-13 | §3.7: no 100-browser runs; browsers ≤ 50 players, larger sizes via in-process simulation.      |
| 2026-11-13 | §5: owner approved building the production fallback (steps 2–7) after the prototype.           |
| 2026-11-13 | §3.7: approved fixing authority fan-out (lean snapshots, targeted dispatch, then deltas).      |
| 2026-11-13 | §3.5: keep Nova member IDs; Trystero persistent identity not adopted (multi-tab/storage risk). |
| 2026-11-13 | Owner pre-approved remaining gates; prefer simple, robust choices.                             |

## Legacy branches (no action needed for Nova)

`security/node22-brotli`/`prod` (legacy live-service security fixes),
`deps`, `backup/deps-*`, `vitest-browser*`, `allbadcards`, `liesgame`, and old
Dependabot branches are pre-Nova lines of work, not unfinished Nova features.
