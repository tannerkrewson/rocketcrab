# Nova simplification execution evidence (archived)

Archived from `PLAN.md` after the seven-stage product simplification.
Remaining work is tracked in [`PLAN.md`](../../PLAN.md).

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

## Completed program record (moved from PLAN.md, 2026-11-12)

### Authorized simplification program — active execution plan

Work directly on `nova`, without subagents. Complete the following stages in
order; commit verified sections, update evidence here, then reread the next
section before continuing. Stop for owner clarification when necessary. No
infrastructure deployment or creation of billable resources is authorized.
Historical backlog below remains release evidence, not a requirement to preserve
obsolete architecture. This program supersedes four-letter/admission/greeter UI
and old theme work; keep physical-device and deployment gates explicit.

### 1. Dependency baseline

- [x] Review Trystero 0.25.3 → latest stable (at least 0.26.0): Nostr,
      reconnection, ICE, resource handling, transfers, and changed action wire
      format. Give incompatible clients a clear update/reload outcome.
- [x] Update relevant stable dependencies without unrelated complex major
      migrations; declare actual imports, remove unused Zustand/dependencies,
      update lockfile. Preserve behavior and prepare for React 19/Tailwind 4.
- [x] Run tests, typecheck, production builds, bundle-size checks; record
      removals/additions, significant deferred upgrades, and remaining risks.

### 2. Private invites replace discovery and admission

**Owner decision:** transfer shell controls to one deterministically selected
remaining participant when the creator leaves, separately from game authority.
Classic external iframe provider host roles do not generically migrate. Continue
without questions unless an urgent blocker requires owner input.

- [x] Generate one cryptographically secure high-entropy party secret in the
      fragment. Use Trystero room discovery/password; automatic joining, native
      sharing, copy fallback, displayed QR (no scanner, accounts, or approval).
- [x] Remove codes, adverts/rendezvous, discovery timers/collisions, greeter and
      migration, manual admission, and obsolete UI/protocol/tests/docs.
- [x] Preserve joinability while any participant remains, verified late-join
      HTML/state, returning identity/state, and end-on-empty. Never expose secrets
      in paths, queries, logs, or game frames. Explain reusable-invite kick limits.
- [x] Verify lifecycle/security/integration cases and commit with evidence.

Stage 2 evidence: replaced ~1,465-line rendezvous module with one private-room
session; removed code generation/routes, adverts, admission, greeter, approval UI,
phonetic/short-link UI and their obsolete tests/schemas. Original creator context
and current membership determine the shell host; sender/session checks protect
control routing. Host/authority are separate; classic provider host roles do not
migrate. All invite holders can rejoin after cooperative removal (UI explains it).
Fixed received-source caching to retain full metadata/current selection so any
remaining verified holder serves late joiners. Tests cover creator departure,
source delivery and successor selection, identity recovery, stale invites, invalid
and spoofed controls, and cleanup. Updated ADRs/threat model/README/device gates.

Verification: 961 unit/property tests; typecheck, format, production builds and
bundle check pass; initial JS 168.9 KiB gzip (220 KiB budget unchanged). Real
Nostr/WebRTC suite 4/4 passes on one machine. App Playwright: 41 host tests passed;
19 WebKit launch failures were missing Fedora system libraries, not app failures;
WebKit rerun in the existing Playwright Podman image: 20/20 passed. No deployment
or physical-device proof. Native-share/copy/QR behavior is unit-tested; full
multi-hour cross-network/device acceptance remains gated.

### 3. Thin Trystero adapter and source transfer

- [x] Replace duplicated chunking/throttling/ACKs/request-response/progress/
      retries/recovery with Trystero built-ins where simpler; prefer maintained
      relay defaults unless evidence requires overrides.
- [x] Preserve 2 MiB limit, hash verification and verified-acceptance confirmation,
      validation/resource bounds, action IDs/dedup/revisions/authority ordering,
      and in-memory/real transport parity. No generic reliability layer.
- [x] Test large/rejected/corrupt/slow/disconnected/reconnecting transfers;
      document custom mechanisms retained and why; commit evidence.

Stage 3 evidence: replaced Nova's source framing (64 KiB chunk messages,
chunk indices, per-chunk ACKs, retry counts/backoff, cancel-message protocol,
recovery bookkeeping) with one Trystero binary request response per source.
`NovaTransport` gained `request`/`handleRequest`; the adapter maps them to
Trystero request actions (correlation, fragmentation, backpressure, progress,
timeout, receive admission, rejection, disconnect, abort) with 8 MiB shared
receive reservations, a 16 KiB request limit, and per-request 2 MiB response
admission. The in-memory counterpart reuses the hub's existing fault-injected
delivery/chunk/progress path and adds no production reliability layer; both run
the same contract scenarios.

