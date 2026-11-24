# Nova remaining-work plan

Remaining work, owner decisions, and release gates for Nova. Completed work
is recorded in git history, not here.

## Goal and rules (owner direction)

1. **It must always work**: corporate networks, carrier NAT, school/hotel
   Wi-Fi, mixed networks. If a failure mode is plausible, handle it now.
2. **Simple yet robust.** Prefer deleting mechanisms to adding them.
3. **Use Trystero as much as it fits.** Keep it pinned; fix churn on upgrade.
4. **No paid always-on server.** Cloudflare Workers, Durable Objects and
   managed TURN only.

Working rules:

- Branch `nova`; one conventional commit per step. Run `npm run test:e2e`
  for transport/party changes (WebKit needs the pinned Playwright 1.62.1
  Podman image on this host).
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

## 1. One game list and API cleanup (owner direction, 2026-11-24)

### Target design

Today two questions share one answer: who runs the netcode, and where the
game comes from. Every listed game is Classic and every saved game is
Nova. Split them apart:

- **Engine (internal only).** `external` is today's Classic: the game
  brings its own server, the host creates a room, and every player loads
  the game's site in an iframe. `nova` is Nova's isolated runtime and state
  engine. The code keeps this split; the UI never shows it.
- **Source (what players see).** A game comes from the built-in list, from
  My games, or from someone in the party. The UI shows one list with badges
  like "Yours" or "Shared by Sam", plus player count and categories. There
  are no Classic/Nova labels and no third category.
- **Hosted Nova games.** A list entry can point at a Nova game's URL (for
  example GitHub Pages, which sends `Access-Control-Allow-Origin: *`). The
  host fetches the HTML and hands it to the existing `selectGame`, so
  hashing, transfer, runtime isolation, authority migration, and "Save to
  My games" stay unchanged. Joiners never fetch the URL; they get the host's
  verified bytes, so a deploy in the middle of a party cannot split versions.
  First-party Nova games use the same path with a relative URL such as
  `/games/drift.html`.
- **Rejected: loading a hosted Nova game straight into an iframe.**
  `window.nova` exists only because the runtime writes the bridge in front
  of the game in a same-origin frame (`runtime-instance.ts`). A cross-origin
  `postMessage` bridge would be a second protocol and would bypass the
  isolated runtime.

### Decisions

- Delete raw mode. Nova games have one model, so `mode` goes away entirely.
- The game's `defineGame` declaration is the only source of its title and
  player limits. Saved and list metadata stop keeping their own copies.
- Keep the Classic capabilities that have real uses (host-only URLs,
  renamed and extra query parameters, player limits). Fold them into the
  `createRoom`/`joinUrl` redesign below instead of deleting them.
- Player limits are optional for both engines. "Enforced" means the lobby
  shows text when the party is below the minimum or above the maximum;
  starting is still allowed.
