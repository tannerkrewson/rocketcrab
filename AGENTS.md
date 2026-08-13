# AGENTS.md — instructions for AI coding agents

Working rules for this repository (Rocketcrab Nova — a party-games web app;
React + TanStack Router + daisyUI in apps/nova).

## UI rules

- **Never use the daisyUI `btn-ghost` class** (ghost buttons). Use the shared
  `Button` component's variants instead: `primary`, `secondary`, `accent`,
  `outline`, `danger`. This includes raw `className="btn btn-ghost ..."` markup
  and `variant="ghost"` — the class is banned project-wide and no automated
  check catches it, so review your own diffs. (`variant="ghost"` is also a
  compile error: the variant doesn't exist in `Button.tsx`.)
- Prefer the shared `Button` component over raw `btn` classes. For router
  `Link` elements, use `buttonStyles(...)` to keep the same look and
  touch-target size while preserving type-safe route props.
