# rocketcrab Nova

Make and play multiplayer party games with friends, on any device. Copy
Nova's master prompt into any AI chat, describe a game, paste the single HTML
file it gives back, test it with simulated players, and play it in a private
party. Friends join from an invite link or QR code; there are no accounts or
room codes. Nova also lists ready-made games.

Games run peer to peer. The Nova Worker serves the app and the party API
for signaling, TURN credentials and encrypted fallback tunnels. A separate
runtime site isolates untrusted game HTML. Saved games stay in the browser. See
[`deploy/README.md`](deploy/README.md) for production and
[`PLAN.md`](PLAN.md) for remaining work.

## Getting started

Requires Node.js 22+ and npm.

```sh
npm install     # also installs the lefthook git hooks
npm run dev     # app :2722, runtime :2723, API upstream :2724
npm run check   # format check, lint, typecheck, unit tests, build
```

| Script                                   | Purpose                                                     |
| ---------------------------------------- | ----------------------------------------------------------- |
| `npm test`                               | Unit tests (Vitest)                                         |
| `npm run test:e2e`                       | Browser tests (Playwright; `npx playwright install` first)  |
| `npm run test:e2e:trystero`              | Real Trystero transport and tunnel tests (Chromium)         |
| `npm run test:api`                       | Party API unit tests                                        |
| `npm run format` / `lint` / `typecheck`  | Oxfmt, Oxlint, `tsc`                                        |
| `npm run bundle:size`                    | Built bundle sizes; warns past the 220 kB gzip app budget   |
| `npm run dev:api` / `check:deploy`       | Run the API upstream / dry-run the combined Nova deployment |
| `npm run deploy:nova` / `deploy:runtime` | Build, verify and deploy a Worker (see `deploy/`)           |

CI runs the same checks, the browser suite on Chromium, Firefox and WebKit,
and the Trystero suite on Chromium.

### Phones on the LAN

Real devices need HTTPS. Run `npm run gen-certs -- <LAN IP>` and trust the
certificate on each device. Start the stack with the app and runtime origins
set to their LAN addresses. Replace the example address with your own:

```sh
LAN_IP=192.168.1.10
VITE_RUNTIME_ORIGIN="https://$LAN_IP:2723" VITE_MAIN_ORIGIN="https://$LAN_IP:2722" npm run dev:https
```

Open the app on port 2722. The Vite server proxies `/api`, including WebSockets,
to Wrangler on port 2724 over the local loopback interface.

## Layout

```text
apps/nova                  React app (TanStack Router, HeroUI)
apps/runtime               isolated iframe runtime for game HTML
packages/protocol          Zod schemas shared across every boundary
packages/nova-api          the game-facing API and state engine
packages/party             private parties, membership, game-source transfer
packages/trystero-transport  real-party transport and tunnel fallback
packages/core, testing     transport interface, in-memory transport, fixtures
deploy/                    Cloudflare Worker configs and the party API
e2e/, e2e-trystero/        Playwright suites
```

The game-facing API reference, which the master prompt embeds, is
`apps/nova/src/lib/prompt/nova-api-reference.md`.
