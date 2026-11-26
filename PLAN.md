# Plan

Remaining engineering work and release checks. Production infrastructure
and the deploy approval rules live in
[`deploy/README.md`](deploy/README.md). Finished work lives in git history.

Goals: it must work on any network (corporate, school, hotel, carrier NAT,
mixed), stay simple yet robust, use Trystero as far as it fits (pinned; fix
churn on upgrade), and need no paid always-on server.

## Open work

- [ ] Verify the external game catalog in a coordinated multiplayer pass with
      the uniform iframe sandbox enabled.
- [ ] Verify identity persistence and the in-memory fallback in Safari Private
      Mode, including a suspend and reconnect with IndexedDB restricted.
      Desktop Playwright Chromium and WebKit cover the lobby with IndexedDB
      access denied for one player.
- [ ] When Trystero exposes a fresh verified endpoint ID per room join, use it
      as the Nova connection ID and remove the connection generation from
      `nova.identity`. Trystero 0.27 reuses its endpoint ID across reconnects.
- [ ] After the real-device checks below, evaluate room, link and game
      recovery before consolidating any other retry paths. A reloaded party
      creator can reclaim the host role and receive the running state while
      remaining in the lobby without the game frame. Existing peers can
      serve the HTML, but a new shell accepts initial source metadata only
      from the current host. Recover the verified source without letting
      a guest choose the party's game.
- [ ] Check `rocketcrab.com` on iOS Safari with content blockers on: the app
      loads, and parties work without analytics or Turnstile.
- [ ] Watch a Clarity recording of a party from an eligible region and
      confirm names, game titles and the invite QR code are masked.
- [ ] The reference says fullscreen and pointer lock don't work, but the
      runtime requests both. Chromium reports the `allow-fullscreen` sandbox
      token as invalid. Check on real devices and correct the reference or
      the sandbox and permission delegation.

## Real-device checks requiring access or coordination

Playwright WebKit doesn't replace physical iPhones. On this host, WebKit
runs only in the pinned Playwright 1.62.1 Podman image. Use the LAN setup in
the README for local devices.

- [ ] Desktop Wi-Fi ↔ iPhone on cellular; two phones on different carriers;
      connected for more than a minute.
- [ ] A school/corporate network or a UDP-blocking VPN lands on TURN or the
      tunnel. Note whether that network blocks `*.workers.dev`, which hosts
      the production runtime (Nova-made games).
- [ ] Four mixed devices; a phone leaves and rejoins.
- [ ] A 2 MiB game source over cellular and over the tunnel.
- [ ] Validate Nova's state and shared-file budgets on the weakest supported
      phone over cellular TURN and the tunnel. Measure commit cost, snapshot
      resend, file fetch time and peak memory on reload and late join. The
      initial shared-file caps are 256 KiB per file and 1 MiB per session.
      Keep API v1 state and action limits if measurements call for smaller
      limits in a future API version. For an inline action in Trystero 0.27,
      budget 16 KiB including framing and metadata.
- [ ] iPhone Safari backgrounded for 1–3 minutes recovers; a locked phone
      and a tab switch recover too.
- [ ] Exiting a broken game on iPhone returns to a usable lobby.
- [ ] A TURN-backed party that stays connected through the four-hour mint expiry.
- [ ] Airplane mode and a blocked `/api/signal` show their messages and recover.
- [ ] Full create → prompt → paste → test → save → party → play on Mobile
      Safari; the master prompt on two AI chat services.
- [ ] Mobile Safari layout: portrait and landscape, collapsing browser
      chrome, safe areas, and the on-screen keyboard in the lobby, editor and
      play shell. Swiping over the lobby welcome card scrolls the page. Game
      audio starts after a tap, camera permission prompts reach the game frame,
      and the game receives any denial.
- [ ] Turn-based and ticking sample games; authority migration; link and QR
      joins.
- [ ] Drift on real phones: late join, a host that switches apps, and a host
      that leaves. The puck keeps moving on every screen.
- [ ] Measure a ticking game's host upload over TURN on cellular with 4–8
      phones; lower the default tick rate if it is too costly.
