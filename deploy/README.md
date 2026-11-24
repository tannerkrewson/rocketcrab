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
still serves the legacy site. See **Beta cutover** for the live migration
from the existing three-Worker deployment.

Nova serves SPA assets directly from Workers Assets. Requests under `/api`
run the Worker first.

| Route                   | Purpose                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `POST /api/turn`        | Issues a 24-hour Cloudflare Realtime TURN credential.                  |
| `POST /api/relay`       | Creates external-game rooms through a fixed list of upstream URLs.     |
| `GET /api/signal/:room` | Trystero signaling, one hibernating Durable Object per room.           |
| `GET /api/tunnel/:pair` | Encrypted WebSocket fallback, one hibernating Durable Object per pair. |
| `POST /api/log`         | Writes connection and readiness events to Workers Logs.                |

The API checks that browser requests are same-origin. HTTP limits are
approximate, per IP, route and Cloudflare location: 120/min for TURN and the
room relay, 2,000/min for signaling, tunnel upgrades and reports. The socket
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

Ask the owner before the first deploy of a Worker, the beta cutover below,
deleting a Worker, changing plans or DNS, or touching `rocketcrab.com`.
Routine redeploys of the approved configurations use the npm scripts pinned
to Wrangler 4.161.0:

```sh
npm run check:deploy     # builds Nova, checks CSP, dry-runs the combined Worker
npm run deploy:runtime   # when changing the runtime or its allowed app origin
npm run deploy:nova      # builds and deploys the app and party API together
```

After deploying, verify the app and runtime headers, open a deep link, and run
a game in the editor. Test the API from the app origin. The following TURN
check prints status codes only, so the minted credentials stay out of logs:

```sh
APP=https://rocketcrab-nova.tannerkrewson.workers.dev
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$APP/api/turn"  # 403
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$APP/api/turn" -H "Origin: $APP"  # 200
```

For local protocol checks, start `npm run dev:api -- --port 2729 --inspector-port 2730`
and run `npm run test:api:integration`.

## Beta cutover

1. With owner approval, provision `TURN_KEY_ID` and `TURN_KEY_API_TOKEN`
   on `rocketcrab-nova`. Set each with
   `npx --yes wrangler@4.161.0 secret put <NAME> --config deploy/nova/wrangler.toml`.
   Use the existing key credentials from their source or provision a new key.
2. Run `npm run deploy:nova`. The migration creates fresh SQLite-backed
   `SignalHub` and `TunnelPair` namespaces. The old Worker keeps serving
   clients with the previous app bundle, including parties already open.
   Participants in one party should all reload and use the same build.
3. Verify the TURN check above, start a live party across two browsers, and
   verify the tunnel and Workers Logs. Keep `rocketcrab-edge` deployed
   during validation. Record the versions in **Live state**.
4. After old browser sessions have drained, get owner approval to delete
   `rocketcrab-edge` and retire its namespaces. If a new TURN key was
   provisioned, revoke the old one after its issued credentials expire.

Cloudflare blocks a version rollback across a Durable Object migration. To
restore the old app during the cutover, build the pre-cutover Nova assets in a
separate checkout using that revision's origin pins. Copy its
`apps/nova/dist` into the cutover checkout and redeploy with
`npx --yes wrangler@4.161.0 deploy --config deploy/nova/wrangler.toml`.
This retains the new namespaces and serves the old app, which still uses
`rocketcrab-edge`. [Cloudflare rollback limits](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/#bindings)

## Monitoring

After cutover, open Workers & Pages → `rocketcrab-nova` → Observability. Filter the `event` field
for `nova_connection`: transport outcomes (`direct`, `turn`, `tunnel`,
`failed`, `unknown`) and product outcomes (`lobby-ready`, `join-failed`,
`game-ready`) are separate events. Payloads carry no names, room IDs or
player IDs. `turn_cred_mint` logs TURN issuance. This is the only analytics
Nova has.

Workers Free and Durable Objects Free have daily limits that stop service
until midnight UTC; check usage before a wider beta.

To stop TURN issuance, remove the `TURN_KEY_API_TOKEN` secret (direct
connections and the tunnel keep working). Revoke an issued credential with
the Realtime TURN credential API; rotating the key means updating both
secrets.

## Live state

- 2026-11-18, with owner approval: first deploy of all three Workers on
  workers.dev (edge `7cb56dab`, runtime `fa44334c`, app `68431c6c`). The edge
  migrations created `SignalHub` and `TunnelPair`. `TURN_KEY_ID` and
  `TURN_KEY_API_TOKEN` are set.
- Edge smoke checks passed, including signal and tunnel sockets. The limiter
  returned 429 after about 100 requests on one connection; counts are per
  Cloudflare machine.
- Live headers match both `_headers` files. A two-browser Chromium party on
  the live app reached the lobby and started a game; Workers Logs showed
  `turn_cred_mint`, `direct`, `lobby-ready` and `game-ready`.
- 2026-11-18, with owner approval: deleted the old `rocketcrab-cors-relay`
  and `curly-dream-16c4` Workers.

## Before launch

- [ ] **Owner:** configure the Realtime usage alert and Workers/Durable
      Objects spending controls, and confirm the notification destination.
      A spend block can interrupt parties.
- [ ] Decide whether launch needs product analytics beyond the Workers Logs
      events above (for example parties started, games played). Nothing else
      is collected today.
- [ ] Live smoke test: run a game in the editor on the deployed app and
      runtime; play with two real devices and confirm Workers Logs shows
      lobby and game readiness next to transport outcomes.
- [ ] Switch to Workers Paid ($5/month).
- [ ] Attach `rocketcrab.com` to `rocketcrab-nova`, update
      `origins.json`, and redeploy both Workers. The runtime must allow the
      new app origin. The API follows the app to its new hostname.
- [ ] **Owner:** register a second domain for the runtime and attach it to
      `rocketcrab-runtime` (a different site from the app, and off
      workers.dev for the same filter reason).
