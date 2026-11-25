# Production

Everything about running Nova on Cloudflare: what is deployed, how to
deploy it, and what is left before launch. Record every change made outside
the `wrangler.toml` files (dashboard, secrets, account) under **Live state**.

## Deployment targets

| Worker                              | Config                         | Origin                                                 |
| ----------------------------------- | ------------------------------ | ------------------------------------------------------ |
| App and party API (`rocketcrab`)    | `deploy/nova/wrangler.toml`    | `https://rocketcrab.com` (Custom Domain)               |
| Game runtime (`rocketcrab-runtime`) | `deploy/runtime/wrangler.toml` | `https://rocketcrab-runtime.tannerkrewson.workers.dev` |

Cloudflare account `f82d64d09da6cb5a0afa0120033a7e13`, zone `rocketcrab.com`.
The app has no workers.dev URL. A Redirect Rule sends `kids.rocketcrab.com`
(a proxied placeholder `AAAA 100::` record) to `https://rocketcrab.com/` with
a 301: Nova has no kids mode.

Nova serves SPA assets directly from Workers Assets. Requests under `/api`
run the Worker first.

| Route                   | Purpose                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| `POST /api/turn`        | Issues a 4-hour Cloudflare Realtime TURN credential after Turnstile.      |
| `POST /api/relay`       | Creates external-game rooms through a fixed list of upstream URLs.        |
| `GET /api/signal/:room` | Trystero signaling, one hibernating Durable Object per room.              |
| `GET /api/tunnel/:pair` | Encrypted WebSocket fallback, one hibernating Durable Object per pair.    |
| `POST /api/code/claim`  | Claims or renews a party's four-letter code, one Durable Object per code. |
| `POST /api/code/lookup` | Resolves a live four-letter code to its party's secret after Turnstile.   |

The API checks that browser requests are same-origin. HTTP limits are
approximate, per IPv4 address or IPv6 /64, route and Cloudflare location:
60/min for TURN, the room relay and each party-code route, 2,000/min for
signaling and tunnel upgrades. The socket handlers also budget signaling messages and tunnel bytes.

The runtime must be on a different **site** (registrable domain) from the
app, not just a different origin: same-site hosting let a looping game wedge
the app's tab. `workers.dev` is on the Public Suffix List, so the runtime
stays on `rocketcrab-runtime.tannerkrewson.workers.dev` in production; a
`rocketcrab.com` subdomain would not qualify. A network that blocks
`*.workers.dev` blocks Nova-made games but not the app or external games. The app's Vite
plugin writes a strict CSP into `index.html` and `dist/_headers`, with
`frame-src`, `img-src` and `connect-src` derived from the game list
(`apps/nova/src/lib/catalog`). The runtime denies framing by anything but
the app origin and allows no workers.

## Deploying

Ask the owner before the first deploy of a Worker, deleting a Worker,
changing plans or DNS, or touching `rocketcrab.com`.
Routine redeploys of the approved configurations use the npm scripts pinned
to Wrangler 4.161.0:

```sh
npm run check:deploy     # builds Nova, checks CSP, dry-runs the combined Worker
npm run deploy:runtime   # when changing the runtime or its allowed app origin
npm run deploy:nova      # builds and deploys the app and party API together
```

After deploying, verify the app and runtime headers, open a deep link, and run
a game in the editor. Confirm TURN minting by joining from the deployed party
page and checking for `turn_cred_mint` with outcome `configured` in GA Realtime.
The requests below should return 403 after Turnstile has been configured.

```sh
APP=https://rocketcrab.com
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$APP/api/turn"  # 403
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$APP/api/turn" -H "Origin: $APP"  # 403
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$APP/api/code/lookup" -H "Origin: $APP" -d '{"code":"abcd"}'  # 403
```

For local protocol checks, use separate Worker storage so the integration
server can run alongside app development:

```sh
npm run dev:api -- --port 2729 --inspector-port 2730 --persist-to .wrangler/protocol-checks
```

Run `npm run test:api:integration` in another terminal.

### TURN secrets

