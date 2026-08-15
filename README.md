# Rocketcrab Nova

Rocketcrab Nova is a static, mobile-first web application for creating, testing,
saving, and playing user-generated multiplayer browser games.

A user copies one master prompt into their preferred AI chat service, is
interviewed by that chatbot about the game they want, receives one complete HTML
document in one code block, pastes it into Nova, tests several simulated players
on one page, saves the game in their browser, creates a party with a four-letter
code, and plays through a Nova-managed peer-to-peer session.

Joining a party works two ways: the short link `https://rocketcrab.com/<code>`
(four-letter code as a path segment — a public rendezvous namespace, never a
secret) for typing or voice, or the full secret invite link behind the lobby's
Copy URL / QR buttons for one-tap direct join. The session secret travels only
in the URL fragment, never in a path or query (ADR-0011).

Nova does not generate games itself, and it does not require game creators to
install tools, understand code, deploy a website, or create a repository.

## Architecture at a glance

- **Fully static application.** No Nova application backend. Production is
  static assets at two HTTPS origins:
  - `https://nova.example` — the Nova application.
  - `https://runtime.nova.example` — an intentionally isolated execution origin
    for pasted game HTML.
- **One self-contained HTML document per game.** Generated games are ordinary
  HTML that may use remote scripts, ESM imports, assets, HTTP requests, and
  browser APIs. Nova does not proxy or rewrite them.
- **Browser-local storage only.** Saved games live in IndexedDB on Nova's main
  origin. No accounts, no cloud sync, no public catalog.
- **Trystero for all real peer-to-peer transport.** A transport-neutral interface
  (`InMemoryTransport` for the local test arena, `TrysteroTransport` for real
  parties) keeps the game-facing API identical everywhere.
- **Three game modes.** `state` (Nova-owned canonical state, actions, authority,
  migration), `simulation` (ordered inputs, shared clock, authoritative
  snapshots), and `raw` (named data channels for specialized games).

## Workspace layout

```text
/
├── apps/
│   ├── nova/                 # Main React SPA
│   └── runtime/              # Static isolated iframe runner
├── packages/
│   ├── protocol/             # Zod schemas and shared protocol types
│   ├── core/                 # Party, authority, state and simulation engines
│   ├── nova-api/             # Game-facing runtime implementation and types
│   └── testing/              # In-memory transport and reusable fixtures
├── examples/
│   └── games/                # Complete single-HTML sample games
├── docs/
│   ├── architecture/
│   ├── api/
│   └── testing/
├── package.json
├── lefthook.yml
├── .oxlintrc.json
└── .oxfmtrc.json
```

Packages are consumed as TypeScript source by the apps (via the npm workspace
protocol); Vite handles transpilation at build time. A package's `build` script
type-checks its source; apps produce real static bundles with `vite build`.

## Documentation

The docs tree is the single source of truth; every file is owned by a
canonical index or an ADR:

- `docs/architecture/` — 13 ADRs (`adr-0001`..`adr-0013`), the threat model
  (`threat-model.md`), and the deployment guide (`deployment.md`).
- `docs/api/nova-api.md` — the full game-developer API reference; the
  condensed, prompt-embedded version is `docs/api/nova-api-ai-reference.md`.
- `docs/testing/` — milestone findings and checklists, each linked from its
  owning ADR (e.g. the S4 state-mode vertical slice from ADR-0006).
- `docs/editor-cohesion-design.md` — the editor third-pass UI blueprint
  (implementation tasks; beads 9fv.10.12).
- `deploy/cloudflare.md` — Cloudflare infrastructure state + reproduction
  runbook (wrangler + documented one-time steps; no Terraform).

## Getting started

Requires Node.js >= 20 and npm (see `packageManager`).

```sh
npm install     # installs workspace, installs lefthook hooks
npm run dev     # starts all apps in parallel
npm run check   # format check + lint + typecheck + tests + build
```

Local development serves both origins over HTTP by default; the two-origin HTTPS
setup, the GitHub Pages deploy workflow, and the per-origin security policies
are documented in `docs/architecture/deployment.md` (M2 — Configure production
static deployment; nothing is published yet).

### Root scripts

| Script                                    | Purpose                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `npm run dev`                             | Run all apps in watch mode (parallel via concurrently)                      |
| `npm run dev:https`                       | Run all apps over local HTTPS (run `npm run gen-certs` first)               |
| `npm run gen-certs`                       | Generate gitignored self-signed certs for local HTTPS (optional LAN IP arg) |
| `npm run build`                           | Build all apps and packages                                                 |
| `npm run format` / `npm run format:check` | Write / verify Oxfmt formatting                                             |
| `npm run lint`                            | Oxlint over the workspace                                                   |
| `npm run typecheck`                       | `tsc --noEmit` across all apps and packages                                 |
| `npm test` / `npm run test:watch`         | Vitest unit tests (run / watch)                                             |
| `npm run test:e2e`                        | Playwright end-to-end tests (run `npx playwright install` first)            |
| `npm run bundle:size`                     | Print built bundle sizes; warn when the Nova main bundle exceeds the limit  |
| `npm run verify:deploy`                   | Verify a built origin's dist against the deployment requirements            |
| `npm run check`                           | Format check + lint + typecheck + tests + build                             |

## CI and quality gates

GitHub Actions (`.github/workflows/ci.yml`) runs the same checks as `npm run
check` from a clean checkout using `npm ci` (the committed lockfile), then
uploads the Nova and Runtime bundles as separate artifacts and runs Playwright
smoke tests (`e2e/`). Generated files (TanStack Router `routeTree.gen.ts`) are
excluded from formatting and lint via `.oxfmtrc.json` / `.oxlintrc.json`.

Dependency updates are handled by Dependabot (`.github/dependabot.yml`).

The `bundle:size` script reports built asset sizes; the Nova main JS bundle has
a documented warning threshold of 400 kB (configurable via
`NOVA_BUNDLE_LIMIT_KB`). The threshold is a warning, not a CI gate.

## Testing

- **Unit tests**: Vitest, one config per app/package, run via `npm test`.
- **End-to-end**: Playwright (`npm run test:e2e`). Install browsers once with
  `npx playwright install`.

## Security posture (summary)

Generated game HTML is untrusted and runs only in an iframe on the separate
runtime origin. The runtime has no Nova credentials, no access to main-origin
storage or DOM, and no service-worker authority over the application. All
cross-origin and peer messages are validated against versioned Zod schemas.
See `docs/architecture/` for the full threat model and ADRs.

## Current non-goals

No public game publishing or discovery, no accounts, no cloud sync, no
moderation system, no server-side game execution, no Nova-hosted AI generation,
no custom cartridge language, no Nova proxy for CDN imports or assets.
