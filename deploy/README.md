# Production

Everything about running Nova on Cloudflare: what is deployed, how to
deploy it, and what is left before launch. Record every change made outside
the `wrangler.toml` files (dashboard, secrets, account) under **Live state**.

## What runs where

| Piece        | Build               | Worker config                  | Beta origin (`origins.json`)                           |
| ------------ | ------------------- | ------------------------------ | ------------------------------------------------------ |
| App          | `apps/nova/dist`    | `deploy/nova/wrangler.toml`    | `https://rocketcrab-nova.tannerkrewson.workers.dev`    |
| Game runtime | `apps/runtime/dist` | `deploy/runtime/wrangler.toml` | `https://rocketcrab-runtime.tannerkrewson.workers.dev` |
| Edge         | `deploy/edge/`      | `deploy/edge/wrangler.toml`    | `https://rocketcrab-edge.tannerkrewson.workers.dev`    |

Cloudflare account `f82d64d09da6cb5a0afa0120033a7e13`. `rocketcrab.com`
still serves the legacy site.

The app and runtime are static assets. The edge is the only server code:

| Route               | Purpose                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `POST /turn`        | Issues a 24-hour Cloudflare Realtime TURN credential.                  |
| `POST /`            | Creates external-game rooms through a fixed list of upstream URLs.     |
| `GET /signal/:room` | Trystero signaling, one hibernating Durable Object per room.           |
| `GET /tunnel/:pair` | Encrypted WebSocket fallback, one hibernating Durable Object per pair. |
| `POST /log`         | Connection and readiness events, written to Workers Logs.              |

Every route requires an Origin from `ORIGIN_ALLOWLIST`. HTTP limits are
approximate, per IP, route and Cloudflare location: 120/min for `/turn` and
the room relay, 2,000/min for signaling, tunnel upgrades and reports. The
socket handlers also budget signaling messages and tunnel bytes.

The runtime must be on a different **site** (registrable domain) from the
app, not just a different origin: same-site hosting let a looping game wedge
the app's tab. `workers.dev` is on the Public Suffix List, so the beta
hostnames qualify; a `rocketcrab.com` subdomain would not. The app's Vite
plugin writes a strict CSP into `index.html` and `dist/_headers`, with
`frame-src`, `img-src` and `connect-src` derived from the game list
(`apps/nova/src/lib/catalog`). The runtime denies framing by anything but
the app origin and allows no workers.

## Deploying

**Ask the owner first** for a first deploy of any Worker, `wrangler delete`,
plan changes, custom domains or DNS, and anything touching `rocketcrab.com`.
Redeploying an approved Worker is fine. Use only the npm scripts (they pin
`wrangler@4.161.0`):

```sh
npm run edge:deploy      # edge Worker (npm run edge:check for a dry run)
npm run deploy:runtime   # builds with origins.json pins, verifies, deploys
npm run deploy:nova
```

`npm run verify:deploy` checks a built `dist` (CSP, frame pin, no-referrer,
no runtime service worker). After deploying, `curl -I` both origins, open a
deep link, and run a game in the editor. Roll back by redeploying an earlier
commit.

Edge secrets survive redeploys. To set or rotate them:

```sh
npx --yes wrangler@4.161.0 secret put TURN_KEY_ID --config deploy/edge/wrangler.toml
npx --yes wrangler@4.161.0 secret put TURN_KEY_API_TOKEN --config deploy/edge/wrangler.toml
```

Smoke test the edge (`/turn` must be 403 without an allowed Origin):

```sh
EDGE=https://rocketcrab-edge.tannerkrewson.workers.dev
APP=https://rocketcrab-nova.tannerkrewson.workers.dev
curl -si -X POST "$EDGE/turn"
curl -s -X POST "$EDGE/turn" -H "Origin: $APP"
curl -s -X POST "$EDGE/" -H "Origin: $APP" -H 'Content-Type: application/json' \
  -d '{"endpoint":"spyfall-new"}'
```

For local protocol checks run
`npm run edge:dev -- --local --port 2729 --inspector-port 2730` and
`npm run test:edge:integration`.

## Monitoring

Workers & Pages → `rocketcrab-edge` → Observability. Filter the `event` field
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
- [ ] Attach `rocketcrab.com` to `rocketcrab-nova`, add it to the edge
      `ORIGIN_ALLOWLIST`, rebuild the runtime with the new `VITE_MAIN_ORIGIN`,
      update `origins.json`, and redeploy all three.
- [ ] Move the edge onto `rocketcrab.com` (for example `edge.rocketcrab.com`,
      or under `/api` on the app Worker). School and company filters often
      block `*.workers.dev`, and without signaling nothing connects.
- [ ] **Owner:** register a second domain for the runtime and attach it to
      `rocketcrab-runtime` (a different site from the app, and off
      workers.dev for the same filter reason).
