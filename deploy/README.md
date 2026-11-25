# Production

Everything about running Nova on Cloudflare: what is deployed, how to
deploy it, and what is left before launch. Record every change made outside
the `wrangler.toml` files (dashboard, secrets, account) under **Live state**.

## Deployment targets

| Worker                 | Config                         | Beta origin                                            |
| ---------------------- | ------------------------------ | ------------------------------------------------------ |
| Nova app and party API | `deploy/nova/wrangler.toml`    | `https://rocketcrab-nova.tannerkrewson.workers.dev`    |
| Game runtime           | `deploy/runtime/wrangler.toml` | `https://rocketcrab-runtime.tannerkrewson.workers.dev` |

Cloudflare account `f82d64d09da6cb5a0afa0120033a7e13`. `rocketcrab.com`
serves the legacy site until the production cutover.

Nova serves SPA assets directly from Workers Assets. Requests under `/api`
run the Worker first.

| Route                   | Purpose                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `POST /api/turn`        | Issues a 4-hour Cloudflare Realtime TURN credential after Turnstile.   |
| `POST /api/relay`       | Creates external-game rooms through a fixed list of upstream URLs.     |
| `GET /api/signal/:room` | Trystero signaling, one hibernating Durable Object per room.           |
| `GET /api/tunnel/:pair` | Encrypted WebSocket fallback, one hibernating Durable Object per pair. |

The API checks that browser requests are same-origin. HTTP limits are
approximate, per IP, route and Cloudflare location: 60/min for TURN and the
room relay, 2,000/min for signaling and tunnel upgrades. The socket
handlers also budget signaling messages and tunnel bytes.

The runtime must be on a different **site** (registrable domain) from the
app, not just a different origin: same-site hosting let a looping game wedge
the app's tab. `workers.dev` is on the Public Suffix List, so the beta
hostnames qualify; a `rocketcrab.com` subdomain would not. The app's Vite
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
Both requests below should return 403 after Turnstile has been configured.

