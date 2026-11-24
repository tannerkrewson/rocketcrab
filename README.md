# Rocketcrab Nova

Rocketcrab Nova is a static, mobile-first web application for creating, testing,
saving, and playing user-generated multiplayer browser games.

A user copies one master prompt into their preferred AI chat service, is
interviewed by that chatbot about the game they want, receives one complete HTML
document in one code block, pastes it into Nova, tests several simulated players
on one page, saves the game in their browser, creates a private invite party,
and plays through a Nova-managed peer-to-peer session.

Friends join automatically by opening a private invite link or scanning its QR
code with their phone camera. The lobby offers native sharing where supported,
a copy-link fallback, and a displayed QR. The secret travels only in the URL
fragment, never a path or query (ADR-0011). Anyone with the link can join;
cooperative removal is not a permanent ban. There are no room codes, accounts,
or manual approval. A party stays joinable while any participant is connected;
Nova shell controls pass to a deterministic remaining participant when the creator
leaves, independently of game authority. External game-provider host roles do not
generically migrate.

Nova does not generate games itself, and it does not require game creators to
install tools, understand code, deploy a website, or create a repository.

## Architecture at a glance

- **Fully static application.** Production is static assets at two HTTPS
  origins; there is no room server, database, or game-state storage on the
  server. One Cloudflare edge Worker, which is not deployed yet
  (`deploy/cloudflare.md`), does the server-side work: it mints optional TURN
  credentials (`/turn`), relays external-game room creation, carries WebRTC
  signaling and the encrypted fallback tunnel through two Durable Object
  classes, and accepts privacy-limited connection statistics (`/log`). The
  origins below are placeholders; the beta origins are in `deploy/origins.json`.
  - `https://nova.example` — the Nova application.
  - `https://runtime.nova.example` — an intentionally isolated execution origin
    for pasted game HTML.
- **One self-contained HTML document per game.** Generated games are ordinary
  HTML that may use remote scripts, ESM imports, assets, HTTP requests, and
  browser APIs. Nova does not proxy or rewrite them.
- **One game list.** Nova's built-in list mixes external games (their own
  servers, embedded by iframe) and hosted Nova games (one HTML file, for
  example on GitHub Pages, that the host downloads and shares like a saved
  game). Players see one list; `apps/nova/src/lib/catalog` holds it.
- **Browser-local storage only.** Saved games live in IndexedDB on Nova's main
  origin. No accounts, no cloud sync, no public catalog.
- **Trystero for all real peer-to-peer transport.** A transport-neutral interface
  (`InMemoryTransport` for the local test arena, `TrysteroTransport` for real
  parties) keeps the game-facing API identical everywhere. Signaling uses
  Trystero 0.27's WebSocket relay against the edge Worker, not public relays. A
  WebRTC connection that has not opened directly within 8 seconds falls back to
  an end-to-end encrypted tunnel through the same Worker.
