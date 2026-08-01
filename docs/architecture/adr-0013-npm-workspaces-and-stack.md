# ADR-0013: npm workspaces and pinned stack

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owner:** Rocketcrab Nova planning (Phase 1); decision by project owner
- **Related:** F1 (scaffold), F2 (CI), `package.json`, `.npmrc`

## Context

The original plan (section 4) prescribed a **pnpm workspace**. F1 scaffolded
the repository with pnpm and committed `pnpm-lock.yaml`. After F1 landed, the
project owner decided to move to **npm workspaces** (option 2 of the reviewed
alternatives: keep the monorepo structure, swap the package manager). The
migration landed as commits `b845313` and `456e454` on `nova` and is recorded
in the Beads notes of issue F1 and the top-level epic.

This ADR records the decision so no future issue re-introduces pnpm or
re-litigates the workspace shape.

## Decision

- **Package manager: npm** with workspaces. Root `package.json` declares
  `"workspaces": ["apps/*", "packages/*"]`; `packageManager` is `npm@11.16.0`.
  The committed lockfile is `package-lock.json`; clean installs use `npm ci`.
- **Exact dependency versions.** `.npmrc` sets `save-exact=true`, and
  `package.json` files pin exact versions (no `^`/`~` ranges). The lockfile is
  committed.
- **Parallel scripts.** npm has no built-in parallel workspace runner, so
  `concurrently@10.0.4` drives `dev` and `test:watch` for the two apps
  (`npm run dev --workspace @rocketcrab/nova` + `--workspace
@rocketcrab/runtime`). Sequential workspace runs (`build`, `typecheck`,
  `test`) use `npm run <script> --workspaces --if-present`.
- **Hooks.** Lefthook installs via the root `prepare` script and runs through
  `npm exec -- ...` (the `--` separator passes flags through to the binary,
  e.g. `npm exec -- oxfmt --check {staged_files}`).
- **Stack (pinned at F1, current stable at implementation time):**

  - App foundation: React `19.2.8`, React DOM `19.2.8`, TypeScript `7.0.2`
    (strict: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
    `noFallthroughCasesInSwitch`, `noEmit`, `isolatedModules`), Vite `8.2.0`,
    TanStack Router `1.170.18` + `@tanstack/router-plugin` `1.168.23`
    (registered **before** the React plugin in `apps/nova/vite.config.ts`),
    TanStack Query `5.101.4`, Trystero `0.25.3`.
  - UI: Tailwind CSS `4.3.3` + `@tailwindcss/vite`, daisyUI `5.7.9` (loaded
    from CSS via `@plugin 'daisyui'`), `clsx` `2.1.1`, `tailwind-merge`
    `3.6.0` (single `cn(...)` helper), `lucide-react` `1.28.0`, `sonner`
    `2.0.7`, `qrcode.react` `4.2.0`.
  - Data/validation: `zod` `4.4.3`, `dexie` `4.4.4`, `zustand` `5.0.14`,
    `immer` `11.1.15`, `nanoid` `6.0.0`, Web Crypto (platform, no package).
  - Editor: `@uiw/react-codemirror` `4.25.11`, `@codemirror/lang-html`
    `6.4.11`.
  - Quality: `oxlint` `1.76.0`, `oxfmt` `0.61.0`, `lefthook` `2.1.10`,
    `vitest` `4.1.10`, React Testing Library `16.3.2` +
    `@testing-library/jest-dom` `7.0.0` + `@testing-library/user-event`
    `14.6.1`, Playwright `1.62.1`, `fake-indexeddb` `6.2.5`, `fast-check`
    `4.9.0`.
  - Dev ports: `apps/nova` on 5173, `apps/runtime` on 5174.

- **Generated files.** TanStack Router's generated `routeTree.gen.ts` is
  excluded from formatting and linting (`.oxfmtrc.json`, `.oxlintrc.json`).

## Alternatives considered

1. **pnpm workspace (as originally planned).** Rejected by the project owner
   after F1; pnpm's strict `node_modules` and extra configuration were not
   worth the friction for this project size.
2. **Single package, two Vite builds (no workspace).** Reviewed and rejected
   for now: keeping `apps/*` and `packages/*` boundaries preserves the plan's
   package API boundaries and independent tests; see the tradeoff below.
3. **Yarn / Bun workspaces.** Not chosen; no project-specific reason.

## Tradeoffs

- **Hoisting vs. strictness.** npm hoists dependencies to the root
  `node_modules`; a package could technically import a transitive dependency
  it never declared, which pnpm's strict layout would have prevented. Nova
  compensates with package-boundary discipline: each workspace declares its
  own dependencies, and oxlint rules (to be added where needed, e.g. for the
  Trystero adapter boundary in P1) enforce cross-boundary import restrictions.
- **No built-in parallel runner.** `concurrently` adds one small dev
  dependency in exchange for parallel dev/test-watch behavior.
- **Lockfile churn.** Moving from `pnpm-lock.yaml` to `package-lock.json`
  changed CI expectations; F2 is updated to use `npm ci` and
  `actions/setup-node` with `cache: npm`.

## Consequences

- All future issues, CI (F2), and local development use **npm** — never pnpm.
- Committing the lockfile is required; `npm ci` enforces lockfile/package.json
  consistency.
- The package boundaries that matter for trust (protocol validation, Trystero
  isolation) are enforced by declared dependencies plus lint rules rather than
  by the package manager's strictness; P1 must add the Trystero-restriction
  lint rule.
