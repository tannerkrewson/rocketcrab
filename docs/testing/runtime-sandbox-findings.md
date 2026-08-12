# F4 runtime sandbox — spike findings and runtime-model recommendation

Status: committed 2026-08-01; physical-device pass **completed** (2026-08-01,
iPhone + Mobile Safari) — results in the section below.

## What was built

A temporary two-origin HTTPS spike (since industrialised into `apps/runtime`
and removed in release cleanup): a host app (origin A, `:5273`), a runtime
app (origin B, `:5274`), and an unrelated third origin (C, `:5275`) used to
prove wrong-origin rejection. The host embeds the runtime in a cross-origin iframe, bootstraps it
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
infinite loop in the game frame wedges the **whole tab**. This happens in the
headless shell **and on real browsers** — verified on the physical pass:
standard desktop Chromium (headed, LAN IP and localhost) and iPhone Safari
both freeze the shell. Root cause: Chromium/WebKit process isolation is
**per-`site` (scheme + host), not per-origin** — the host (`:5273`) and
runtime (`:5274`) share one host, so different ports do **not** create
separate processes (OOPIF), and the game loop (same-origin with the runtime
page) wedges the shared renderer that also runs the host UI. Recovery is
still possible at the browser level (fresh page), and the runtime session
survives finite heavy CPU bursts, but the "host shell stays responsive and
its emergency stop keeps working while the game frame spins" property does
**not** hold with a port-only origin split. This is Blocker Register B6 /
M1 material.

## Physical-device results (2026-08-01, iPhone + Mobile Safari)

Human pass run per `physical-device-checklist-f4.md` against the LAN
(`https://192.168.1.10:5273/5274/5275`, locally-trusted self-signed certs).
Host UI was extended for the pass: an on-screen probe panel in the hello
game, a "Load infinite game" button, an orientation-permission button, an
audible audio beep, and a WebSocket probe — so every probe is observable on
a phone with no JS console.

- **Capabilities pass on device.** Inline + module scripts, jsDelivr ESM,
  remote fetch, remote image, Canvas 2D, WebGL (hardware), Web Audio after a
  user gesture (audible beep), file input (content-checked), clipboard
  write, camera + microphone (real capture, prompt allowed), soft reload,
  Emergency-stop destruction, and page backgrounding/resume all verified on
  the iPhone. Runtime origin secrets remain empty (DevTools check).
- **Fullscreen and pointer lock: unsupported on iPhone Safari** (expected
  platform limitation, not a spike defect). Desktop control confirms both
  work there.
- **Device orientation/motion: denied without a prompt.** From inside the
  sandboxed game frame, `DeviceOrientationEvent.requestPermission()` returns
  `denied` and iOS never surfaces the motion-permission prompt. WebKit does
  not present the prompt for a cross-origin sandboxed iframe in this setup.
  Finding: orientation/motion needs a host-origin permission flow (request +
  delegation) or must be documented unsupported for games — A3/M1 material.
- **CPU exhaustion: FAIL on iPhone AND desktop Chromium.** An infinite-loop
  game freezes the entire Safari tab (pinch-zoom works but every control,
  including Emergency stop, is unresponsive; reload is very slow), and the
  same happens in **standard headed desktop Chromium** (verified with
  Playwright against both the LAN IP and localhost). Root cause: isolation
  is per-site (scheme+host); host and runtime differ only by port, so they
  share a renderer process and the game wedge takes the shell down with it.
  Neither the privileged nor an opaque-sandbox runtime avoids same-process
  wedging (the game still executes in the shared renderer), so this does not
  flip the runtime-model recommendation; it **does** mean shell-survival
  requires the runtime on a **distinct hostname** (unique runtime subdomain),
  not a distinct port — M1/M2/U3 must carry this (document the limitation,
  reload-based recovery, WebWorker execution for non-DOM games). Decisive
  input for Blocker Register B1/B6.
- **WebSocket:** local wss echo probe added to the hello game; exercise by
  re-loading the hello game (echo server runs on `:5276` with the spike
  certs).

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

**What would change the recommendation:** physical Mobile Safari testing
showed no capability failure that an opaque sandbox would avoid. Every
required capability held on device except platform limitations (fullscreen
and pointer lock unsupported by iOS Safari; motion permission denied for the
sandboxed frame) and the CPU-exhaustion tab-wedge — which affects any
in-tab execution model and is a M1/U3 mitigation concern, **not** a model
differentiator. The containment evidence does add one concrete architectural
requirement: with a port-only origin split, host and runtime share a renderer
process (isolation is per-site, scheme+host), so the runtime must live on a
**distinct hostname** for shell-survival — the deferred "unique runtime
subdomains" option becomes required for this property (M2 deployment,
U3 runtime, M1 hardening). B5 (shared runtime origin) remains the open design
constraint; revisit (two-tier model) only if B5 proves unacceptable for v1.

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
