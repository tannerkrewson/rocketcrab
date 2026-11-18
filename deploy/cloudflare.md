# Nova on Cloudflare

`deploy/edge/wrangler.toml` defines the only Worker that runs server code.
Deploy it with `npm run edge:deploy`. Record dashboard, account, and secret
changes in **Live state**. The app and game runtime are static assets Workers.
Their build origins come from [origins.json](origins.json). Keep the runtime on
a separate site from the app.

| Route               | Purpose                                                                      |
| ------------------- | ---------------------------------------------------------------------------- |
| `POST /turn`        | Issues a 24-hour Realtime TURN credential.                                   |
| `POST /`            | Creates Classic rooms using a fixed list of upstream endpoints.              |
| `GET /signal/:room` | Trystero signaling. One hibernating Durable Object per room.                 |
| `GET /tunnel/:pair` | Encrypted WebSocket fallback. One hibernating Durable Object per pair.       |
| `POST /log`         | Validates and writes client connection and readiness events to Workers Logs. |

Every route requires an allowed Origin. The Origin check restricts browser
callers. The HTTP limiters are approximate, per IP, route, and Cloudflare
location. `/turn` and Classic allow 120 per minute. Signaling upgrades, tunnel
upgrades, and reports allow 2,000 per minute per route. The socket handlers
also limit signaling messages and tunnel traffic. A tunnel frame spends at
least 256 bytes of its sender's budget so tiny messages still have a cost.

## First deploy

1. Confirm the account and plan in Cloudflare. Set up the separate Realtime
   usage alert and verify the email destination. Configure Workers and
   Durable Objects [spending controls](https://developers.cloudflare.com/billing/manage/spend-management/)
   where available. A spend block can interrupt parties.
2. Create a Cloudflare Realtime TURN key. Keep the key ID and token for step 4.
3. With owner approval, run `npm run edge:deploy`.
4. Add the secrets at the prompts. They survive redeploys.

   ```sh
   npx --yes wrangler@4.161.0 secret put TURN_KEY_ID --config deploy/edge/wrangler.toml
   npx --yes wrangler@4.161.0 secret put TURN_KEY_API_TOKEN --config deploy/edge/wrangler.toml
   ```

5. Smoke test the edge. Use the worker URL from `deploy/origins.json` and the
   app's allowed origin.

   ```sh
   EDGE=https://rocketcrab-edge.tannerkrewson.workers.dev
   APP=https://rocketcrab-nova.tannerkrewson.workers.dev
   curl -si -X POST "$EDGE/turn"                                    # 403
   curl -s -X POST "$EDGE/turn" -H "Origin: $APP"                      # iceServers
   curl -s -X POST "$EDGE/" -H "Origin: $APP" \
     -H 'Content-Type: application/json' -d '{"endpoint":"spyfall-new"}' # gameCode
   ```

   Check for `429` and `Retry-After` during a sustained, same-location burst
   and recovery after the window. The
   [limiter](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
   does not guarantee the exact request at which throttling begins. Keep
   successful TURN credentials out of test logs.

6. With owner approval, run `npm run deploy:runtime` and `npm run deploy:nova`.
   Check headers on both origins. Create a game in the editor, join it on a
   second device, and exercise signaling and actual tunnel traffic.

For local protocol checks, start `npm run edge:dev -- --local --port 18987`
and run `npm run test:edge:integration`. Use `npm run edge:check` for a deploy
dry run.

## Monitor the beta

In Cloudflare, open **Workers & Pages → rocketcrab-edge → Observability**.
In the logs, filter the structured field `event` for `nova_connection`.
Check for both transport outcomes (`direct`, `turn`, `tunnel`, `failed`,
`unknown`) and product outcomes (`lobby-ready`, `join-failed`, `game-ready`).
These are separate events. A transport opening does not mean the player
reached the game. Events that cannot reach the edge are absent. Client event
payloads exclude names, room IDs, and player IDs.

Workers Free and Durable Objects Free have daily limits that can interrupt
service until midnight UTC. Check account usage before inviting a wider beta.
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) ·
[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) ·
[Realtime pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/)

## TURN response

- Stop new credentials by removing the `TURN_KEY_API_TOKEN` Worker secret.
  Direct connections and the WebSocket backup can still work.
- For an issued credential, use the
  [Realtime TURN credential API](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
  to revoke it. Rotating the key requires updating both Worker secrets.
- To investigate issuance, filter Workers Logs for `turn_cred_mint`.
  Issuance is a separate measure from Realtime egress.

## Live state

- Nova edge, app, and runtime have yet to deploy successfully. The
  2026-11-15 edge attempt failed before deployment because Analytics Engine
  was disabled. The staged Worker now uses Workers Logs.
- Edge migrations create the `SignalHub` and `TunnelPair` SQLite classes.
  They have yet to run against the account. TURN secrets are pending.
- Retire the old `rocketcrab-cors-relay` Worker after the new edge passes
  smoke checks and live consumers are checked. Deletion needs owner approval.