Retained deliberately: 2 MiB hard limit and soft warning, exact UTF-8 byte count
and SHA-256 verification, bounded eight-document verified cache, runtime
compatibility checks, envelope/session/member validation, and one
`game.source.accepted` application decision — transport delivery is not
verified acceptance, and only validated HTML may open a start gate. Sender UI
now reports transfer start plus acceptance (Trystero exposes no
response-send progress callback). Cancellation aborts locally and suppresses
stale completions; no custom remote-cancel or negative-ACK loop was re-added.
Metadata/discovery remain small schema-validated shell controls; source traffic
never reaches game frames. `chunkCount`, the chunk/ack/cancel/request schemas and
their tests were deleted. `TRANSPORT_VERSION` bumped to 4 so pre-stage-3 clients
are rejected before acting.

Relays: pinned probe-era `GOOD_RELAYS`/redundancy defaults removed in favour of
Trystero 0.26 maintained defaults; explicit operator overrides remain. The F5
pin was stale (its own later re-probe recommended a different list) and the probe
spec now compares upstream defaults with the previously healthy four.

Verification: 977 unit/property tests; typecheck, format, lint (pre-existing
warnings only), production builds and bundle check pass; initial JS 167.8 KiB
gzip (220 KiB budget unchanged). In-memory suite covers 2 MiB byte-exact transfer,
progress, empty/BOM/multi-byte sources, wrong hash/size/length/encoding/type,
unavailable and oversized requests, dedup, slow cancellation, disconnect and
reconnect, cached re-acceptance, late-joiner service after creator departure,
cache cap, spoofed envelopes, cross-room isolation, and dispose. Real Chromium
Nostr/WebRTC suite 4/4 passes, including a verified 2 MiB source over public
relays with maintained defaults. App Playwright: Chromium+Firefox 40/40, WebKit
20/20 in the Playwright Podman image (one unrelated runtime-diagnostics test was
flaky once under 3 parallel workers; 3/3 isolated and 20/20 on full rerun).
Remaining risk: no physical-device, cross-network TURN or multi-hour proof;
maintained relay defaults were re-validated on this machine only. No deployment.

### 4. TURN reliability, security, and cost

- [x] Recheck Cloudflare documented allocation/expiry behavior; choose lifecycle
      for multi-hour sessions and reconnects instead of unproven refresh machinery.
- [x] Keep server secrets; review native issuance rate limiting, usage visibility,
      abuse response, budget notifications (not spending caps), and aggregate/raw
      traffic limits. Issuance limits do not bound already-issued traffic.
- [x] Prefer direct ICE, retain appropriate TURN transports including TLS 443;
      simplify Worker/watchdog without a framework or room backend.
- [x] Test failures, document operational risks/runbook changes; do not deploy.

Stage 4 evidence: Cloudflare's current FAQ documents **no maximum TURN
allocation duration** (the client keeps the allocation alive with authenticated
TURN Refresh requests) and a **48-hour maximum credential expiry**. Billing and
analytics stop immediately when credentials expire; the connection disconnects
shortly after. Nova therefore replaces the 600 s TTL + 8-minute
`setConfiguration()` re-mint path (which could not be validated on devices and
which Trystero cannot pair with an ICE restart) with **one 24-hour credential
per party**: the worker always requests `ttl: 86400` (request bodies ignored),
the client mints once per party lease and never refreshes or mutates live peer
connections, and the adapter lost `updateTurnConfig`/peer-config mutation and
token-copy refresh helpers. Reconnects reuse the cached lease; a new party after
lease expiry mints again. Credentials remain memory-only; a leaked credential
can relay for up to 24 hours, which is the explicit trade for removing
unverifiable machinery.

Cost/abuse changes: deleted the custom GraphQL watchdog, its daily cron, three
Worker secrets (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
`ALERT_WEBHOOK_URL`), its KV alert watermarks and the `WATCHDOG_GB_BUDGET`
input — native Cloudflare **budget alerts** and **Billable Usage
notifications/metrics** now provide spend visibility, while Workers Logs keep
per-mint `turn_cred_mint` records. The origin allowlist, rate limiting and
port-53 filtering remain; the KV issuance caps were later removed in the
pre-deployment hardening because KV cannot enforce them atomically. The runbook
states explicitly that issuance controls cannot bound traffic from issued
credentials, and documents the manual credential-revoke API,
Cloudflare's per-allocation limits (~5–10 kpps, 50–100 Mbps, >5 new
destination IPs/sec) and $0.05/GB egress. Cloudflare's native Workers
rate-limiting binding was reviewed and rejected for the issuance counter
(per-location approximate, still issuance-only, extra provider binding).
TURN keeps the full documented URL set including `turns:…:5349|443`; direct
ICE remains preferred by candidate priority.

