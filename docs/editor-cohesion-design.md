# Editor cohesion design — third-pass polish

Status: design for implementation (beads 9fv.10.12). Read `AGENTS.md` first (no
`btn-ghost`; use `Button`/`buttonStyles` for links).

## OPEN QUESTIONS

1. **Logo mark.** There is no vector logo asset in the repo; the app's identity
   everywhere (home, party shell) is the `🦀🚀` emoji pair. Recommendation:
   reuse `🦀🚀` at `text-2xl` in the chrome zone (zero assets, consistent).
   If a real SVG mark exists or is commissioned later, it drops into the same
   slot. Treat this as the default unless brand input says otherwise.
2. **Re-test cadence.** The arena boots N real runtime frames; re-testing on
   every keystroke is too heavy. Decision: the arena runs the source frozen at
   mount/save; the **Run** button re-applies the current source (existing
   `actions.replaceSource` path). A "Editor changed — press Run to re-test"
   badge covers the gap. (Not blocking; noted for explicitness.)

## Target layout map

Page flows vertically inside the existing `AppLayout` column (`max-w-5xl`,
footer below — the editor page currently locks its own height, which is exactly
the "cut-off iframe window" bug; that lock goes away).

```
┌──────────────────────────────────────────────────────────────┐
│ CHROME  [🦀🚀]  [← My games]  [Game title ▾ click-to-edit]   │   identity + orientation
│                    [bytes · unsaved changes]           [Copy  │
│                     prompt ▾]                                │
│ ACTIONS [Paste] [Clear all] [Reset]       [Save copy] [Save] │   the verbs; Run is primary
│         [Run] [Play with friends]                            │
│ EDITOR  CodeMirror strip (default ~22vh)                    │   the instrument
│         ──── drag handle / collapse ────                     │
│ ARENA   header + summary + toolbar + player grid             │   the stage — always live,
│         (flows in the page, never overflow-y-auto)           │   largest area, the star
│                                                              │
│ (AppLayout footer: site links + theme picker)                │
└──────────────────────────────────────────────────────────────┘
```

Visual hierarchy: chrome row is thin and calm (identity + "where am I"); the
actions row is the verb row; the editor is a compact instrument you pull open
when writing code; the arena is the stage — it is what you're making, it is
live by default, and it gets the most space. One Run button means "apply my
code to the stage and re-test". Nothing else on the page competes with the
stage.

Mobile (`<md`): keep the existing phone prompt, the Code/Errors tabs (Preview
tab removed), the arena below the tabs, and the sticky action bar (minus the
"Test" button).

## How the six changes land

