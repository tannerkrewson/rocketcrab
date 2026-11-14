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
- [ ] With owner approval: `npm run edge:deploy`, then both
      `secret put` commands from `deploy/cloudflare.md`, then the runbook's
      smoke test (403 without Origin; `iceServers` with one; Classic
      `spyfall-new` returns a code; the 61st request in a minute returns 429).
- [ ] **Owner:** add the Realtime usage-based billing notification and
      confirm a test email arrives. Record the threshold in the runbook.
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
2. [ ] Replace error-string matching with typed codes. Today `handleJoinErrorNotice` in `apps/nova/src/lib/party/engine.ts` and `apps/nova/src/lib/party/connection-errors.ts` parse messages; switch to `RoomError.code` (`peer-connect-failed`, `relay-failed`, `room-full`, `decrypt-failed`, …).

   Partial evidence: the unused pre-0.27 string parser was removed from the private transport package's public exports after a repository-wide consumer search; `errors.test.ts` verifies all nine typed codes, both decrypt stages, preserved fields and misleading wording. Adapter-owned timeout and admission tests remain. `npm run check` passed; `npm run test:e2e` passed 75/75 and `npm run test:e2e:trystero` passed 5/5 in the Playwright container against this worktree's servers. This does not establish real capped-room behavior or peer attribution. Party connection messages and deduplicated notices map all nine 0.27 `RoomError.code` values, with legacy category fallback; `connection-errors.test.ts` and `engine.test.ts` cover every code including room-full and decrypt-failed. No `maxUsers` is configured in the transport. `npm run check` passed (after a transient unrelated `nova-api` stale_revision test failure); `npm run test:e2e` passed 60/60 in the Playwright 1.62.1 Podman image against this worktree's servers. This is not end-to-end verification of a real room-full or wrong-invite flow; leave this step open.