Verification: 977 unit/property tests plus **87 infrastructure worker tests**
(now run in CI via `npm run test:deploy`: relay 37 + turn-creds 50); typecheck,
format, lint, production build and bundle check pass; initial JS 167.2 KiB gzip
(220 KiB budget unchanged). New tests cover the fixed 24 h TTL (and its 48 h
ceiling), lease reuse across leave/recreate, re-mint only after lease expiry, and
no live-peer mutation API. Wrangler `deploy --dry-run` bundles the worker
(3.82 KiB gzip) with only the KV binding. Chromium app Playwright 20/20 and real
Nostr/WebRTC 4/4 pass. OpenTofu was not installed here, so HCL changes
(resource/output/cron removal) are unvalidated locally; CI validates them. No
deployment, no live mint, and no physical-device/cross-network TURN proof.

### 5. Multiplayer resilience simplification

- [x] Review party/state/simulation engines, membership, heartbeat/grace/reconnect
      timers, reload/Safari recovery, elections/migration, split-brain and errors.
- [x] Consolidate redundant mechanisms without weakening serial authority, IDs,
      dedup, revision/snapshot validity, private views, catch-up, migration,
      ordered simulation inputs/restoration. Keep game-facing APIs unchanged.
- [x] Review term/revision/hash voting conservatively: pause/recover rather than
      accept conflicting histories; no CRDT/state-machine framework.
- [x] Strengthen authority-loss/partition/stale-action/reconnect/Safari/late-join
      tests; record simplifications and remaining protections; commit.

Stage 5 evidence: reviewed the party shell (`apps/nova/src/lib/party/engine.ts`),
the authoritative state engine (`packages/nova-api/src/state-engine.ts`), the
simulation engine, session dispatch/restore buffering, and the arena harness
against the existing authority-loss/partition/migration suites. The protocol
already keeps each protection distinct (history dedup + queued-redelivery dedup +
per-actor `seq`; term gates; revision/hash conflict votes; restore window;
action buffering and re-send after migration), so nothing was removed there.

Consolidations:

- **One reconnect primitive.** The shell's reconnect path called
  `suspend()` then `resume()` for a live-but-silent link (F11). It now calls the
  transport's contracted `reconnect()` (fresh connection id, peers observe
  leave+join), keeping `resume()` only for an already-suspended transport and
  `join()` for a torn-down room. Covers both real and in-memory transports.
- **Single-flight reconnect.** Duplicate lifecycle events, retry timers and user
  taps used to start overlapping attempts. `reconnect()` now shares one
  in-flight promise and the attempt counter increments once.
- **Single-flight resume probe.** `visibilitychange` and `pageshow` both fire on
  resume; the F11 health probe ran twice and issued two reconnects. A
  `resumeCheckInFlight` guard runs one probe per resume.
- **Dead state removed.** The party engine's `offline` flag was written in four
  places and never read; removed.
- **One authority-claim gate.** `handleAnnounce`, `handleHeartbeat`,
  `handleElection` and snapshots repeated the same stale-term/disconnected-claim
  checks and `adoptTerm` + `authorityStateRevision` update. Extracted
  `acceptsAuthorityClaim`/`adoptHigherTerm` used by announce, heartbeat and
  election; snapshot-specific adoption semantics are unchanged.

Retained deliberately (no CRDT/state-machine framework, no game-facing API
change): serial authority with term/revision ordering, deterministic lowest-member
election, grace/heartbeat/restore/winner-wait timers, same-revision hash voting
that keeps local state and converges by snapshot push, `authorityStateRevision`,
processed-action history and ack replay, dispatch buffering during elections and
re-send on authority change, ordered simulation inputs/restoration, bounded
snapshots and action payloads, private views and catch-up, and the reload/Safari
recovery path.

Verification: 979 unit/property tests (496 nova app, 146 nova-api, plus packages),
87 infrastructure worker tests; typecheck, format, lint, production build and
bundle check pass; initial JS 167.3 KiB gzip (220 KiB budget unchanged). New
tests assert the single reconnect primitive is used for a silent link, concurrent
`reconnect()` calls share one attempt, and disconnected/stale heartbeat,
election and announce claims are ignored while a connected higher term adopts.
Existing suites already cover silent partitions converging on one authority,
authority suspension/rejoin as follower, migration without double commits,
buffered actions during restore, stale/timed-out/duplicate actions, and Safari
background/resume. Chromium app Playwright 20/20 and real Nostr/WebRTC 4/4 pass.
Remaining risk unchanged: no physical-device multi-hour proof.

