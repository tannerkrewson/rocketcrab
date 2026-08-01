# F4 runtime sandbox — spike findings and runtime-model recommendation

Status: committed 2026-08-01. Physical-device confirmation **pending**
(see `physical-device-checklist-f4.md`).

## What was built

A temporary two-origin HTTPS spike at `spikes/runtime-sandbox/` (not part of
the npm workspace): a host app (origin A, `:5273`), a runtime app (origin B,
`:5274`), and an unrelated third origin (C, `:5275`) used to prove wrong-origin
rejection. The host embeds the runtime in a cross-origin iframe, bootstraps it
with an **exact-origin `postMessage`** that transfers a dedicated
**`MessageChannel`**, and sends game HTML over that channel. The runtime
executes each game inside a same-origin sandboxed iframe
(`sandbox="allow-scripts allow-same-origin"`) on the runtime origin, forwards
errors to the host, and supports load / reload / destroy plus a heartbeat.
The host keeps an **Emergency Stop control outside the frame**.

This is the shape U3 will formalize (versioned Zod schemas, comlink-vs-RPC
decision, exact bootstrap protocol) — F6 owns the schemas.

## Isolation results (automated, headless Chromium)

- **Game → Nova app origin is fully blocked.** DOM, `localStorage`, cookies,
  top navigation (direct assignment and `target=_top` anchor), and the
  emergency-stop control were all rejected with `SecurityError`. The host tab
  never navigated; the host secret stayed in host storage.
- **Wrong-origin bootstrap rejected.** A page on origin C trying the identical
  bootstrap handshake got no reply; the runtime logged the origin rejection and
  created no game frame.
- **Malformed/unknown-version channel messages rejected** with useful error
  messages back to the host.
- **The runtime origin holds no secrets** (empty localStorage/cookies/IDB in
  the automated check; the design keeps it that way by construction).
- **B5 confirmed (documented, not a bug):** the game is same-origin with the
  _runtime page itself_ — `window.parent.document` is readable. The runtime
  page therefore must never hold Nova secrets, game source (ADR-0005), or
  party secrets (ADR-0011). Per-game isolation is explicitly NOT claimed.

## Capability results (desktop/headless)

All of the following work from inside the sandboxed game frame: inline classic
and module scripts, remote ESM (`jsDelivr` +esm), remote `fetch`, remote
images, Canvas 2D, WebGL (software — SwiftShader flags required headless; real
devices use hardware), Web Audio after a user gesture, WebSocket (against a
local wss echo — the public echo service was DNS-unreachable from this
network), file input, clipboard (permission + user activation), camera and
microphone (fake devices; requires `allow="camera; microphone"` on **both**
iframes), device-orientation listener (synthetic event), and
reload/destroy. Fullscreen and pointer lock do not work headless and are
marked informational. See the capability matrix for the full table.

**Permission delegation finding:** camera/mic/clipboard require the `allow`
attribute at every iframe hop (host → runtime → game). U3 must carry this
through, and M2 must set the matching Permissions-Policy on the runtime
origin. A3's media bridging work will build on this.

**CPU-exhaustion finding (important, environment-dependent):** a synchronous
infinite loop in the game frame wedges the **whole tab** in this headless
shell because cross-origin process isolation (OOPIF) is unavailable there.
Recovery is still possible at the browser level (fresh page), and the runtime
session survives finite heavy CPU bursts, but the "host shell stays responsive
and its emergency stop keeps working while the game frame spins" property
**could not be verified in this environment**. Real desktop and mobile
browsers isolate cross-origin frames into separate processes (Chrome desktop,
Safari WebContent process groups); that claim must be verified on the
physical-device pass. This is Blocker Register B6 / M1 material.

## Decision gate — recommended runtime model

**Recommendation: a single separate-origin privileged runtime for all games**
(the plan's preferred option). Rationale:

- The spike shows the separate runtime origin provides the required isolation
  from the Nova app with ordinary web capabilities intact (ESM, fetch, canvas,
  WebGL, audio, media, WS).
- An opaque-sandbox tier would _lose_ capabilities (storage, some APIs) for
  ordinary games and add a second runtime path, a second set of schemas, and
  complexity — without fixing the only real caveat (shared-runtime-origin B5),
  which is already mitigated by keeping the runtime origin secret-free.
- The shared-origin caveat (B5) is documented and accepted for v1; unique
  runtime subdomains remain the deferred escape hatch if that changes.

**What would change the recommendation:** physical Mobile Safari testing shows
(a) the privileged model fails a required capability in a way an opaque
sandbox would not, or (b) the shared-runtime-origin permission/storage
behavior (B5) proves unacceptable for v1 — then revisit (unique subdomains or
a two-tier model) before release.

## Notes for downstream issues

- **U3**: build the real runtime on this spike's shape; carry the `allow`
  permission delegation; keep the runtime page secret-free; formalize
  schemas with F6; evaluate comlink against this handshake.
- **M2**: separate security headers per origin; runtime origin needs the
  permissive-but-compensated policy from ADR-0001; Permissions-Policy must
  match the `allow` delegation above.
- **M1 / B6**: verify shell-survival under CPU exhaustion on physical devices
  (the headless shell cannot prove it).
- **A3**: media already crosses the frame chain with fake devices; real
  capture and Mobile Safari behavior still need physical validation.
- Dev HTTPS uses throwaway self-signed certs (gitignored); production is M2.