- **One game model.** Nova keeps the canonical state and runs the game's
  actions (and, for real-time games, its `tick` with each player's controls)
  on one elected device, replicating the result and migrating if that player
  leaves. Games have no modes and no channels of their own.

## Workspace layout

```text
/
├── apps/
│   ├── nova/                 # Main React SPA
│   └── runtime/              # Static isolated iframe runner
├── packages/
│   ├── protocol/             # Zod schemas and shared protocol types
│   ├── core/                 # Transport interface and local game repository
│   ├── nova-api/             # Game-facing API client and session engine
│   ├── party/                # Party session, membership and source transfer
│   ├── trystero-transport/   # Real-party transport (Trystero 0.27) and tunnel fallback
│   └── testing/              # In-memory transport and fixtures (incl. test games)
├── deploy/
│   ├── edge/                 # The one Cloudflare edge Worker (signaling, tunnel, TURN, relay)
│   ├── nova/, runtime/       # Static-asset Worker configs (not deployed yet)
│   └── cloudflare.md         # Edge Worker runbook and live state
├── e2e/, e2e-trystero/       # Playwright browser suites
├── scripts/                  # Build, bundle-size and deploy verification helpers
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── history/
│   └── testing/
├── package.json
├── lefthook.yml
├── .oxlintrc.json
└── .oxfmtrc.json
```

Packages are consumed as TypeScript source by the apps (via the npm workspace
protocol); Vite handles transpilation at build time. A package's `build` script
type-checks its source; apps produce real static bundles with `vite build`.

## Remaining work

See [`PLAN.md`](PLAN.md) for the complete remaining-work backlog, owner decisions,
deployment gates, and release-validation checklist.

## Documentation

The docs tree is the single source of truth; every file is owned by a
canonical index or an ADR:

- `docs/architecture/` — 13 ADRs (`adr-0001`..`adr-0013`), the threat model
  (`threat-model.md`), and the deployment guide (`deployment.md`).
- `docs/api/nova-api-ai-reference.md` — the game-facing API reference,
  embedded verbatim in the master prompt; the types in
  `packages/nova-api/src/types.ts` are the exact contract.
- `docs/game-author-debugging.md` — the authoring loop, editor diagnostics,
  common failure messages, and how to debug a real party.
- `docs/testing/` — milestone findings and checklists, each linked from its
  owning ADR (e.g. the S4 vertical slice from ADR-0006).
- `deploy/cloudflare.md` — runbook and live state for the one Cloudflare
  edge Worker (signaling, fallback tunnel, TURN mint, external-game room relay, and
  connection statistics).

## Getting started

Requires Node.js >= 22 and npm (see `packageManager`).

```sh
npm install     # installs workspace, installs lefthook hooks
npm run dev     # starts all apps in parallel
npm run check   # format check + lint + typecheck + tests + build
```

`npm run dev` serves Nova, the runtime and the edge Worker over HTTP by default;
the two-origin HTTPS setup, the Cloudflare deployment scripts, and the per-origin security policies
are documented in `docs/architecture/deployment.md` (M2 — Configure production
static deployment; nothing is published yet).

### Root scripts

| Script                                    | Purpose                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run dev`                             | Run Nova, the runtime and the edge Worker (port 2724) in watch mode                      |
| `npm run dev:https`                       | Run all apps over local HTTPS (run `npm run gen-certs` first)                            |
| `npm run gen-certs`                       | Generate gitignored self-signed certs for local HTTPS (optional LAN IP arg)              |
| `npm run build`                           | Build all apps and packages                                                              |
| `npm run format` / `npm run format:check` | Write / verify Oxfmt formatting                                                          |
| `npm run lint`                            | Oxlint over the workspace                                                                |
| `npm run typecheck`                       | `tsc --noEmit` across all apps and packages                                              |
| `npm test` / `npm run test:watch`         | Vitest unit tests (run / watch)                                                          |
| `npm run test:e2e`                        | Playwright end-to-end tests (run `npx playwright install` first)                         |
| `npm run bundle:size`                     | Print built bundle sizes; warn when the Nova main bundle exceeds the limit               |
| `npm run verify:deploy`                   | Verify a built origin's dist against the deployment requirements                         |
| `npm run deploy:nova` / `deploy:runtime`  | Build with the pinned origins, verify, and deploy a static Worker (owner approval first) |
| `npm run edge:dev`                        | Run the edge Worker locally (`wrangler dev`, port 2724)                                  |
| `npm run edge:check` / `edge:deploy`      | Bundle the edge Worker without uploading / deploy it (owner approval first)              |
| `npm run test:edge`                       | Edge Worker unit tests                                                                   |
| `npm run test:e2e:trystero`               | Playwright suite for the Trystero transport (needs the local edge and fixture servers)   |
| `npm run check`                           | Format check + lint + typecheck + tests + build                                          |

## CI and quality gates

GitHub Actions (`.github/workflows/ci.yml`) runs the same checks as `npm run
check` from a clean checkout using `npm ci` (the committed lockfile), then
uploads the Nova and Runtime bundles as separate artifacts and runs the Playwright
browser suite (`e2e/`) on Chromium, Firefox and WebKit, plus the separate
Trystero transport suite (`e2e-trystero/`) on Chromium. Generated files (TanStack Router `routeTree.gen.ts`) are
excluded from formatting and lint via `.oxfmtrc.json` / `.oxlintrc.json`.

Dependency updates are handled by Dependabot (`.github/dependabot.yml`).

The `bundle:size` script reports raw and gzipped built asset sizes. The Nova
initial JS bundle has a documented gzip budget of 220 kB (baseline 175 kB on
2026-10-24; configurable via `NOVA_BUNDLE_LIMIT_GZIP_KB`). Editor-only code is
route-split into a lazy chunk. The budget is a warning, not a CI gate.

## Testing

- **Unit tests**: Vitest, one config per app/package, run via `npm test`.
- **End-to-end**: Playwright (`npm run test:e2e`). Install browsers once with
  `npx playwright install`. Run `npm run test:e2e:trystero` for the separate
  Chromium transport and tunnel suite.

## Security posture (summary)

Generated game HTML is untrusted and runs only in an iframe on the separate
runtime origin. The runtime has no Nova credentials, no access to main-origin
storage or DOM, and no service-worker authority over the application. All
cross-origin and peer messages are validated against versioned Zod schemas.
A connection that cannot go direct may use an encrypted fallback tunnel through
the edge Worker; the Worker and Cloudflare see ciphertext and metadata only.
Nova member IDs are not Trystero identities. See `docs/architecture/` for the
full threat model and ADRs.

## Current non-goals

No public game publishing or discovery, no accounts, no cloud sync, no
moderation system, no server-side game execution, no Nova-hosted AI generation,
no custom cartridge language, no Nova proxy for CDN imports or assets.
