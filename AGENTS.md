## Philosophy

- It is essential that the codebase has a simple, yet robust and performant architecture.
- Make the UI and UX simple, cohesive, seamless, intuitive, and beautiful.
- It is also essential that users have a fast, seamless experience, no matter what device types (desktop PCs, iPhone browsers, etc) and networks (wifi, 5g, corporate, school, etc) they are using. If the device types or networks limit the experience in a way that is out of our control, the users should be provided with a transparent and easy-to-understand error experience.
- Prefer clean fixes at the source. Pursue refactors that simplify the architecture and make it more robust, even when the work is substantial.
- Always prefer built-in functionality from existing libraries or mature, popular, battle-tested, and robust open-source libraries over writing custom logic.

## Planning

- Don't write architecture/design docs. Explain context with succinct inline code comments, only where truly necessary.
- Don't create a CLAUDE.md; this file is the single agent instructions file.
- Prefer to use the PLAN.md file in the repo root for large improvements or refactors.
- Commit to the plan file as you go. Remove finished and redundant parts of it as you work.
- If any of the PLAN.md happens to be outdated, not fit within the philosophy outlined in this document, you don't agree with the plan, or you have better ideas, feel free to pivot and change the plan as you go, as long as it fits the philosophy.
- As you work through the codebase, stay alert for issues, concerns, or insights you uncover, even if unrelated to the current task. Record anything worth revisiting in the PLAN and bring it to the user's attention at the end of the conversation.
- Ensure that items in the plan are comprehensive enough to be built by an AI without needing context that only existed when the plan was written. But, don't add obvious and unnecessary language to the plan either; keep it succinct.

## Testing

- Avoid running test suites that are slow. Prefer to run slow tests when they provide good "value" for the time spent, ie. running the individual e2e tests relevant to the change.
- Constantly evaluate whether tests run efficiently and are valuable, and improve them if they are not alongside your work.

## UI rules

- **Never use HeroUI's `ghost` button variant** (ghost buttons). Use the shared
  `Button` component's variants instead: `primary`, `secondary`, `tertiary`,
  `accent`, `outline`, `danger`. This includes raw HeroUI `button--ghost`
  classes and any `variant="ghost"` — the variant is banned project-wide and no
  automated check catches it, so review your own diffs. (`variant="ghost"` is
  also a compile error: the variant doesn't exist in `Button.tsx`.)
- Prefer the shared `Button` component over raw `btn` classes. For router
  `Link` elements, use `buttonStyles(...)` to keep the same look and
  touch-target size while preserving type-safe route props.
- Never use all caps in the UI.
- Do not set custom letter spacing or kerning.
