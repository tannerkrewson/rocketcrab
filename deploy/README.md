# Production

Everything about running Nova on Cloudflare: what is deployed, how to
deploy it, and what is left before launch. Record every change made outside
the `wrangler.toml` files (dashboard, secrets, account) under **Live state**.

## Deployment targets

| Worker                              | Config                         | Beta origin                                            |
| ----------------------------------- | ------------------------------ | ------------------------------------------------------ |
| App and party API (`rocketcrab`)    | `deploy/nova/wrangler.toml`    | `https://rocketcrab.tannerkrewson.workers.dev`         |
| Game runtime (`rocketcrab-runtime`) | `deploy/runtime/wrangler.toml` | `https://rocketcrab-runtime.tannerkrewson.workers.dev` |

Cloudflare account `f82d64d09da6cb5a0afa0120033a7e13`. `rocketcrab.com`
serves the legacy site until the production cutover.

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
APP=https://rocketcrab.tannerkrewson.workers.dev
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

The Invisible Turnstile widget `rocketcrab` allows `rocketcrab.com` and
`rocketcrab.tannerkrewson.workers.dev`. `scripts/deploy-static.mjs` builds in
its public site key; its secret is `TURNSTILE_SECRET_KEY` on the Worker. Review the privacy requirements for using
Invisible mode. [Turnstile widget setup](https://developers.cloudflare.com/turnstile/get-started/widget-management/)

## Monitoring

The Nova deploy uses the existing Rocketcrab GA4 web stream
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
  host's browser is killed. External game time measures the Rocketcrab
  play screen since third-party gameplay occurs inside an iframe.
- Use `connection_result` for connection paths and join readiness,
  `tunnel_result` for fallback attempts and terminal failures, and
  `party_issue` for player-visible reconnects and game errors. A signaling
  outage is a `connection_result` failure with the reason `relay-failed`.
  Break down by outcome, reason, signaling status, browser family, network,
  and App version.
  Connection counts are per client and peer attempt, so a pair can report on
  both devices.
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

Classic Rocketcrab's GA4 reports use `event_category = Party-Game` with the
game ID as the event name, and `Party-numberOfPlayers` with the count as
the event name. Compare classic game IDs to the lowercase Nova catalog
slugs where the same game is offered. Keep browser-history page-view
measurement disabled on this stream because Nova sends its own page views.

Workers Free and Durable Objects Free have daily limits that stop service
until midnight UTC; check usage before a wider beta.

To stop TURN issuance, remove the `TURN_KEY_API_TOKEN` secret (direct
connections and the tunnel keep working). Revoke an issued credential with
the Realtime TURN credential API; rotating the key means updating both
secrets.

## Live state

- 2026-11-25: replaced the `rocketcrab-nova` Worker with `rocketcrab`
  (`https://rocketcrab.tannerkrewson.workers.dev`), version `7db13cb7`, so
  one `v1` migration creates `SignalHub`, `TunnelPair` and `PartyCode`. The
  runtime, version `9e4578c0`, frames only the new origin. The old Worker
  and its hostname are deleted.
- The app uses the Realtime TURN key `rocketcrab-turn`; its ID and bearer
  token are Worker secrets, and the key mints credentials when called
  directly. The Turnstile widget `rocketcrab` is live: its secret is on the
  Worker, the app build carries its site key, and `/api/turn` answers 403
  without a passing check. A real browser minting TURN is still unverified.
- 2026-11-25: `CODE_HMAC_SECRET` set, then Nova deployed as version
  `5af34f98` with keyed party codes, Turnstile on `/api/code/lookup`, IPv6
  /64 rate limits and host-only code renewal. `/api/turn` and
  `/api/code/lookup` answer 403 without a valid token, and repeated claims
  for one secret return the same code. The runtime was unchanged and stays
  at `9e4578c0`. The account holds only the two Workers, their three
  Durable Object namespaces and the `rocketcrab` Turnstile widget, so there
  was nothing stale to remove. The owner joined a party by code through
  Turnstile on real devices.
- Verified a two-browser party joined by code through `/join`, and
  `/transfer/drawphone` creating a Drawphone room through `/api/relay`
  (Drawphone, Drawphone for Kids, Spyfall, Snakeout and Werewolf relays
  answer).

## Before launch

- [ ] **Owner:** configure the Realtime usage alert and Workers/Durable
      Objects spending controls, and confirm the notification destination.
      A spend block can interrupt parties.
- [ ] Live smoke test: run a game in the editor on the deployed app and
      runtime; play with two real devices and confirm GA Realtime receives page
      views, game start and end, TURN configuration, connection outcomes,
      and lobby and game readiness.
- [ ] Switch to Workers Paid ($5/month).

## Production cutover

1. Save the existing `rocketcrab.com` DNS records and any Worker, Pages or
   redirect bindings that serve the legacy app. Agree on a cutover window.
2. Set `nova` in `deploy/origins.json` to `https://rocketcrab.com` (the
   runtime keeps its workers.dev origin). Deploy the runtime and confirm its
   `frame-ancestors` header allows `https://rocketcrab.com`. From here the
   beta app can no longer frame Nova games.
3. Resolve any conflicting legacy DNS or product binding for
   `rocketcrab.com`, then add its Custom Domain to `deploy/nova/wrangler.toml`
   (a `[[routes]]` entry with `custom_domain = true`) and deploy Nova. The app
   and `/api` move together. Keep the legacy app deployment available during
   validation. [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
4. Verify the production editor and cross-site game frame, TURN minting and
   a party on two networks, including tunnel fallback. If validation fails,
   detach the Nova Custom Domain and restore the recorded legacy binding and
   DNS. An ordinary code rollback can restore an earlier version on the
   same domains if the Durable Object configuration matches.
5. Once the production setup works, follow **Retire the beta URLs** below.
6. Retire `kids.rocketcrab.com`. Nova has no kids mode; the legacy app
   served it as a Next.js locale domain. GA showed about 180 multiplayer
   game starts in the year before November 2026, falling to a few per month.
   Remove its legacy hosting binding, then replace its DNS record with a
   Cloudflare Redirect Rule that sends it to `https://rocketcrab.com` with a
   301, so old links keep working. Confirm it no longer serves the legacy app.

## Beta teardown

### Retire the beta URLs after launch

Set `workers_dev = false` and keep `preview_urls = false` in
`deploy/nova/wrangler.toml`, then redeploy Nova. Keep the runtime's
`workers_dev = true`: its workers.dev hostname is the production runtime.
Verify that `rocketcrab.com` still works and the Nova beta URL stops serving
Rocketcrab. Then remove `rocketcrab.tannerkrewson.workers.dev` from the
Turnstile widget's hostnames, and from this file. The production Workers and their Durable
Objects remain in use. If production switched to a separate TURN key, delete
the beta key after beta traffic has drained. [Disable workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/#disabling-workersdev)

### Remove a beta-only deployment entirely

Confirm both Workers serve only the beta URLs and have no production custom
domains or consumers. Deletion ends active parties and removes the Workers'
secrets and Durable Object data. Run these from the repo root with the beta
Cloudflare account selected:

```sh
npx --yes wrangler@4.161.0 delete --config deploy/nova/wrangler.toml
npx --yes wrangler@4.161.0 delete --config deploy/runtime/wrangler.toml
```

In Cloudflare Realtime → TURN, delete `rocketcrab-turn` after confirming
that it has no other consumers. Delete any TURN API token created solely to
administer this beta. Verify both Worker scripts and Nova's `SignalHub`,
`TunnelPair` and `PartyCode` namespaces are gone, the beta URLs are inactive, and the beta
key is absent. Leave account-wide workers.dev settings and other applications'
resources in place. [Wrangler delete](https://developers.cloudflare.com/workers/wrangler/commands/workers/#delete)
