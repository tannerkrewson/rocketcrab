# Plan

Remaining engineering work and release checks. Production infrastructure,
launch steps and the deploy approval rules live in
[`deploy/README.md`](deploy/README.md). Finished work lives in git history.

Goals: it must work on any network (corporate, school, hotel, carrier NAT,
mixed), stay simple yet robust, use Trystero as far as it fits (pinned; fix
churn on upgrade), and need no paid always-on server.

## Before beta

- [ ] Investigate the extra Firefox fallback socket in the three-player
      tunnel test (`e2e/party-tunnel.spec.ts`): the quiz completes, then the
      socket-count assertion fails. It also fails on `bb6521a`, before the
      party engine rewrite, so it predates it.
- [ ] `packages/nova-api/src/contract-suite.ts` "continues after the
      authority leaves" runs on real timers with 40 ms election windows (the
      suite is shared with the real Trystero transport, so it can't use fake
      timers). It failed once under heavy machine load. Make its timing
      tolerant without slowing the suite, or give the in-memory run
      simulated time while the Trystero run keeps real timers.
- [ ] After the real-device checks below, evaluate room, link and game
      recovery before consolidating any other retry paths.

## Real-device checks

Playwright WebKit doesn't replace physical iPhones. On this host, WebKit
runs only in the pinned Playwright 1.62.1 Podman image. Use the LAN setup in
the README for local devices.

- [ ] Desktop Wi-Fi ↔ iPhone on cellular; two phones on different carriers;
      connected for more than a minute.
- [ ] A school/corporate network or a UDP-blocking VPN lands on TURN or the
      tunnel. Note whether that network blocks `*.workers.dev`.
- [ ] Four mixed devices; a phone leaves and rejoins.
- [ ] A 2 MiB game source over cellular and over the tunnel.
- [ ] iPhone Safari backgrounded for 1–3 minutes recovers; a locked phone
      and a tab switch recover too.
- [ ] Exiting a broken game on iPhone returns to a usable lobby.
- [ ] A party longer than an hour (one 24 h TURN credential).
- [ ] Airplane mode and a blocked `/signal` show their messages and recover.
- [ ] Full create → prompt → paste → test → save → party → play on Mobile
      Safari; the master prompt on two AI chat services.
- [ ] Mobile Safari layout: portrait and landscape, collapsing browser
      chrome, safe areas and the on-screen keyboard in the lobby, editor and
      play shell. Game audio starts after a tap; camera permission prompts
      reach the game frame and a denial reaches the game.
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

## Known limits

- No party-wide size cap; games can set player limits. Trystero's `scale()`
  overlay tracks at most 2,048 peers. Local browser runs reached 50.
- Peer-link messages are generic ("Connecting to a player…"): Trystero
  exposes no named pre-connection event.
- Networks that block WebSockets to Cloudflare can't connect at all, and
  can report it only if the HTTP `/log` endpoint is reachable.