### 6. HeroUI v3 full replacement

- [x] Follow current official HeroUI v3 docs (React 19+, Tailwind 4, React/styles
      packages, CSS setup, no legacy provider/plugin). Use standard components
      and light/dark styling, not recreation of bespoke Nova visuals.
- [x] Migrate party/lobby/game shell, browser/details, editor/arena, navigation,
      dialogs/menus/popovers/forms/notifications/theme controls. Retain CodeMirror,
      runtime isolation, emergency leave, responsive/accessibility/Safari behavior.
- [x] Remove daisyUI, obsolete theme/config/CSS/custom UI abstractions; no competing
      UI library. Simplify component composition and custom styling aggressively.
- [x] Verify accessibility/mobile behavior, tests/build/bundle. Report material
      budget tradeoffs rather than silently raising limits; commit evidence.

Stage 6 evidence: installed **HeroUI v3.2.6** (`@heroui/react`,
`@heroui/styles`, `tailwind-variants`) and removed **daisyUI 5.7.9** and
**sonner 2.0.8**. `styles.css` now imports Tailwind then HeroUI, keeps only Nova
brand tokens (rocket red, signal blue, fonts) and the app's own utilities; the
daisyUI plugin, its 35-theme catalogue and all `--color-base-*` theming are gone.
`lib/theme.ts` is now light/dark/system (`.dark` + `data-theme`), and the theme
control is three accessible icon buttons instead of the light/dark/dice
selector.

Migrated components: shared `Button` (HeroUI variants; `buttonStyles` emits the
same BEM classes for router links), `Card`, `Dialog` (React Aria modal with focus
trap/Escape/backdrop dismissal), `ErrorPanel`/status banners (`Alert`), `Badge`
(`Chip`), `Tabs` (game details), `Spinner`, and HeroUI toast (`Toast.Provider`)
through a single `lib/toast.ts` seam. Native inputs/selects/ranges use HeroUI's
field classes/tokens; menus, collapsible panels and tab bars use HeroUI tokens
plus Tailwind utilities. No daisyUI class names, `@plugin`, theme catalogue,
sonner, or competing component library remain in `apps/nova/src`.

Verification: **485 nova app tests** (968 unit/property total) and **87
infrastructure worker tests** pass; typecheck, format, lint, production build and
bundle check pass; `npm audit` reports 0 vulnerabilities. Playwright app suite
**20/20 in Chromium, Firefox and WebKit** (WebKit in the Playwright Podman image).
One stale Vite dep-optimizer cache produced misleading browser failures locally;
restarting the dev server cleared it. CodeMirror still receives the theme through
its own extension now mapped to `--surface`/`--foreground`.

Budget tradeoff (reported, not silently raised): initial JS rose from **167.3 to
205.9 KiB gzip** (+38.6, +23%) and CSS from 31.0 to **45.9 KiB gzip** because
HeroUI ships React Aria + component CSS. The documented **220 KiB initial-JS
budget is unchanged** and still passes with 14.1 KiB headroom; the editor chunk
is 212.0 KiB gzip. If headroom becomes a problem, the next lever is importing
only the HeroUI components used (tree-shaking is already in effect) before any
budget change. Remaining risk: no physical-device Mobile Safari pass this stage;
keyboard focus traps and icon-button labels are covered by tests and React Aria,
but the full device checklist is still a release gate.

### 7. Final focused cleanup

- [x] Review use-party/use-arena/runtime-session subscriptions for
      useSyncExternalStore with stable subscriptions and immutable cached snapshots.
- [x] Review Dexie useLiveQuery for local saved games/cross-tab consistency; retain
      TanStack Query only where useful. Remove stale dependencies/utilities/docs
      and infrastructure made obsolete by preceding stages, not another rewrite.
- [x] Verify local library/editing, party lifecycle and arena; run final relevant
      tests/typecheck/build/bundle checks and summarize unresolved release gates.

Stage 7 evidence: `usePartyEngine` now uses **`useSyncExternalStore`** with a
stable subscribe callback and a snapshot ref updated only by engine emissions,
so repeated renders reuse the same state object (new test asserts stable
identity, one subscription, and update propagation). `PartyEngine` keeps its
`onState` API for tests/non-React consumers; no engine internals changed. The
arena hook intentionally keeps its effect-scoped `useState` subscription: its
engine is created and disposed per mount, so there is no stable store to hand to
`useSyncExternalStore` without restructuring the mount lifecycle; runtime-frame
events are already colocated in that engine. No redundant global store was added.

