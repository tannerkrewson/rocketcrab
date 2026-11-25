# Plan

Remaining engineering work and release checks. Production infrastructure,
launch steps and the deploy approval rules live in
[`deploy/README.md`](deploy/README.md). Finished work lives in git history.

Goals: it must work on any network (corporate, school, hotel, carrier NAT,
mixed), stay simple yet robust, use Trystero as far as it fits (pinned; fix
churn on upgrade), and need no paid always-on server.

## Before beta

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
      recovery before consolidating any other retry paths.

## Before launch

- [ ] Validate Turnstile on real browsers: a party on the beta and on
      `rocketcrab.com` gets `/api/turn` 200 and GA Realtime shows
      `turn_cred_mint` outcome `configured`, and a blocked challenge falls back
      to direct WebRTC or the encrypted tunnel. Headless Playwright never
      passes the challenge, so automated runs skip TURN.
- [ ] Renew the party code from the host only. Every member's
      `PartyCodeLease` (`apps/nova/src/lib/party/party-code.ts`) posts
      `/api/code/claim` every 3 minutes, so Worker and Durable Object requests
      grow with party size and dominate a player's usage (the free plan's
      100k requests a day fail parties once spent). A big party behind one
      school NAT also shares one claim rate-limit bucket. Let only the
      authority claim and renew, publish the code in the replicated party
      state for everyone else to show, and have a new authority take over the
      lease on migration; the 10-minute TTL covers the handover. Keep the code
      live for the whole party, games included: friends join mid-game from
      the header.
- [ ] Security: require Invisible Turnstile on `/api/code/lookup`, as
      `/api/turn` does (`verifyChallenge` in `deploy/nova/turn.ts`; share it
      rather than copy it). Four-letter codes leave 279,805 possibilities and
      a lookup returns the raw `partySecret`, so without a bot check a script
      (or a proxy pool) can sweep the space and join live parties, read
      replicated hidden state and receive private custom game HTML. Keep four
      letters; Turnstile, not code length, is the fix. Turnstile tokens are
      single-use: the `/$code` route (`apps/nova/src/routes/$code.tsx`, which
      already primes a challenge) needs its own token for the lookup, with a
      distinct `action`, and `/api/turn` then needs a fresh one; rework
      `apps/nova/src/lib/party/turnstile.ts` so a consumed token is never
      reused. Fail closed like `/api/turn` (`TURNSTILE_REQUIRED`). When the
      challenge fails or is blocked (content blockers, filtered networks),
      show a clear message on `/$code`: party codes need a quick security
      check this browser or network blocked; ask the host for the invite
      link or QR code instead. Keep the rate limit as a backstop.
- [ ] Clear the in-memory invite handoff when it isn't consumed.
      `handedOff` in `apps/nova/src/lib/party/invite-import.ts` is cleared
      only when `/party` imports it, so a `/$code` → `/party` navigation that
      is cancelled or redirected leaves it set, and a later "Start party"
      joins that looked-up party instead of creating one. Consume it only on
      the navigation it was set for (e.g. pass it in router state, or clear
      it when `/$code` unmounts without navigating to `/party`).
- [ ] Fix the comments the party codes made wrong: `deploy/nova/code.ts`'s
      header says invite links and QR codes never come through `PartyCode`,
      but every party claims a code, so the Worker learns every party's
      secret; `packages/party/src/secrets.ts` says the secret is shared
      solely through private invite fragments. Add `PartyCode` to the
      namespaces the teardown checklist in `deploy/README.md` verifies are
      gone.
- [ ] At cutover, after setting `workers_dev = false` on
      `deploy/nova/wrangler.toml`, remove
      `rocketcrab.tannerkrewson.workers.dev` from the Turnstile widget's
      hostnames and from `deploy/README.md`.
- [ ] Check `rocketcrab.com` and the beta on iOS Safari with content blockers
      on: the app loads, and parties work without analytics or Turnstile.
- [ ] After the first production deploy, watch a Clarity recording of a party
      from an eligible region and confirm names, game titles and the invite
      QR code are masked.
- [ ] Analytics: send real time to ready on `connection_result` `game-ready`
      (`ms_to_connect` is always 0).
- [ ] Analytics: give `join-failed` an `error_code` (expired invite, host
      gone, timeout, blocked network). Today it is always empty.
- [ ] Analytics: give player-visible notices stable codes and send
      `notice_shown {code}`. Code-only notices could then be unmasked in
      Clarity with `data-clarity-unmask`; many notices embed names, titles or
      game text today.
- [ ] Analytics: report Core Web Vitals to GA with the `web-vitals` library,
      and send `app_error {route, error_name}` for uncaught errors and
      rejections, without messages.
- [ ] Analytics: add `invite_share {method}`, an `end_reason` on `game_end`,
      and editor and library events.

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

- Snakeout's in-game "transfer to Rocketcrab" sends every player to
  `/transfer/snakeout/<uuid>/`, which Nova dropped (each player now gets the
  404). Change Snakeout (`src/server/app/game.js`) to link players to
  `https://rocketcrab.com/join`, or remove the button.

- `e2e/smoke.spec.ts` "launches on the home and Nova pages" fails on
  Chromium and Firefox: the logo never gets `rc-logo-launch` after the click.
  Seen 2026-11-25; unrelated to party codes.
- Make Nova's Vite config import graph compatible with the native config loader
  before upgrading to a Vite release that defaults to it.
- The animated site background stops at one viewport height, so long pages
  (home with the install button, the lobby) show a hard edge into plain black
  near the bottom. Make it cover the full page or fade out smoothly.
- Move the lobby's remaining hand-rolled modal (kick confirmation) onto the
  shared `Dialog`, as the QR code now is, so every dialog closes with Escape or
  a backdrop tap and looks the same.
- After launch, confirm on a real iPhone and Android phone that "Get the app"
  appears, its dialog or prompt works, and the installed app opens full screen
  with the black icon.

## Known limits

- Signaling allows 128 concurrent sockets per room. Games can set smaller
  player limits. Local browser runs reached 50 players.
- Peer-link messages are generic ("Connecting to a player…"): Trystero
  exposes no named pre-connection event.
- Networks that block WebSockets to Cloudflare can't connect at all, and
  can report the failure only if the browser can reach Google Analytics.
- Trusted-friends party model: canonical game state (`state.snapshot`, before
  `selectView`) is replicated to every peer's shell for serverless authority
  migration, so a player with DevTools can read hidden state (cards/roles).
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
  `preview_urls` off elsewhere). The beta app on
  `rocketcrab.tannerkrewson.workers.dev` is same-site with the runtime too;
  only `rocketcrab.com` gets the cross-site isolation `deploy/README.md`
  describes.
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