Provision a dedicated Realtime TURN key for the deployment. Store its ID
and bearer token as Wrangler secrets on the Nova Worker:

```sh
npx --yes wrangler@4.161.0 secret put TURN_KEY_ID --config deploy/nova/wrangler.toml
npx --yes wrangler@4.161.0 secret put TURN_KEY_API_TOKEN --config deploy/nova/wrangler.toml
```

Keep the token in your credential store. Cloudflare returns it when the key is
created. [Realtime TURN keys](https://developers.cloudflare.com/api/resources/calls/subresources/turn/)

### Party-code secret

`CODE_HMAC_SECRET` keys the derivation of four-letter party codes, so no one
can find a party secret that lands on a chosen code. Without it,
`/api/code/claim` answers 503 and parties show no code. Set a random value
before deploying code that needs it; `npm run dev:api` passes a fixed local
one. Rotating it moves every live party to a new code at its next renewal
(invite links keep working).

```sh
openssl rand -base64 32 | npx --yes wrangler@4.161.0 secret put CODE_HMAC_SECRET --config deploy/nova/wrangler.toml
```

The Invisible Turnstile widget `rocketcrab` allows `rocketcrab.com`.
`scripts/deploy-static.mjs` builds in
its public site key; its secret is `TURNSTILE_SECRET_KEY` on the Worker. Review the privacy requirements for using
Invisible mode. [Turnstile widget setup](https://developers.cloudflare.com/turnstile/get-started/widget-management/)

## Monitoring

The Nova deploy uses the existing rocketcrab GA4 web stream
(`G-V569CH5H2D`). Set `VITE_GA_MEASUREMENT_ID` to an empty value to disable
it for a deployment, or use a separate stream for test collection. The tag
runs on the configured Nova origin. It sends route names without query
strings, invite fragments, or private game IDs.

- Use `page_view` for page traffic, `party_create` for lobbies opened, and
  `party_join` for invitees who reached a lobby.
- Use `game_start` for games launched, grouped by Game ID and Game kind.
  Players at game start counts connected party members. Divide its sum by
  `game_start` event count to get average party size.
- Use `game_end` for observed play duration (Play duration divided by
  `game_end` count). These events come from the host who started the game.
  Play duration includes time spent reconnecting and can be missing if the
  host's browser is killed. External game time measures the rocketcrab
  play screen since third-party gameplay occurs inside an iframe.
- Use `connection_result` for connection paths and join readiness,
  `tunnel_result` for fallback attempts and terminal failures, and
  `party_issue` for player-visible reconnects and game errors. A signaling
  outage is a `connection_result` failure with the reason `relay-failed`.
  `join-failed` carries an `error_code`: `host-unreachable` (the invite or
  code reached no one), `room-full`, `decrypt-failed` or `relay-failed`.
  `game-ready` times the host's start request to the game starting; other
  players leave it empty.
  Break down by outcome, reason, signaling status, browser family, network,
  and App version.
  Connection counts are per client and peer attempt, so a pair can report on
  both devices.
- Use `invite_share` for how hosts share (`method` copy-link, copy-code-link,
  qr or native-share), `editor_action` for the build funnel (`action`
  copy-prompt, copy-prompt-with-game, paste, upload, save-new, save,
  save-copy or play-with-friends) and `library_action` (`action` duplicate or
  delete). `game_end` carries `end_reason`: the game's own reason
  (`host_closed`, `user_exit`, `error`), or `switched`, `left` or
  `page-closed`.
- Use `notice_shown` for the warnings and errors players see (`code`, a
  stable name such as `start-blocked` or `runtime-unresponsive` from
  `addNotice` in `apps/nova/src/lib/party/engine.ts`, and `level`). Info
  notices aren't sent.
- Use `web_vital` for Core Web Vitals (`metric` LCP, INP, CLS, FCP or TTFB,
  `value` in ms or CLS in thousandths, `rating`, `route`) and `app_error`
  for uncaught errors and rejections (`route`, `error_name`, at most ten per
  page load; never messages).
- Use `turn_cred_mint` to see whether fresh TURN credentials were usable
  (`configured`) or unavailable. Cached reuses do not generate an event.
  This client count represents observed results and can miss blocked GA
  requests or clients that disconnect before receiving the credentials.
- Legacy app events (before cutover) store their name in Event Category and
  a value as the event name. Compare `game_start` with Event Category
  `Party-Game`, whose event name is the title-cased Game ID. Compare Players
  at game start with Event Category `Party-numberOfPlayers`. Engagement rate
  before 2024-10-28 is not comparable because `user_engagement` was not
  collected.

Cloudflare Workers Logs captures Nova backend errors. Request invocation logs
are disabled. Search for `rate_limiter_unavailable`, `turn_upstream_error`, or
`relay_upstream_error` when checking infrastructure failures.

Nova deploys use Microsoft Clarity project `zix4dzz9v4`. Set
`VITE_CLARITY_PROJECT_ID` to an empty value to disable replay for a deployment.
Cookie-based replay runs by default on home, about, the Nova introduction, and
the party screen, for visitors in the US and Canada outside
Québec. The Worker checks eligibility without returning the visitor's location
and skips replay for Global Privacy Control. The footer's Privacy link lets
visitors turn off replay in their browser. Once a party exists, its URL drops
the starting game, which can be private. Clarity stops before the router
leaves those pages, so catalog, library, and editor pages are never recorded.
The project must keep strict masking (Settings → Masking). Strict masking hides
text but records attributes, so recorded screens must keep names, titles, and
invite secrets out of attributes; the party component tests check this.
Use Clarity's heatmaps and filter recordings by custom events. Public pages
send `start_party_clicked`, `join_help_opened`, `browse_games_clicked`, and
`open_editor_clicked`. Every GA4 event sent while recording is mirrored as
`event` or `event:outcome`, such as `connection_result:join-failed` or
`party_issue:reconnecting`. Recordings with a game carry a `game_id` tag.

The project needs cookies enabled by default in Settings → Setup. Verify a
test visit from an eligible location under Recordings after deployment.

Classic rocketcrab's GA4 reports use `event_category = Party-Game` with the
game ID as the event name, and `Party-numberOfPlayers` with the count as
the event name. Compare classic game IDs to the lowercase Nova catalog
slugs where the same game is offered. Keep browser-history page-view
measurement disabled on this stream because Nova sends its own page views.

The account is on Workers Paid. Spend policies (Billing → Spend Management)
email the owner's login address at $10 and block usage at $100 a month,
separately for Workers and Durable Objects. A block stops every Worker
request or pauses Durable Objects account-wide until the next billing
period, so raise the limit rather than wait if one fires. The account budget
alert (Notifications) emails at $20 of total spend, the only coverage for
Realtime TURN, which has no spending limit.

To stop TURN issuance, remove the `TURN_KEY_API_TOKEN` secret (direct
connections and the tunnel keep working). Revoke an issued credential with
the Realtime TURN credential API; rotating the key means updating both
secrets.

## Live state

- `rocketcrab.com` serves Nova since 2026-11-25. The app Worker
  `rocketcrab` (Custom Domain `rocketcrab.com`) holds `SignalHub`,
  `TunnelPair` and `PartyCode` from one `v1` migration and the secrets
  `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` (Realtime TURN key `rocketcrab-turn`),
  `TURNSTILE_SECRET_KEY` and `CODE_HMAC_SECRET`. The runtime frames only
  `https://rocketcrab.com`.
- rocketcrab Classic is the `classic` branch and the `rocketcrab-classic`
  tag. It ran on the Dokku host `134.209.222.77` behind proxied A records for
  `rocketcrab.com` and `kids.rocketcrab.com`; the pre-cutover zone export is
  in `~/code/rocketcrab-cutover-backup/` on Gerald. To roll back while that
  host still runs it: detach the Custom Domain, recreate the proxied A record
  `rocketcrab.com` → `134.209.222.77`, and delete the kids Redirect Rule and
  restore its A record. Cloudflare refuses `override_existing_dns_record` for
  records like these, so a domain swap is a delete followed at once by the
  attach.
