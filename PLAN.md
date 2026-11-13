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

1. [x] Mechanical migration of `packages/trystero-transport` (and any other Trystero imports): `on*()` listener methods returning unsubscribe, `await room.getSelf()` instead of `selfId`, `room.onError` instead of `onJoinError`, `getPeers()` returning `PeerInfo`, `setRelayConnectivity` instead of pause/resume, `joinRoom` throwing on duplicate active joins (leave first), targeted `send` rejecting for disconnected targets. Pin `trystero` and `@trystero-p2p/*` to exact `0.27.0`. All existing tests green, including `npm run test:e2e:trystero`.
2. [ ] Replace error-string matching with typed codes. Today `handleJoinErrorNotice` in `apps/nova/src/lib/party/engine.ts` and `apps/nova/src/lib/party/connection-errors.ts` parse messages; switch to `RoomError.code` (`peer-connect-failed`, `relay-failed`, `room-full`, `decrypt-failed`, …).

   Partial evidence: party connection messages and deduplicated notices map all nine 0.27 `RoomError.code` values, with legacy category fallback; `connection-errors.test.ts` and `engine.test.ts` cover every code including room-full and decrypt-failed. No `maxUsers` is configured in the transport. `npm run check` passed (after a transient unrelated `nova-api` stale_revision test failure); `npm run test:e2e` passed 60/60 in the Playwright 1.62.1 Podman image against this worktree's servers. This is not end-to-end verification of a real room-full or wrong-invite flow; leave this step open.

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
   - **`makeUserState` — adopt for presence**, replacing duplicate name/rename
     propagation and roster bookkeeping where equivalent. Its signed per-user
     slot and join/leave lifecycle match presence, including late joiners; expose
     it through the transport rather than couple `packages/party` to Trystero.
     Multi-tab aggregation differs from peer-level events; preserve reconnect,
     rename validation and game roster behavior in tests. No ready flag exists
     in the cited session today, so do not invent one merely to use the API.
   - **`makeState` — adopt for durable room context/selection**, not transient
     commands: late joiners receive the latest signed value from remaining peers,
     which can replace context/selected-game announcement and catch-up code.
     It is whole-value last-writer-wins, not consensus or an ordered command
     log; validate shape and current host on writes and test concurrent host
     migration, stale updates and late joins. Keep kick/reload/start events and
     application-level source verification; never replace nova-api game state
     or its authority protocol with LWW state.
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

5. [ ] Implement each _adopt_ as its own commit, deleting the replaced Nova code and its tests (port the behavioural assertions to the new code). Keep `packages/nova-api` (the API games call) stable unless the review shows a clear simplification; games must not need changes.
6. [ ] Adopt `scale()` (required for unlimited party size; it is marked experimental, so test it hard). Keep normal parties on a direct mesh by setting `maxDirectPeers` so rooms up to ~10 players stay direct, and let larger rooms form the multi-hop network. Then:

   - Confirm game-source transfer still works for multi-hop peers: Trystero promotes messages over 16 KiB to a direct link, so a peer reachable only via hops may fail the up-to-2 MiB transfer. If it does, fall back to chunks ≤ 16 KiB for that peer.
   - Load-test large rooms (step 7) before calling this done.