- Set with Friends room creation is tracked in
  [#139](https://github.com/tannerkrewson/rocketcrab/issues/139), not here.

### Steps (in order)

API changes come first: they are breaking, they are cheapest before
launch, and the list format depends on them.

- [x] **Remove raw mode.** Delete `nova.raw`, replacing the session when the
      mode changes (`replaceGameSession`), the mode branches in the runtime
      and the engine, `NOVA_MODE_LABELS`, and the raw sample game. Update
      ADR-0006, the AI reference, the master prompt, the README, and the
      real-device checklist. `mode` is gone from the protocol, the API and
      saved games (IndexedDB v3 drops it); `npm run check` passed.
- [x] **One source for a game's title.** Revised: the saved title stays,
      because people rename games in the editor and My games lists them
      without running them. The declared title only names a new game on its
      first save, and the runtime falls back to the saved title when a game
      declares none. The real duplicate, the cached mode, went with raw mode.
- [x] **Fix the handler context.** `context.self` is gone (it named the
      current authority). `context.players` is sorted by id, the same on
      every device and after a migration: devices only know when they saw
      each player join, so no join order is shared. `nova.players` keeps
      this player first, as the AI reference documents. State-engine and
      contract tests cover both.
- [ ] **Small API fixes.** Make `NovaApi.connectionStatus` read-only, have
      `NovaGameDeclaration` extend `NovaStateHandlers` instead of copying
      its fields, and pass the context to `selectView`.
- [ ] **Optional player limits.** Add `minPlayers`/`maxPlayers` to
      `defineGame` for Nova games and to list entries for external games.
      Show lobby text when the party is out of range. When only the limits
      are set, derive the shown player count from them instead of the
      free-text `players` field.
- [ ] **Redesign external games as `createRoom()` + `joinUrl()`.**
      `createRoom()` returns plain JSON that the host broadcasts.
      `joinUrl(room, { name, isHost })` runs on each player's device, since
      every client already ships the list code. This replaces `renameParams`,
      `customQueryParams`, `afterQueryParams`, and the host-override merge
      while keeping what they could do, including host-only URLs.
      `party.classicRoom` then carries only the room JSON. Rename Classic to
      external in the code in the same step.
- [ ] **Fix two likely external-game bugs** (`PartyExperience.tsx`):
      renaming during a game changes the iframe URL and reloads the game,
      and `isHost` uses `role === "creator"` instead of the current
      `hostMemberId`. Reproduce each one in a test first.
- [ ] **One list entry type.** Merge `ClassicGame` and `BrowseEntry` into
      one entry with shared metadata plus
      `play: { kind: "external", … } | { kind: "nova", url }`. Split
      `category` into difficulty and genre, and drop the `netgamesio`
      provider category. Derive `displayUrlText` from `displayUrlHref`.
- [ ] **Hosted Nova games.** Fetch the entry's URL in the list module, not
      the engine (2 MiB limit, readable errors), then call `selectGame`.
      Build the main origin's `connect-src` from the list the same way
      `frame-src` is built from `CLASSIC_FRAME_ORIGINS`. Support single-file
      games first; relative assets can come later through a `baseUrl` in
      the bootstrap that the runtime writes as `<base href>`.
- [ ] **Remove Classic/Nova wording from the UI.** One list in the browser,
      details page, and lobby, with source badges instead of engine labels.
- [ ] **Merge the engine's game state.** Replace `state.game` plus
      `state.classicGame` with one `game: { kind: "nova" | "external", … }`
      and one `selectGame(selection)`. Give each engine a small adapter for
      readiness, reload, and frame ownership. Remove the special cases:
      `classicActive` shortcuts in `engine-snapshot.ts`, the "Classic game
      ready" status text, `classicFrameEpoch`, and the split where the
      engine owns the Nova frame but the UI owns the external iframe.

## 2. Before beta

- [ ] Investigate the extra Firefox fallback socket in the three-player
      tunnel test. The quiz completed, then the socket-count assertion failed
      on both the polished version and the baseline `bb6521a`.
- [ ] After the real-device checks below, evaluate room, link, and game
      recovery before consolidating any other retry paths.

## 3. Owner actions

- [ ] Configure the Realtime usage alert and Workers/Durable Objects spending
      controls. Confirm the notification destination.

## 4. Live stack smoke test

- [ ] Test a game in the editor on the deployed runtime and app. Live
      headers already match `_headers`.
- [ ] Play on the live stack with two devices. Confirm that Workers Logs shows
      lobby and game readiness alongside transport outcomes. Two Chromium
      browsers on one machine passed (`direct`, `lobby-ready`, `game-ready`).

## 5. Real-device checks

Record results here and in the [Mobile Safari checklist](docs/testing/mobile-safari-checklist.md).

- [ ] Desktop Wi-Fi ↔ iPhone on cellular; two phones on different carriers;
      up for more than a minute.
- [ ] A school/corporate network or a UDP-blocking VPN: lands on TURN or the
      tunnel. Also note whether that network blocks `*.workers.dev`.
- [ ] Four mixed devices; a phone leaves and rejoins.
- [ ] 2 MiB game source over cellular and over the tunnel.
- [ ] iPhone Safari backgrounded 1–3 minutes recovers.
- [ ] Exiting a broken game on iPhone returns to a usable lobby.
- [ ] A party longer than an hour (one 24 h TURN credential).
- [ ] Airplane mode and a blocked `/signal` show the messages and recover.
- [ ] Full create → prompt → paste → test → save → party → play on Mobile
      Safari; master prompt on two AI chat services.
- [ ] Turn-based and ticking sample games; authority migration; link and
      QR joins.
- [ ] Drift on real phones: late join, a host that switches apps, and a host
      that leaves. The puck keeps moving on every screen.
- [ ] Measure a ticking game's host upload over TURN on cellular with 4–8
      phones; lower the default tick rate if it is too costly.
- [ ] WebGL backgrounds (React Bits, `apps/nova/src/vendor/react-bits`) on
      an older/low-end phone: home (site background plus the Nova card) and
      `/build` stay smooth, and the party lobby (site background plus the
      Welcome slats) doesn't heat the phone or drain the battery over a 10+
      minute wait. Headless SwiftShader checks held 60 fps on both. If a phone
      struggles, lower `PIXEL_BUDGET` in `SiteBackground.tsx` first.
- [ ] A friend beta without coaching.

## 6. Cutover (owner approval)

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

## Known limits

- **Party size.** No party-wide cap; games can set their own player limits
  (section 1). Trystero's `scale()` overlay tracks at most 2,048 peer
  descriptors. Practical capacity depends on the game and the authority’s
  connection. Local browser runs reached 50.
- **Peer-link messages are generic** ("Connecting to a player…"). Trystero
  exposes no named pre-connection event.
- **Networks that block WebSockets to Cloudflare** cannot connect at all. They
  can report a signaling failure only when the HTTP logging endpoint remains reachable.
