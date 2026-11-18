# Deployment: Cloudflare Workers and two static sites

Nova's app and untrusted runtime are static Vite builds served by separate
assets-only Cloudflare Workers. The only application backend is the edge
Worker; its configuration and live-state runbook are in
[`deploy/cloudflare.md`](../../deploy/cloudflare.md).

| Component    | Build               | Worker                         | Beta origin                                            |
| ------------ | ------------------- | ------------------------------ | ------------------------------------------------------ |
| Nova SPA     | `apps/nova/dist`    | `deploy/nova/wrangler.toml`    | `https://rocketcrab-nova.tannerkrewson.workers.dev`    |
| Game runtime | `apps/runtime/dist` | `deploy/runtime/wrangler.toml` | `https://rocketcrab-runtime.tannerkrewson.workers.dev` |
| Edge API     | `deploy/edge/`      | `deploy/edge/wrangler.toml`    | `https://rocketcrab-edge.tannerkrewson.workers.dev`    |

## Isolation and policies

The runtime must be on a different **site**, not merely a different origin.
A site is scheme plus registrable domain as determined using the Public
Suffix List; different ports or sibling subdomains under the same registrable
domain are not sufficient. `workers.dev` is on the Public Suffix List, so
the two Worker hostnames are separate sites. Browser process isolation is
implementation-dependent, but same-site hosting exposed a tab-wedging CPU
exhaustion failure in [the runtime findings](../testing/runtime-sandbox-findings.md).
See ADR-0001 and ADR-0008. Use a separate registrable domain at public
cutover so the runtime can also load on networks that block workers.dev.

The runtime contains no Nova secrets, authentication cookies or service
worker authority; games share its origin and are not isolated from each
other. Exact-origin bootstrap and sandboxing remain required. Both sites
use `Referrer-Policy: no-referrer` and no-referrer meta tags.

Nova's Vite plugin emits a strict CSP both in its HTML meta tag and in
`dist/_headers`, where it adds `frame-ancestors 'none'`. Its `frame-src`
contains the pinned runtime and the Classic game allowlist. The runtime
plugin emits an HTTP policy with `frame-ancestors` pinned to the main origin
and `worker-src 'none'`. Without an app origin pin, it denies framing.
Hashed `/assets/*` are immutable; other assets use Cloudflare defaults.
Workers apply `_headers` from the built asset directory
([Cloudflare documentation](https://developers.cloudflare.com/workers/static-assets/headers/),
checked 2026-11-12). Local Vite development does not serve those headers.

The app uses Cloudflare's `single-page-application` fallback. The runtime
uses `404-page` handling; neither site supports a project-site base path.

## Build and deploy

`deploy/origins.json` contains the beta origins used by both scripts. Each
builds with the appropriate origin pins, runs
`scripts/verify-static-deploy.mjs`, and invokes the pinned Wrangler version:

```sh
npm run deploy:runtime
npm run deploy:nova
```

**First deployments require owner approval.** Do not deploy to or change
`rocketcrab.com` before the cutover gate in `PLAN.md`. The current repository
configuration does not imply either static Worker is live. The edge Worker
has its own `npm run edge:deploy` path and approval gates in the runbook.

For verification without deployment:

```sh
VITE_RUNTIME_ORIGIN=https://rocketcrab-runtime.tannerkrewson.workers.dev \
  VITE_EDGE_ORIGIN=https://rocketcrab-edge.tannerkrewson.workers.dev \
  npm run build --workspace @rocketcrab/nova
VITE_MAIN_ORIGIN=https://rocketcrab-nova.tannerkrewson.workers.dev \
  npm run build --workspace @rocketcrab/runtime
npm run verify:deploy -- --origin nova --runtime-origin https://rocketcrab-runtime.tannerkrewson.workers.dev
npm run verify:deploy -- --origin runtime --main-origin https://rocketcrab-nova.tannerkrewson.workers.dev
```

The verifier checks CSP headers, Nova's meta policy and pinned frame source,
script restrictions, no-referrer, and absence of runtime service workers.
After approved deployment inspect both response headers with `curl -I`, open a
Nova deep link, and create and run a game to check the iframe handshake and
policies. Rebuild and redeploy an earlier commit to roll back, subject to the
usual deployment approval rules.

## Local development

`npm run dev` serves Nova at `http://localhost:5173`, runtime at
`http://localhost:5174`, and the edge Worker at `http://localhost:8787`. Origin
derivation is limited to localhost. For
HTTPS, `npm run gen-certs` followed by `npm run dev:https` uses local
self-signed certificates for both apps and the signaling Worker at
`https://localhost:8787`. Trust the development certificate in the browser
or operating system before using party signaling. On a LAN hostname or IP, set
`VITE_RUNTIME_ORIGIN` and `VITE_EDGE_ORIGIN` for Nova and `VITE_MAIN_ORIGIN` for
the runtime to the matching HTTPS origins, and add the LAN origin to the edge
Worker's `ORIGIN_ALLOWLIST` (the Worker rejects any Origin not on it). The root
`dev:https` script pins `VITE_EDGE_ORIGIN` to `https://localhost:8787`, so a LAN
run starts each workspace by hand. Trust the development certificate on the
device.
Local ports alone are not separate sites, so CPU isolation cannot be assumed.