3. [ ] Party size: **no cap** (owner wants arbitrarily large parties, 2026-11-12). Do not set `maxUsers`. Still handle `room-full` gracefully in case a cap is added later.

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

   - Confirm game-source transfer still works for multi-hop peers: Trystero promotes messages over 16 KiB to a direct link, so a peer reachable only via hops may fail the up-to-2 MiB transfer. If it does, fall back to chunks ≤ 16 KiB for that peer.
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

   Action payload regression: the peer `action.dispatch` schema accepts an omitted payload, matching the game API and JSON serialization of `undefined`; all other envelope and message validations remain in force. The session contract tests send omitted, explicit `undefined`, `null`, and `{}` from a non-authority via a JSON-round-tripping transport. Protocol version stays 1: existing defined-payload messages remain compatible and new receivers accept old senders; old receivers still reject omitted payloads, so mixed-version parties require updated authorities. Evidence: the protocol regression fails with the original schema; `npm run check` passed, and `npm run test:e2e` (60/60) and `npm run test:e2e:trystero` (5/5) passed in the pinned Playwright container against this worktree's servers. This does not complete the load-test gate.

   Partial evidence: `docs/testing/large-room-load.md` records local headless
   10/25/50-player state-mode runs and their limitations; real-phone authority
   remains open. Its
   [in-process simulation section](docs/testing/large-room-load.md#in-process-simulation-no-webrtc)
   ([samples](docs/testing/large-room-sim-2026-11-13.json)) measured authority
   traffic per action for 10, 25, 50, 100 and 200 players in one process.
   Authority upload grows with party size, slightly faster than linearly
   (about 121 KB per action at 10 players and 3.2 MB at 200). Most of each
   snapshot is the processed-action history, not state. At 5 actions/s that is
   about 4.8 Mbit/s at 10 players and 129 Mbit/s at 200, against a typical phone
   uplink of 1–5 Mbit/s. `action.dispatch` is also broadcast to every peer, so a
   non-authority's upload grows with N too. The doc sets out a proposal for the
   owner (history-free snapshots, state deltas, targeted dispatch, `scale()`
   fan-out). No fix or cap is implemented. Still open for this item: real-phone
   authority CPU and upload at 25+ players (no phone run exists), and the
   owner's decision on the proposal. The ADR-0003 link to the experiment is in
   place. Creating with a game revealed a source-verification
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

6. [ ] Record the plan decision in `deploy/cloudflare.md` with the limits that drive it (official docs checked 2026-11-12; research recorded there; notification remains outstanding): **stay on Workers Free during development and the workers.dev beta; switch to Workers Paid ($5/month) at the `rocketcrab.com` cutover (§9).** Reason: Free never bills for Workers/Durable Objects but hard-fails at its daily limits (100,000 Durable Object requests/day; incoming WebSocket messages count 20:1) until 00:00 UTC, which would stop all parties; tunnel usage can exhaust Free depending on traffic (the previously stated 1,000 parties/day is not supported without workload assumptions). TURN is billed separately on either plan. Investigate an available Cloudflare usage notification for beta limits; owner must configure and verify it. See the dated evidence and account-specific gates in `deploy/cloudflare.md`.
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

2. [ ] Tunnel server: Durable Object class `TunnelPair` in `deploy/edge/tunnel.ts`, route `GET /tunnel/:pairId` (WebSocket, same Origin + rate-limit gate, key `tunnel:<ip>`). It accepts **at most two** sockets per `pairId`, forwards binary frames from one to the other, closes both when either closes, and drops a lone socket after 30 s. Hibernation API; nothing stored. Add to the DO migration.
3. [ ] `pairId`: both sides compute it without extra signaling as SHA-256 of the two DTLS fingerprints (`a=fingerprint` lines from `localDescription` and `remoteDescription`), sorted, plus the room id.
4. [ ] Encryption: frames are AES-GCM encrypted with a key derived (HKDF) from the party secret Nova already derives in `packages/party/src/secrets.ts`, so the relay never sees plaintext. Frame = 12-byte IV + ciphertext. Pass the key into the wrapper via a closure when the transport creates the class.
5. [ ] `FallbackPeerConnection` in `packages/trystero-transport/src/fallback-peer-connection.ts`:

   - Pass-through mode: delegate every member listed above; forward events. Unknown members fall through to the real connection.
   - Switch rule: at `FALLBACK_AFTER_MS` without `connected`, or on `failed`, open the tunnel. While switching, **do not** expose `failed`/`disconnected` to Trystero (report `connecting`). Once the tunnel's peer socket is present, report `connected`.
   - Data channel facade returned from `createDataChannel` and emitted via `ondatachannel` (the answering side must get a synthetic `ondatachannel` in tunnel mode). Implement `send` for string and `ArrayBuffer`/views, `readyState`, `binaryType`, `bufferedAmount` (bytes queued on the WebSocket), `bufferedAmountLowThreshold` + `onbufferedamountlow`, and the open/message/close/error events.
   - Once on the tunnel, stay on it for that connection's lifetime (no mid-session switching).
   - Media (`addTrack`) is not tunnelled. Nova's media features must show "audio/video isn't available with this player" for tunnelled pairs.

6. [ ] Wire it in `packages/trystero-transport` (`rtcPolyfill`). Unit tests with a fake `RTCPeerConnection` and fake WebSocket covering: normal pass-through, timeout switch, `failed` switch, answerer synthetic channel, backpressure events, close propagation, encryption round trip. Playwright e2e (in CI): forced-failure player joins a 3-player party and plays a sample game; this test is what catches breakage on Trystero upgrades.
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

2. [ ] Remove the old TURN-status-specific notices in `engine.ts` that the new stages replace. Keep `PartyDiagnostics.tsx` as the detailed view.
3. [ ] Unit tests per stage with fake timers; one e2e for the signaling-down message (block `/signal` in Playwright).

   Partial typed-error evidence: `engine.test.ts` covers attempt-scoped `room-full`/`decrypt-failed` reports, retry, stale callbacks and established-party notices. `e2e/connection-errors.spec.ts` injects typed transport reports while exercising real signaling, peer timeout, retry and cancel in Chromium, Firefox and WebKit; an uncontacted invite remains a generic timeout. Trystero's installed 0.27 `signal-handler.mjs` reports `decrypt-failed` per peer for either an incorrect password or corrupted signal; `room.mjs` also reports `room-full` per peer. Neither proves why the local join ultimately failed. The timeout screen therefore preserves its generic failure and qualifies these as potentially unrelated peer reports, not definitive diagnoses. Established-party notices also describe only the affected peer connection or message, without claiming that the whole party is full or the local invite is wrong; unit tests cover both codes, per-party notice deduplication across leave/rejoin and stale callbacks in a healthy lobby, and the browser test injects both reports in a live lobby (75/75 party e2e passed in the Playwright Podman image). One prior run exposed a runtime diagnostics test race (waiting for one error before asserting two); the test now waits for both expected errors and console output without weakening assertions. This does not verify a real room-full or wrong-secret report (there is no configured cap and a different secret can select a different room). Definitive screens, per-player and fallback stages remain open. Follow-up: `npm run check` passed and `npm run test:e2e` passed 72/72 in the Playwright 1.62.1 Podman image.

   Partial signaling-down evidence: `signaling-outage.test.ts` and party engine tests cover the five-second delay, recovery, setup retry and cancellation. Follow-up regressions cover shared teardown barriers across failed joins, leave, reconnect and suspend, fail-closed handling of rejected pending and established-party teardown, prompt cancellation while waiting for teardown, late reconnect failure and pausing peer discovery during signaling outages. `e2e/signaling-outage.spec.ts` blocks `/signal` past the initial join deadline and checks automatic recovery. `npm run check` passed; `npm run test:e2e` passed 63/63 in the Playwright 1.62.1 Podman image against this worktree's servers. The host run passed Chromium and Firefox but WebKit could not launch due to missing system libraries. Other stages, fallback-dependent behavior, and removal of their superseded notices remain open.

## 8. Connection logging — P1 (keep it small)

1. [x] Implement locally: edge route `POST /log` (same gate; rate-limit key `log:<ip>`) writes one Workers Analytics Engine point per validated event to `CONNECTION_EVENTS`. Evidence: `deploy/edge/log.test.ts`; schema and official Free/Paid limits rechecked 2026-11-13 in `deploy/cloudflare.md`. No deploy or live verification; owner must confirm actual account plan and access before deployment.
2. [ ] One event per peer connection attempt, sent by the client with `navigator.sendBeacon`:

   - `outcome`: `direct` | `turn` | `tunnel` | `failed` | `unknown` (`direct`/`turn` from the real connection's selected candidate pair via `getStats()`; `tunnel` and `failed` from the wrapper), - `error_code` (Trystero `RoomError.code`, or empty), - `ms_to_connect`, - `signaling_ok` (bool), - `browser` (family only, e.g. `safari-ios`, `chrome-android`), - `network` (`navigator.connection.effectiveType`/`type` where available, else `unknown`), - `app_version`. **Never** names, invite/room ids, peer ids or IPs. The Worker must not write the IP into the data point.

   Partial client evidence: `apps/nova/src/lib/connection-log.test.ts` covers the privacy-preserving beacon reporter and validation. Still needed: wire exactly one event per peer attempt into the migrated transport, determine direct/TURN from the selected candidate pair via getStats, obtain tunnel/failed and signaling state from the wrapper, and verify end-to-end ingestion. No transport instrumentation is in place.

   Investigation (2026-11-13, installed `@trystero-p2p/core@0.27.0` `dist/types.d.mts`, `room.mjs`, `peer.mjs`, `strategy.mjs`, `offer-manager.mjs`): after direct peer activation, `room.getPeers()[peerId].connection` is the actual `rtcPolyfill` instance (native without a polyfill); `onPeerJoin` supplies the peer ID, not the connection. Scale virtual peers have `direct: false` and `connection: null`, so a virtual join is not a physical connection attempt and must not produce a direct/TURN event. A virtual-to-direct upgrade activates without another peer-join event; join-only instrumentation misses it. `peer.mjs` signals connection on data-channel open, while room activation also waits for the handshake. A native `getStats()` report can be resolved through each transport's `selectedCandidatePairId` to the candidate-pair and its local/remote candidate IDs; classify TURN if either selected candidate is `relay`, direct only if both candidate types are known non-relay. Missing/ambiguous selections, unavailable candidate records or rejected `getStats()` are unknown, not direct or failed. Never emit reports, candidate addresses, IDs, or SDP.

   Follow-up/blockers: composing instrumentation inside the planned fallback `rtcPolyfill` can observe the real native connection before failure and retain a monotonic start/end per physical attempt; it must explicitly expose native stats and terminal tunnel/failure state rather than fabricate RTC stats, and deduplicate races, cleanup, retries and reconnections. However, Trystero constructs initiator offers before a remote peer is known and closes/reclaims unused offers, so construction time is not a per-pair start and closing an unclaimed offer is not a failed attempt. Establish the start boundary and correlate a claimed connection with a peer, including pre-activation failures and direct upgrades, without relying on undocumented internals; room errors alone do not identify the corresponding connection instance. Owner chose an explicit `unknown` outcome for unknown/unavailable stats on 2026-11-13, now implemented in edge validation, the client reporter and the stats script. Still define timing boundary, reconnect/upgrade counting and missing-duration policy before wiring or reporting. Validate selected-pair availability across browsers, wrapper races and virtual peers with real-browser tests. The isolated `selected-candidate-outcome.ts` helper and unit tests classify only resolvable native selected pairs; they do not wire reporting or resolve those lifecycle and schema decisions. `reportConnection` has no production caller yet, so the `unknown` meaning documented in `deploy/cloudflare.md` (connection opened, path undeterminable) must be enforced when the transport is wired. Evidence: `npm run check` passed; `npm run test:e2e` passed 60/60 in the Playwright 1.62.1 Podman container against this worktree's servers. Unknown-outcome checks (2026-11-13, `work/log-unknown`): `npm run check` passed (includes edge tests 25/25 and script tests); `node --test scripts/connection-stats.test.mjs` 5/5; `npm run edge:check` dry-run exit 0.

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
- [ ] `packages/trystero-transport/src/trystero-transport.ts`.
- [ ] `apps/runtime/src/nova-bridge.ts` and `runtime-instance.ts`.

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

- [ ] `packages/nova-api/src/session.ts`, `state-engine.ts`,
      `simulation-engine.ts`.
- [ ] UI components and e2e tests: lighter pass.
- [ ] Audit user-facing docs (README, API reference, game-author guide,
      deployment, mobile, security limitations) against shipped behaviour.

## Decisions log

| Date       | Decision                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------- |
| 2026-11-12 | OpenTofu removed; `wrangler.toml` + `wrangler deploy` is the only path.                     |
| 2026-11-12 | One `VITE_EDGE_ORIGIN` for relay + TURN (+ signal, tunnel, log).                            |
| 2026-11-12 | Static hosting moves from GitHub Pages to Cloudflare assets Workers.                        |
| 2026-11-12 | Runtime stays on workers.dev permanently (separate site = isolation).                       |
| 2026-11-12 | Beta on workers.dev; saved games not migrated at cutover (accepted).                        |
| 2026-11-12 | Migrate to Trystero 0.27; adopt every feature that fits Nova.                               |
| 2026-11-12 | Own signaling relay replaces public Nostr relays (no Nostr backup).                         |
| 2026-11-12 | Fallback for WebRTC-blocking networks via `rtcPolyfill` tunnel, per pair; prototype first.  |
| 2026-11-12 | Unlimited party size: adopt `scale()`, no `maxUsers`, load-test large rooms.                |
| 2026-11-12 | Signaling: one Durable Object per room (`/signal/<roomKey>`); tunnel: one per pair.         |
| 2026-11-12 | Workers Free through beta; Workers Paid ($5/month) from the `rocketcrab.com` cutover.       |
| 2026-11-12 | No host-relayed star topology; Trystero mesh (+ tunnel) instead.                            |
| 2026-11-12 | Do not propose the fallback upstream (maintainer rejected in #173).                         |
| 2026-11-13 | §7: generic "Connecting to a player…" for unknown peers; no pre-connect discovery protocol. |
| 2026-11-13 | §8: log an explicit `unknown` outcome when the connection path can't be determined.         |
| 2026-11-13 | §3.7: no 100-browser runs; browsers ≤ 50 players, larger sizes via in-process simulation.   |

## Legacy branches (no action needed for Nova)

`security/node22-brotli`/`prod` (legacy live-service security fixes),
`deps`, `backup/deps-*`, `vitest-browser*`, `allbadcards`, `liesgame`, and old
Dependabot branches are pre-Nova lines of work, not unfinished Nova features.