1. **Arena active by default** — `ArenaSection` is always mounted and seeded
   with the initial/saved source; the "Press Test multiplayer" EmptyState CTA
   and the `onClose`/Close flow are gone. The cut-off window is killed by
   removing `md:h-[calc(100dvh-16rem)]` from the page wrapper and
   `md:flex-1 md:overflow-y-auto` from the arena wrapper: the arena grid flows
   in normal document flow and the page scrolls like every other Nova page.
   Player frames keep the shared drag-resize (default ~45vh). **Preview is
   removed** as a visible panel, but the single-player runtime session stays
   mounted into a **visually hidden container** purely as the diagnostics /
   mode-detection / saved-source-test-metadata engine — `DiagnosticsPanel`,
   `registration`, and `recordTestResults` keep working with zero internal
   changes. `FirstRunTutorial` copy updates (step 2/3: "Run applies your code
   to the live test arena").
2. **Logo mark** — `🦀🚀` at `text-2xl`, `aria-hidden`, top-left of the chrome
   row, wrapped in `Link to="/"` (doubles as back-to-home). No text.
3. **Click-to-edit title** — replace the always-visible `<input>` with a
   display element (`<button>`-like heading, pencil hint on hover) showing
   `title || registration?.title || "Untitled game"`; clicking swaps in an
   autofocused, select-all `<input>` (maxLength 64, `aria-label="Game title"`);
   Enter/blur commits, Escape cancels. Keeps the existing `title` state and
   `dirty` computation untouched. Bytes + unsaved-changes indicator stay in the
   chrome row, right-aligned.
4. **Prompt export** — a "Copy prompt" outline button with a small dropdown
   (daisyUI `dropdown dropdown-end` + `menu`) offering **Master prompt**
   (`buildMasterPrompt()` verbatim) and **Prompt + my game** (new
   `buildMasterPromptWithGame(source, title?)`). Copy via `writeToClipboard` +
   toast, exactly like the Build page. Lives at the end of the actions row.
5. **Dark code editor** — see "Theming" below. Built-in `theme="dark"|"light"`
   on `@uiw/react-codemirror` (no new dependency) + a small
   `EditorView.theme` extension mapping surfaces to daisyUI CSS variables so
   the editor blends with whichever of the 35 themes is active.
6. **Nicer back link** — `Link to="/library"` with `buttonStyles("outline")`,
   `ArrowLeft` icon, label "My games" (matches the library page's own heading).
   Never `btn-link`/`btn-ghost`.

## Theming (dark code editor)

- New `useIsDarkTheme()` hook: `currentThemeMode()` on mount, subscribed to
  `prefers-color-scheme` changes **and** a MutationObserver on
  `document.documentElement`'s `data-theme` attribute (the footer theme picker
  flips it without reloading).
- `CodeEditor`: `theme={isDark ? "dark" : "light"}` (built into
  `@uiw/react-codemirror` — its `theme` prop accepts `'light' | 'dark'`) plus
  an `EditorView.theme` extension that maps to daisyUI variables:
  - root: `backgroundColor: var(--color-base-100)`, `color: var(--color-base-content)`
  - `.cm-gutters`: `backgroundColor: var(--color-base-200)`
  - active line: `backgroundColor: var(--color-base-200)`
  - pass `{ dark: true }` in the dark branch so CodeMirror's base contrast
    (selection, cursor) flips too.
- CSS variables live on `:root` under `data-theme`, so the editor re-themes
  automatically on theme switch — no extra state.
- Verify: `nova`, `nova-dark`, plus a couple of daisyUI darks (`dark`, `dim`,
  `night`, `dracula`). The bug today is CodeMirror's own white background, not
  the panel (`bg-base-100` already tracks the theme).

## Components: repurposed / removed / added

**Repurposed (modified in place)**

- `EditorPage.tsx` — chrome row, hidden diagnostics container, always-mounted
  arena, Run re-applies source, prompt menu, title editor.
- `ArenaSection.tsx` — always mounted; drop the `state === null` EmptyState
  branch and the Close button (keep header/summary/toolbar/grid/resize).
- `CodeEditor.tsx` — dark-theme support (above).
- `lib/prompt/master-prompt.ts` — add `buildMasterPromptWithGame`; do **not**
  touch `buildMasterPrompt` (its snapshot test pins it).
- `FirstRunTutorial.tsx` — copy tweak only.
- `useRuntimeSession` — same hook, container ref now points at a hidden div.

**Removed**

- `PreviewPanel.tsx` (+ `PreviewPanel.test.tsx`) — its only consumer is
  `EditorPage`.
- The "Test multiplayer" buttons (desktop actions + mobile bar) and the arena
  EmptyState CTA.
- The title `<input>`; the `btn btn-link` back link.
- The viewport-locked height wrapper and the arena's inner `overflow-y-auto`.

**Added**

- `EditorChrome.tsx` (or inline in `EditorPage`): logo + back link +
  click-to-edit title + bytes/dirty indicators.
- `PromptExportMenu.tsx`: dropdown with the two copy actions.
- `useIsDarkTheme()` in `lib/theme.ts` (or a small `lib/use-is-dark-theme.ts`).
- `buildMasterPromptWithGame(html, title?)` export.

**Test impact the tasks must carry**

- `EditorPage.test.tsx`: preview-tab test becomes Code/Errors; the two
  "test-multiplayer" tests become "arena mounts by default / Run gates on
  validation"; title input tests → click-to-edit.
- `ArenaSection.test.tsx`: EmptyState/Close expectations.
- `e2e/arena-s4.spec.ts` `openArenaWithFourPlayers`: drop the Test-multiplayer
  click (arena is visible on load; the seeded draft already runs it).

## Implementation task directives

**Task 1 — arena-default-on**

- Seed `arenaSource` with `savedSource` on mount and on game re-init; delete
  `handleTestMultiplayer`; make `handleRun` also `setArenaSource(source)`.
- Always mount `ArenaSection` (no null branch, no `onClose`).
- Remove the viewport-locked wrapper + arena `overflow-y-auto`; let the page
  scroll. Keep the frame drag-resize.
- Point the runtime session's container ref at one `hidden`/size-0 div;
  remove the mobile preview ref/tab.
- Keep the `stale` badge wording "Editor changed — press Run to re-test".
- Update the unit + e2e tests listed above.

**Task 2 — chrome (logo / title / back)**

- One chrome row: logo (`Link to="/"`), back link
  (`buttonStyles("outline")` + `ArrowLeft` + "My games" → `/library`),
  click-to-edit title, right-aligned bytes + dirty indicator.
- Title editor: display state + inline `<input>` swap, Enter/blur commit,
  Escape cancel, select-all on focus, maxLength 64.
- Keep the actions row as its own line; only remove the Test-multiplayer button.
- No `btn-ghost`, no `btn-link`, no raw `btn` classes on links.

**Task 3 — prompt export**

- Add `buildMasterPromptWithGame(html, title?)`: `buildMasterPrompt()` +
  `## Your existing game` section (title line when given, then a fenced
  `html` block with the source) + one sentence telling the AI to continue and
  improve this exact game instead of re-interviewing. `buildMasterPrompt`
  stays byte-identical (snapshot test).
- `PromptExportMenu`: outline `Button` "Copy prompt" (`ScrollText` icon),
  `dropdown dropdown-end` with two `menu` items; `writeToClipboard` + toast
  (Build-page pattern: success "…copied", error fallback message).
- Place at the end of the actions row; "Prompt + my game" embeds whatever is
  currently in the editor (empty source → still copies the raw prompt).

**Task 4 — dark-theme code editor**

- `useIsDarkTheme()` hook (matchMedia + `data-theme` MutationObserver).
- `CodeEditor`: `theme={isDark ? "dark" : "light"}` + the CSS-variable
  `EditorView.theme` extension described above (`{ dark: true }` branch).
- Verify nova/dark + several daisyUI dark themes; no new dependencies.
