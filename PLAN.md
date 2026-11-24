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
- [ ] **Peer-envelope verification & `NovaSession` authorization (`packages/protocol`, `packages/party`, `packages/nova-api`)**:
      Extract a shared peer-envelope verification helper (checking `sessionId`,
      `senderMemberId` and `senderConnectionId` against the transport envelope)
      and use it in both `PartySession.receive()` and
      `NovaSession.handleMessage()` (`packages/nova-api/src/session.ts`). In
      `NovaSession`, also bound `deferredProtocolMessages`, restrict
      `state.view` and `action.ack` to the current authority, and restrict
      `game.end` to the host/authority.
- [ ] **Host-pinned game sources (`apps/nova/src/lib/party/engine.ts`)**:
      Fix `acceptMetadata` so only `party.hostMemberId` can select or replace a
      game's `(gameId, sourceSha256)`; non-host peers may only serve cached
      copies matching both `gameId` and the host-pinned `sourceSha256`.
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

Code-side production hardening (complements the Cloudflare spend controls and
Workers Paid cutover in [`deploy/README.md`](deploy/README.md)). `Origin` /
`Sec-Fetch-Site` checks in `deploy/nova/worker.ts` stop cross-site browser
requests but do not stop non-browser clients from spoofing `Origin`:

- [ ] **Protect `POST /api/turn` (`deploy/nova/turn.ts`, `apps/nova/src/lib/party/turn-creds.ts`, `apps/nova/vite.config.ts`, `deploy/nova/wrangler.toml`)**:
      Gate `POST /api/turn` with Cloudflare Turnstile in Invisible mode, loaded
      lazily only on `/party` and executed in the background during name entry
      or party setup so users see zero challenge UI; if Turnstile fails or is
      blocked by a restrictive network or privacy extension, fall back cleanly
      to direct WebRTC / the encrypted tunnel via the existing graceful-degrade
      path. Verify tokens server-side via Cloudflare's `siteverify` endpoint
      (checking `success`, `hostname` and `action`; skipped in local dev when
      `TURNSTILE_SECRET_KEY` is unset), allow `https://challenges.cloudflare.com`
      in `apps/nova/vite.config.ts` CSP (`script-src` and `frame-src`), lower
      `MINT_TTL_SECONDS` / `TURN_CREDS_TTL_MS` from 24 h (e.g., to 4 h), and
      tighten the `/api/turn` rate limit below 120/min/IP.
- [ ] **Harden & simplify `SignalHub` (`deploy/nova/signal.ts`)**:
      Refactor `SignalHub` to mirror `TunnelPair`'s in-memory cache +
      attachment persistence + alarm pattern: cap concurrent sockets per room
      (e.g., 64–128), reduce per-socket budgets from 200 msg/s × 256 KiB to
      signaling-sized limits (e.g., 20 msg/s refill, 100 burst, 64 KiB max
      frame), cache `topics` in memory instead of calling
      `deserializeAttachment()` per subscriber on every publish, and close idle
      sockets via alarm.
- [ ] **Bound `TunnelPair` lifetime (`deploy/nova/tunnel.ts`)**:
      Add a per-pair max lifetime (via the existing Durable Object alarm, e.g.,
      6 h) and a lifetime byte cap.
- [ ] **Harden `POST /api/relay` & API response headers (`deploy/nova/relay.ts`, `deploy/nova/http.ts`)**:
      Move `log.ts`'s streaming body-size limiter into a shared helper in
      `http.ts` and apply request/response caps + `AbortSignal.timeout` in
      `relay.ts`; check `Object.hasOwn(RELAY_ENDPOINTS, endpoint)`; allowlist
      the 7 `netgames.io` `urlId` values and verify the final redirect stays on
      `https://netgames.io`; constrain forwarded POST bodies (`ooc-rocketcrab`
      to `{ game, version: 1 }`, empty body for the rest). Add
      `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` in
      `http.ts` for all `/api/*` JSON responses.

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
- [ ] A party longer than an hour (covers the TURN credential lifetime).
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
