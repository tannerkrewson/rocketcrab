# Nova simplification execution evidence (archived)

Archived from `PLAN.md` after the seven-stage product simplification. Current
backend/infrastructure work is tracked in [`BACKEND_PLAN.md`](../../BACKEND_PLAN.md);
the per-stage summaries remain in `PLAN.md` for traceability.

## Execution evidence

- Initial state: clean working tree on `nova`; existing React 19 and Tailwind 4
  baseline already satisfies HeroUI prerequisites.
- Stage 1 complete: Trystero 0.26.0, React/DOM 19.3.1, Vite 8.3.5,
  TanStack/CodeMirror/Dexie/Zod and related stable packages updated; Vitest
  patched to 4.1.12 (5.x major deferred), daisyUI left for replacement in §6.
  Root concurrently/oxfmt security updates included; newer formatter required
  mechanical changes in nine existing files. Declared actual workspace, Zod,
  nanoid and CodeMirror view imports; removed unused Zustand and core's unused
  immer/nanoid. `npm audit`: zero vulnerabilities after updates.
- Stage 1 compatibility: pre-action handshake now requires transport version 2;
  missing/older/future peers are rejected with a local update/reload notice.
  Already-shipped old clients cannot retroactively show new wording. Added
  three incompatible-version tests; shared transport contracts still pass.
- Stage 1 verification: all 1,028 unit/property tests pass, typecheck and builds
  pass; real Nostr/WebRTC Chromium integration 4/4 passes (same machine only).
  Initial JS 173.6 KiB gzip versus previous ~175, below unchanged 220 KiB budget;
  editor 210.9 KiB gzip, runtime 60.0 KiB gzip. Lint passes with existing warnings.
  Updated router tests to assert the settled live 404 node rather than a detached
  transient node. Public pinned relays still emit policy errors: §3 owns defaults.
  `verify:deploy` requires explicit origin/base arguments; no deployment attempted.