```sh
APP=https://rocketcrab-nova.tannerkrewson.workers.dev
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$APP/api/turn"  # 403
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$APP/api/turn" -H "Origin: $APP"  # 403
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

Create an Invisible Turnstile widget for the Nova hostname. Provide its public
site key as `VITE_TURNSTILE_SITE_KEY` in the Nova build and store its secret as
`TURNSTILE_SECRET_KEY` on the Worker. Review the privacy requirements for using
Invisible mode. [Turnstile widget setup](https://developers.cloudflare.com/turnstile/get-started/widget-management/)

## Monitoring

The Nova deploy uses the existing Rocketcrab GA4 web stream
(`G-V569CH5H2D`). Set `VITE_GA_MEASUREMENT_ID` to an empty value to disable
it for a deployment, or use a separate stream for test collection. The tag
runs on the configured Nova origin. It sends route names without query
strings, invite fragments, or private game IDs. GA reporting fields include
`app_variant = nova` on Nova's explicit events.

- Use `page_view` for page traffic and `party_create` for lobbies opened.
- Use `game_start` for games launched, grouped by Game ID and Game kind.
  Players at game start counts connected party members. Divide its sum by
  `game_start` event count to get average party size.
- Use `game_end` for observed play duration (Play duration divided by
  `game_end` count). These events come from the host who started the game.
  Play duration includes time spent reconnecting and can be missing if the
  host's browser is killed. External game time measures the Rocketcrab
  play screen since third-party gameplay occurs inside an iframe.
- Use `nova_connection` for connection paths and join readiness,
  `nova_tunnel` for fallback attempts and terminal failures, and
  `party_issue` for player-visible reconnects and game errors. A signaling
  outage is a `nova_connection` failure with the reason `relay-failed`.
  Break down by outcome, reason, signaling status, browser family, network,
  and Nova revision.
  Connection counts are per client and peer attempt, so a pair can report on
  both devices.
- Use `turn_cred_mint` to see whether fresh TURN credentials were usable
  (`configured`) or unavailable. Cached reuses do not generate an event.
  This client count represents observed results and can miss blocked GA
  requests or clients that disconnect before receiving the credentials.

Cloudflare Workers Logs captures Nova backend errors. Request invocation logs
are disabled. Search for `rate_limiter_unavailable`, `turn_upstream_error`, or
`relay_upstream_error` when checking infrastructure failures.

Nova deploys use Microsoft Clarity project `zix4dzz9v4`. Set
`VITE_CLARITY_PROJECT_ID` to an empty value to disable replay for a deployment.
Replay is opt-in and runs on home, about, and the Nova introduction. The footer
has replay settings for revisiting consent. A fresh document separates replay
from party, catalog, library, and editor pages that can contain private data.
Use Clarity's heatmaps and filter recordings by the Smart Events
`start_party_clicked`, `join_help_opened`, `browse_games_clicked`, and
`open_editor_clicked`. These are clicks on public pages. GA4 measures the
resulting gameplay and connection outcomes.

Before deploying with Clarity enabled, use the project's Settings → Setup to
turn off cookies by default (Consent Mode). Keep conservative masking in
Settings → Masking and verify a consenting test session under Recordings.
[Microsoft Clarity consent settings](https://learn.microsoft.com/en-us/clarity/setup-and-installation/consent-mode)

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

- 2026-11-24: migrated beta to two Workers. Nova version `fdcab6fb` serves
  the app and same-origin party API from commit `976fdd6`. Its SQLite-backed
  Durable Objects are `SignalHub` and `TunnelPair`. The runtime remains
  deployed at version `64058c32`.
- Nova uses the dedicated Realtime TURN key `rocketcrab-nova-beta-turn`.
  The key ID and bearer token are stored as Worker secrets. Verified the
  live deep link, runtime CSP, TURN origin check and minting, Drawphone room
  relay, tunnel pairing and binary forwarding, and a two-browser Nova Quiz
  party with connection logs.
- Deleted `rocketcrab-edge` after validation and confirmed that its old
  Durable Object namespaces and hostname are inactive. Retired the
  `rocketcrab` TURN key and the superseded `rocketcrab-nova-beta` key.
  Rechecked TURN minting after cleanup.

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

1. Add a Cloudflare zone for a separate registrable runtime domain. Choose a
   hostname there and configure it as a Custom Domain in
   `deploy/runtime/wrangler.toml`. Add a `[[routes]]` entry with the hostname
   as `pattern` and `custom_domain = true`. [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
2. Save the existing `rocketcrab.com` DNS records and any Worker, Pages or
   redirect bindings that serve the legacy app. Agree on a cutover window.
   Prepare the runtime build to allow the production app by setting both
   HTTPS origins in `deploy/origins.json`. Deploy the runtime and confirm its
   `frame-ancestors` header allows `https://rocketcrab.com`.
3. Resolve any conflicting legacy DNS or product binding for
   `rocketcrab.com`, then add its Custom Domain to `deploy/nova/wrangler.toml`
   and deploy Nova. The app and `/api` move together. Keep the legacy app
   deployment available during validation.
4. Verify the production editor and cross-site game frame, TURN minting and
   a party on two networks, including tunnel fallback. If validation fails,
   detach the Nova Custom Domain and restore the recorded legacy binding and
   DNS. An ordinary code rollback can restore an earlier version on the
   same domains if the Durable Object configuration matches.
5. Once the production setup works, follow **Retire the beta URLs** below.

## Beta teardown

### Retire the beta URLs after launch

Set `workers_dev = false` and keep `preview_urls = false` in both Worker configs,
then redeploy both. Verify that the custom domains still work and that both
beta URLs stop serving Rocketcrab. The production Workers and their Durable
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

In Cloudflare Realtime → TURN, delete `rocketcrab-nova-beta-turn` after confirming
that it has no other consumers. Delete any TURN API token created solely to
administer this beta. Verify both Worker scripts and Nova's `SignalHub` and
`TunnelPair` namespaces are gone, the beta URLs are inactive, and the beta
key is absent. Leave account-wide workers.dev settings and other applications'
resources in place. [Wrangler delete](https://developers.cloudflare.com/workers/wrangler/commands/workers/#delete)
