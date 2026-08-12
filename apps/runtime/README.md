# apps/runtime — the isolated game runtime origin

The runtime-origin application (U3). It executes untrusted game HTML on a
separate origin from the Nova shell (ADR-0001) inside a same-origin sandboxed
game frame, and talks to the shell over a versioned protocol
(`@rocketcrab/protocol`, runtime plane). This is the industrialised shape of
the F4 spike (findings in `docs/testing/runtime-sandbox-findings.md`).

## The trust boundary

```
Nova shell (nova.example)  ──postMessage bootstrap──▶  runtime.nova.example
     ▲                                                       │
     └────────── validated protocol messages ◀── MessageChannel ─┘
                                                    │
                                          sandboxed game iframe
                                          (same-origin with the
                                           runtime page, ADR-0008)
```

- The shell embeds the runtime iframe and performs an **exact-origin
  postMessage bootstrap** that transfers one dedicated `MessageChannel` per
  runtime instance. Every message on the channel is validated with the F6
  Zod schemas (`parseRuntimeMessage`) — never `any` at the boundary.
- The runtime page is **secret-free by construction**: no Nova credentials,
  no saved game source, no party secrets. Game code is same-origin with the
  runtime page (documented B5/ADR-0008) — that page must never hold
  anything sensitive.
- Game HTML is **never sanitized or rewritten** (ADR-0002): no import
  rewriting, no credential injection. A tiny Nova API bridge script is
  prepended (see below).
- The game frame sandbox carries `allow-scripts allow-same-origin
allow-pointer-lock allow-fullscreen` and delegates camera/microphone/
  clipboard/fullscreen via the `allow` attribute (F4 finding: delegation at
  every iframe hop). No `allow-top-navigation` — the game cannot navigate
  the Nova tab (T6/T21).

## What the runtime does

- **Bootstrap handshake** (`src/main.ts`): accepts exactly one
  `runtime.bootstrap` message from the exact main origin (dev: port swap to
  5173; production: `runtime.` hostname prefix strip), creates one
  `RuntimeInstance` (`src/runtime-instance.ts`) with a fresh channel, and
  replies `runtime.ready`.
- **HTML injection** (`F4 spike shape`): prepends the Nova API bridge
  (`src/nova-bridge.ts`) to the game source and writes both into a fresh
  sandboxed same-origin iframe via `document.write`. Malformed/missing HTML
  is detected (`src/html-source.ts`) and reported, never sanitized: empty
  sources fail with `empty_source`; missing `<!doctype`/`<html>` structure is
  reported as `invalid_html` but still runs.
- **Nova API bootstrap injection**: the bridge defines `window.nova` with
  the full game-facing API surface (S1: `defineGame`, `ready`, `log`,
  players, subscriptions, `dispatch`, `state`, `raw`, `simulation`) inside
  the game frame — the same object shape `createNovaClient` builds in
  `@rocketcrab/nova-api`. The lifecycle is enforced in the frame too
  (calls before readiness fail with a clear `NovaError`), and every
  forwarded call is schema-validated here before it reaches the host.
  The host session router (U6 arena / P1 party) then routes the validated
  call into the player's `NovaSession` over the transport: the runtime
  forwards it as a `game.apiCall` message on the instance channel, and
  host-pushed session events arrive as `game.apiEvent` and are dispatched
  to the matching `window.nova` handlers through `__novaGameBridge.receive`
  (same-origin hook; functions registered by a game never cross the
  frame). The validated bootstrap player identity is injected into the
  frame before the bridge runs, so `nova.player` is correct from the first
  tick. The bridge also captures window errors, unhandled rejections, and
  console output, and reports them to the runtime page through a
  per-instance hook (no extra message listeners — nothing to leak across
  restarts). Game-declared metadata is schema-validated before it is
  ever forwarded (`game.registration`); the host-declared `gameId` is
  never overridable. `nova.defineGame({ apiVersion })` declares the Nova
  API version the game targets; an unsupported version fails registration
  with a clear `unsupported` runtime error (S1 policy — no guessing).
- **Registration timeout**: if the game does not call `nova.defineGame`
  within 10s, the runtime reports `missing_registration`
  (`runtime.error`).
- **Heartbeat**: answers `runtime.ping` with `runtime.pong`.
- **Parent-controlled controls**: `runtime.reload` (fresh frame, same
  source), `game.end` (destroy the game frame, close the channel, delete the
  per-instance hook).
- **Pause diagnostic**: reports page-visibility transitions as
  `game.lifecycle` `paused`/`resumed` events (Mobile Safari backgrounding,
  ADR-0012/B6). The shell composes a diagnostic via the host bridge
  (`apps/nova/src/lib/runtime-host.ts`).
- **Rate limits**: console entries (`runtime.console`) and error reports
  (`runtime.error`) are token-bucket limited to the F6 limits
  (`runtimeLogRatePerSecond`, `errorReportRatePerSecond`); drop counts ride
  along on the next forwarded message.

## The host bridge

`apps/nova/src/lib/runtime-host.ts` is the shell-side half: it embeds the
runtime iframe, performs the bootstrap handshake, keeps the heartbeat
(missed pongs → `unresponsive`), and exposes `load` / `reload` / `destroy` /
`restart` / `diagnose`. U4 wires it into the editor/validation flow.

## Comlink evaluation (design note)

Comlink was evaluated for the RPC layer and **not adopted**: it has no
message validation (it would bypass the protocol boundary — the core trust
requirement), no explicit lifecycle control (destroy/reload/restart), and no
restart semantics. The small versioned RPC layer over `MessageChannel` is
therefore the deliberate choice: it is a core trust boundary and is kept
explicit, validated, and versioned.

## Dev flow

```sh
npm run dev            # nova on :5173, runtime on :5174 (distinct origins, HTTP)
npm run check          # format, lint, typecheck, test, build (+ bundle purity check)
npm run test:e2e       # Playwright: runtime handshake, execution, isolation
```

Production is HTTPS-only and the runtime iframe needs a distinct origin, so
local HTTPS is one command away (M2; `docs/architecture/deployment.md`):

```sh
npm run gen-certs      # gitignored self-signed certs for localhost
npm run dev:https      # https://localhost:5173 (nova) + https://localhost:5174 (runtime)
```

Add a LAN IP for physical-device testing: `node scripts/gen-certs.mjs 192.168.1.10`
and open `https://192.168.1.10:5173`. The runtime page intentionally ships no
restrictive CSP (games keep ordinary web capabilities) and sweeps any service
worker registration on load (ADR-0008; compensating controls in the deployment
doc). The runtime bundle must never contain Nova database or party secret
logic — enforced by `scripts/check-runtime-bundle.mjs` after every build.