- [ ] WebGL backgrounds (`apps/nova/src/vendor/react-bits`) on an older
      phone: home and `/build` stay smooth, and a 10+ minute lobby wait
      doesn't heat the phone or drain the battery. If it struggles, lower
      `PIXEL_BUDGET` in `SiteBackground.tsx` first.
- [ ] A friend beta without coaching.

## Maintenance

- Verify Playwright on GitHub Actions before adding `e2e` to deploy's
  `needs`. The 2026-11-26 main run (45840178627) left Firefox parties at
  one member, missed Chromium's signaling warning, and interrupted
  WebKit's party reload setup. The same runner configuration needs a fresh
  run with host-only ICE in the local test stack, a rejected signaling
  upgrade, and one-navigation game seeding. Failed cases now retain traces,
  including the party specs with retries disabled.
- On a real iPhone, scroll a long page (home with "Get the app", the lobby)
  to the bottom and confirm the animated background reaches the bottom edge.
  It used to stop short with a hard edge into black; the fixed background
  layer is now `100lvh` tall so toolbar collapse can't expose it. If it still
  shows, extend the layer below the viewport or set `overscroll-behavior-y`.
- After launch, confirm on a real iPhone and Android phone that "Get the app"
  appears, its dialog or prompt works, and the installed app opens full screen
  with the black icon.

## Known limits

- One browser profile has one party identity (Trystero's `userId`). A second
  tab joining the same party takes over that player's seat from the first,
  which stops hearing from the party.
- A reloaded tab rejoins its party when anyone else had joined it. A creator
  whose friends have all left gets the "couldn't reach the party" error after
  the 15 s peer wait instead of a fresh party.
- Signaling allows 128 concurrent sockets per room. Games can set smaller
  player limits. Local browser runs reached 50 players.
- Peer-link messages are generic ("Connecting to a player…"): Trystero
  exposes no named pre-connection event.
- Networks that block WebSockets to Cloudflare can't connect at all, and
  can report the failure only if the browser can reach Google Analytics.
- Trusted-friends party model: canonical game state (`state.snapshot`, before
  `selectView`) is replicated to every peer's shell for serverless authority
  migration, so a player with DevTools can read hidden state (cards/roles).
  Referenced shared files also reach every peer. They are held in memory
  during the game and are lost if no connected peer retains them.
  Tunnel fallback keys derive from the shared `partySecret` + SDP fingerprints
  without a per-pair ephemeral DH exchange, and `TunnelPair` pairs the first
  two sockets per `pairId`, so a malicious peer inside the same party could
  derive or disrupt another pair's tunnel.
- Shared runtime origin: untrusted game HTML is isolated from `rocketcrab.com`
  on a separate registrable domain, but all games run on that shared runtime
  origin with `allow-same-origin` and `default-src *` (so camera/mic and remote
  CDN libraries work) and pre-boot in the lobby for readiness. As a result,
  games share runtime-origin storage and any camera/mic permission grant across
  games, and can phone home to external servers.
- The runtime's site is `tannerkrewson.workers.dev` (the Public Suffix List
  lists `workers.dev`, not `*.workers.dev`), so untrusted game HTML is
  same-site with every other `*.tannerkrewson.workers.dev` hostname: it can
  set cookies there and send same-site requests to them. Never host another
  app on this account's workers.dev subdomain (keep `workers_dev` and
  `preview_urls` off elsewhere).
- Party codes: the Worker stores each party's raw `partySecret` in its
  `PartyCode` Durable Object while the code is live (and up to 10 minutes
  after the last renewal), so the Worker could join any party or derive its
  room password and tunnel keys. The code also travels in the URL path
  (`rocketcrab.com/abcd`), reaching edge logs, link unfurlers and history
  while it is live, unlike the `#secret=` fragment of invite links.
- `/transfer/$gameId` starts a party, and for most external games a relay
  room, without a click, so any site can trigger that for a returning
  player. It adds nothing a script calling `/api/relay` directly couldn't
  do; the per-IP (and per-`/64`) limit on `/api/relay` is the mitigation.