Local saved games stay on **TanStack Query** over the Dexie repository. Every
mutation invalidates the list/detail queries and the browser default
`refetchOnWindowFocus` refreshes a tab after another tab edits, so a
`dexie-react-hooks` dependency and a second cache layer were not added; this
decision and its cross-tab limitation are documented beside the hooks.

Cleanup: removed an unused `cn` import and all remaining lint warnings (unused
runtime protocol type imports, an unused test variable, unused classic test
helper, an unnecessary spread in the in-memory peer sync, unused raw-progress
type). Updated remaining stale “greeter” documentation to shell-host
succession (ADR-0007, ADR-0012, Mobile Safari checklist, diagnostics comments)
and marked the old editor-cohesion design doc as historical. No source modules
are unused; obsolete probe scripts were removed, with their results archived in
the testing/findings docs.

Final verification: **970 unit/property tests** (487 app, 146 nova-api, plus
packages) and **87 infrastructure worker tests** pass; format, lint, typecheck,
production build and bundle check pass; `npm audit` 0 vulnerabilities. Initial
JS **205.9 KiB gzip** (unchanged 220 KiB budget), editor 212.0 KiB, CSS 45.9
KiB. Playwright: Chromium + Firefox 40/40, WebKit 20/20 (Playwright Podman
image). The heavy four-player arena S4 spec flaked once while Chromium and
Firefox ran together under load and passed isolated (3.7 s); it also passed in
the stage-6 full runs.

Unresolved release gates (unchanged): physical-device Mobile Safari pass and
the full device checklist; cross-network TURN with the deployed mint; a
multi-hour party on one 24 h credential; human friend beta; deployment and live
infrastructure verification (no deployment or billable resource was created).
The HeroUI migration adds ~38.6 KiB gzip to the initial JS versus stage 5; it
stays under the existing budget, and reducing imported HeroUI components is the
first lever if headroom is needed later.

### Execution evidence

Archived in [`docs/history/nova-simplification-evidence.md`](docs/history/nova-simplification-evidence.md).
Per-stage evidence remains in the sections above. Current backend work is in
[`BACKEND_PLAN.md`](BACKEND_PLAN.md); the backlog below is historical release
evidence, not a current to-do list.

This is the standalone work tracker for Nova. It preserves all 22 unfinished
records from the project tracker at migration: 13 actionable tasks/decisions and
9 project/phase tracking epics. The source database contained 224 records total;
202 were closed. Do not interpret an open phase epic as an unimplemented phase.

### Launch-readiness update (2026-10-24)

Completed without a deployment or physical device:

- Fixed the simulation-mode joiner defect and related mode/source transitions
  (§10), including hash-correct source replacement.
- Added TURN credential refresh with `setConfiguration()` (§6) based on
  Cloudflare's documented expiry behavior.
- Re-probed discovery relays with a stricter kind-spread/burst probe (§8–§9).
- Added a tested `VITE_TRYSTERO_RELAYS` build-time override and deploy input
  (default discovery path unchanged pending sign-off).
- Added Firefox and WebKit to the Playwright suite; 60/60 tests pass in
  Chromium, Firefox, and WebKit locally in the Playwright 1.62.1 container.
- Verified the **built static two-origin artifacts** on distinct local origins
  (no hosting): 16/16 static/runtime Playwright tests pass, covering SPA deep
  links, the CSP `frame-src` iframe bootstrap to the second origin, invite
  fragment secrecy, remote dependencies, isolation, and lifecycle cleanup.
  `verify:deploy` passes against the built output (`--pages` for the GitHub
  Pages fallback).
- Enabled TanStack Router automatic code splitting; the initial JS bundle is
  **175 kB gzipped** with the editor route lazy-loaded (648 kB raw/210 kB gzip).
  Documented a 220 kB gzip budget in `scripts/bundle-size.mjs` and the README.

Everything still requiring a human decision, a deployment, or physical devices
is collected under **Blocked on humans, infrastructure, or hardware** at the end.

The backlog was last updated in August 2026. Revalidate historical observations
against the current code, providers, networks, and deployed resources before
acting. Completed implementation is not a substitute for deployment or physical
device evidence. P0 = release blocker; P1 = high priority; P2 = normal priority;
P3 = optional improvement. No infrastructure deployment is authorized by this
plan.