7. [ ] **Large-room load test.** Using headless browser contexts (several machines or CI shards if one machine can't hold them), run parties of 10, 25, 50 and 100 players with a state-mode sample game. Record per size: time until everyone sees everyone, message latency, CPU on the authority player's device (also try a real phone as authority at 25+), and any errors. Known risk to watch: the authority player sends state to everyone, so its upload grows with party size; if it becomes the bottleneck, propose a fix to the owner (e.g. state deltas or fan-out via `scale()` routing) rather than capping parties. Record results in `docs/testing/` and link them from ADR-0003.
8. [ ] Update ADR-0003 (transport abstraction) to describe what Trystero now owns and what Nova still owns.

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
       Evidence after rebase onto nova: `npm run check`; local-relay `npm run test:e2e:trystero` 5/5; `npm run test:e2e` 60/60 in Podman Playwright. SignalHub unit and local workerd integration tests cover relay fan-out and limits. Deferred-digest tests cover cancellation and deadline for join/reconnect/resume; two Chromium pages joined over HTTPS dev signaling with the local certificate.

6. [ ] Record the plan decision in `deploy/cloudflare.md` with the limits that drive it (official docs checked 2026-11-12; research recorded there; notification remains outstanding): **stay on Workers Free during development and the workers.dev beta; switch to Workers Paid ($5/month) at the `rocketcrab.com` cutover (§9).** Reason: Free never bills for Workers/Durable Objects but hard-fails at its daily limits (100,000 Durable Object requests/day; incoming WebSocket messages count 20:1) until 00:00 UTC, which would stop all parties; tunnel usage can exhaust Free depending on traffic (the previously stated 1,000 parties/day is not supported without workload assumptions). TURN is billed separately on either plan. Investigate an available Cloudflare usage notification for beta limits; owner must configure and verify it. See the dated evidence and account-specific gates in `deploy/cloudflare.md`.
7. [ ] Mark `docs/testing/trystero-connectivity-findings.md` relay sections as historical; update ADR-0003.

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
`FALLBACK_AFTER_MS` (start at 8000; must be below Trystero's 15 s
`iceTimeout` in `packages/core/src/peer.ts`), or reports `failed`, the
wrapper carries the data channel over a WebSocket tunnel through the edge
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

2. [ ] Remove the old TURN-status-specific notices in `engine.ts` that the new stages replace. Keep `PartyDiagnostics.tsx` as the detailed view.
3. [ ] Unit tests per stage with fake timers; one e2e for the signaling-down message (block `/signal` in Playwright).

## 8. Connection logging — P1 (keep it small)

1. [x] Implement locally: edge route `POST /log` (same gate; rate-limit key `log:<ip>`) writes one Workers Analytics Engine point per validated event to `CONNECTION_EVENTS`. Evidence: `deploy/edge/log.test.ts`; schema and official Free/Paid limits rechecked 2026-11-13 in `deploy/cloudflare.md`. No deploy or live verification; owner must confirm actual account plan and access before deployment.
2. [ ] One event per peer connection attempt, sent by the client with `navigator.sendBeacon`:

   - `outcome`: `direct` | `turn` | `tunnel` | `failed` (`direct`/`turn` from the real connection's selected candidate pair via `getStats()`; `tunnel` and `failed` from the wrapper), - `error_code` (Trystero `RoomError.code`, or empty), - `ms_to_connect`, - `signaling_ok` (bool), - `browser` (family only, e.g. `safari-ios`, `chrome-android`), - `network` (`navigator.connection.effectiveType`/`type` where available, else `unknown`), - `app_version`. **Never** names, invite/room ids, peer ids or IPs. The Worker must not write the IP into the data point.

   Partial client evidence: `apps/nova/src/lib/connection-log.test.ts` covers the privacy-preserving beacon reporter and validation. Still needed: wire exactly one event per peer attempt into the migrated transport, determine direct/TURN from the selected candidate pair via getStats, obtain tunnel/failed and signaling state from the wrapper, and verify end-to-end ingestion. No transport instrumentation is in place.

   Investigation (2026-11-13, installed `@trystero-p2p/core@0.27.0` `dist/types.d.mts`, `room.mjs`, `peer.mjs`, `strategy.mjs`, `offer-manager.mjs`): after direct peer activation, `room.getPeers()[peerId].connection` is the actual `rtcPolyfill` instance (native without a polyfill); `onPeerJoin` supplies the peer ID, not the connection. Scale virtual peers have `direct: false` and `connection: null`, so a virtual join is not a physical connection attempt and must not produce a direct/TURN event. A virtual-to-direct upgrade activates without another peer-join event; join-only instrumentation misses it. `peer.mjs` signals connection on data-channel open, while room activation also waits for the handshake. A native `getStats()` report can be resolved through each transport's `selectedCandidatePairId` to the candidate-pair and its local/remote candidate IDs; classify TURN if either selected candidate is `relay`, direct only if both candidate types are known non-relay. Missing/ambiguous selections, unavailable candidate records or rejected `getStats()` are unknown, not direct or failed. Never emit reports, candidate addresses, IDs, or SDP.

   Follow-up/blockers: composing instrumentation inside the planned fallback `rtcPolyfill` can observe the real native connection before failure and retain a monotonic start/end per physical attempt; it must explicitly expose native stats and terminal tunnel/failure state rather than fabricate RTC stats, and deduplicate races, cleanup, retries and reconnections. However, Trystero constructs initiator offers before a remote peer is known and closes/reclaims unused offers, so construction time is not a per-pair start and closing an unclaimed offer is not a failed attempt. Establish the start boundary and correlate a claimed connection with a peer, including pre-activation failures and direct upgrades, without relying on undocumented internals; room errors alone do not identify the corresponding connection instance. Decide how to represent unknown/unavailable stats (the current four-outcome schema cannot honestly represent them), and define timing boundary, reconnect/upgrade counting and missing-duration policy before wiring or reporting. Validate selected-pair availability across browsers, wrapper races and virtual peers with real-browser tests. The isolated `selected-candidate-outcome.ts` helper and unit tests classify only resolvable native selected pairs; they do not wire reporting or resolve those lifecycle and schema decisions. Evidence: `npm run check` passed; `npm run test:e2e` passed 60/60 in the Playwright 1.62.1 Podman container against this worktree's servers.

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
- [ ] `packages/nova-api/src/session.ts`, `state-engine.ts`,
      `simulation-engine.ts`.
- [ ] UI components and e2e tests: lighter pass.
- [ ] Audit user-facing docs (README, API reference, game-author guide,
      deployment, mobile, security limitations) against shipped behaviour.

## Decisions log

| Date       | Decision                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------ |
| 2026-11-12 | OpenTofu removed; `wrangler.toml` + `wrangler deploy` is the only path.                    |
| 2026-11-12 | One `VITE_EDGE_ORIGIN` for relay + TURN (+ signal, tunnel, log).                           |
| 2026-11-12 | Static hosting moves from GitHub Pages to Cloudflare assets Workers.                       |
| 2026-11-12 | Runtime stays on workers.dev permanently (separate site = isolation).                      |
| 2026-11-12 | Beta on workers.dev; saved games not migrated at cutover (accepted).                       |
| 2026-11-12 | Migrate to Trystero 0.27; adopt every feature that fits Nova.                              |
| 2026-11-12 | Own signaling relay replaces public Nostr relays (no Nostr backup).                        |
| 2026-11-12 | Fallback for WebRTC-blocking networks via `rtcPolyfill` tunnel, per pair; prototype first. |
| 2026-11-12 | Unlimited party size: adopt `scale()`, no `maxUsers`, load-test large rooms.               |
| 2026-11-12 | Signaling: one Durable Object per room (`/signal/<roomKey>`); tunnel: one per pair.        |
| 2026-11-12 | Workers Free through beta; Workers Paid ($5/month) from the `rocketcrab.com` cutover.      |
| 2026-11-12 | No host-relayed star topology; Trystero mesh (+ tunnel) instead.                           |
| 2026-11-12 | Do not propose the fallback upstream (maintainer rejected in #173).                        |

## Legacy branches (no action needed for Nova)

`security/node22-brotli`/`prod` (legacy live-service security fixes),
`deps`, `backup/deps-*`, `vitest-browser*`, `allbadcards`, `liesgame`, and old
Dependabot branches are pre-Nova lines of work, not unfinished Nova features.
