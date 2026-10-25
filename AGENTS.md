# AGENTS.md — instructions for AI coding agents

Working rules for this repository (Rocketcrab Nova — a party-games web app;
React + TanStack Router + HeroUI v3 in apps/nova).

## Work tracking

- Use root `PLAN.md` for remaining work, owner decisions, and release gates.
- Update its checklists and evidence when work is completed or new blockers appear.

## UI rules

- **Never use HeroUI's `ghost` button variant** (ghost buttons). Use the shared
  `Button` component's variants instead: `primary`, `secondary`, `tertiary`,
  `accent`, `outline`, `danger`. This includes raw HeroUI `button--ghost`
  classes and any `variant="ghost"` — the variant is banned project-wide and no
  automated check catches it, so review your own diffs. (`variant="ghost"` is
  also a compile error: the variant doesn't exist in `Button.tsx`.)
- Prefer HeroUI components (`Button`, `Card`, `Alert`, `Badge`, `Modal`,
  `Tabs`, `Toast`, `Spinner`) over raw markup; Tailwind utilities are fine for
  layout. Never add a second component library.
- Prefer the shared `Button` component over raw `btn` classes. For router
  `Link` elements, use `buttonStyles(...)` to keep the same look and
  touch-target size while preserving type-safe route props.

## Docs ownership

- Every file under `docs/` must be reachable from a canonical index or an
  owning ADR: the ADRs in `docs/architecture/` are self-owning, the
  README's Documentation section is the top-level index, and
  milestone/findings docs are linked from their owning ADR (e.g. ADR-0006
  → the S4 vertical slice).
- New docs need an owner link at creation time. Unreferenced docs get
  linked or deleted — never orphaned.
- Cloudflare infrastructure state and the recreate-without-Terraform
  runbook live in `deploy/cloudflare.md`. Record every infra change there
  (dashboard/MCP edits included); CI workflows are the deploy source of
  truth.
