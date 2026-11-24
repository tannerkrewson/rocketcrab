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
- [ ] **Unforgeable party identity (`packages/trystero-transport`, `apps/nova/src/lib/party/identity.ts`)**:
      Adopt Trystero 0.27's built-in cryptographic `userId` instead of
      `identity: "none"` + self-asserted `memberId`: derive `memberId` directly
      from Trystero's verified `userId`, slim `nova.identity` userState down to
      `transportVersion` and `displayName` (rejecting duplicate `memberId`s if
      two connections share one), simplify `apps/nova/src/lib/party/identity.ts`
      to persist only the display name, support passing `createUserIdentity()`
      for ephemeral multi-instance tests, and verify Safari Private Mode
      behavior when IndexedDB is restricted.
- [ ] After the real-device checks below, evaluate room, link and game
      recovery before consolidating any other retry paths.

## Before launch

- [ ] Provision and validate the Invisible Turnstile widget with the deployment
      owner. Set its site key for the Nova build and its Worker secret as
      described in [the deploy runbook](deploy/README.md). Confirm TURN mints
      on success and that blocked challenges fall back to direct WebRTC or
      the encrypted tunnel.

## Real-device checks requiring access or coordination

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

## Known limits

- No party-wide size cap; games can set player limits. Trystero's `scale()`
  overlay tracks at most 2,048 peers. Local browser runs reached 50.
- Peer-link messages are generic ("Connecting to a player…"): Trystero
  exposes no named pre-connection event.
- Networks that block WebSockets to Cloudflare can't connect at all, and
  can report it only if the HTTP `/log` endpoint is reachable.
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
