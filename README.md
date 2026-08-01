# Rocketcrab Nova

Rocketcrab Nova is a static, mobile-first web application for creating, testing,
saving, and playing user-generated multiplayer browser games.

A user copies one master prompt into their preferred AI chat service, is
interviewed by that chatbot about the game they want, receives one complete HTML
document in one code block, pastes it into Nova, tests several simulated players
on one page, saves the game in their browser, creates a party with a four-letter
code, and plays through a Nova-managed peer-to-peer session.

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

## Getting started

Requires Node.js >= 20 and npm (see `packageManager`).

```sh
npm install     # installs workspace, installs lefthook hooks
npm run dev     # starts all apps in parallel
npm run check   # format check + lint + typecheck + tests + build
```

Local development serves both origins over HTTP by default; the two-origin HTTPS
setup required for production runtime isolation is documented in
`docs/architecture/` (see M2 — Configure production static deployment).

### Root scripts

| Script                                    | Purpose                                                          |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `npm run dev`                             | Run all apps in watch mode (parallel via concurrently)           |
| `npm run build`                           | Build all apps and packages                                      |
| `npm run format` / `npm run format:check` | Write / verify Oxfmt formatting                                  |
| `npm run lint`                            | Oxlint over the workspace                                        |
| `npm run typecheck`                       | `tsc --noEmit` across all apps and packages                      |
| `npm test` / `npm run test:watch`         | Vitest unit tests (run / watch)                                  |
| `npm run test:e2e`                        | Playwright end-to-end tests (run `npx playwright install` first) |
| `npm run check`                           | Format check + lint + typecheck + tests + build                  |

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
