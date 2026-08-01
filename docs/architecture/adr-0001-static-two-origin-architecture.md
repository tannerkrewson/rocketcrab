# ADR-0001: Static main application and static runtime origins

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owner:** Rocketcrab Nova planning (Phase 1)
- **Related:** ADR-0002 (untrusted game model), ADR-0008 (runtime-origin limits), F4 (runtime sandbox validation), M2 (production deployment)

## Context

Rocketcrab Nova is a static, mobile-first web application for creating, testing,
saving, and playing user-generated multiplayer browser games. Games are
untrusted, AI-generated HTML documents pasted into the app by creators.

The plan (section 3.2) mandates a fully static product: **no Nova application
backend**. A future serverless TURN credential endpoint is permitted, but it is
not part of the initial architecture unless connectivity testing (F5, M3) proves
it necessary.

The repository currently implements two Vite applications in an npm workspace:

- `apps/nova` — the main React SPA (dev server port 5173).
- `apps/runtime` — the isolated iframe runner (dev server port 5174).

## Decision

Production deployment consists of static assets at **two HTTPS origins**:

- `https://nova.example` — the Nova application (SPA, browser-local storage).
- `https://runtime.nova.example` — an intentionally isolated execution origin
  for pasted game HTML.

Key properties:

- No Nova application server of any kind. Both origins are static build
  outputs deployed from `apps/nova/dist` and `apps/runtime/dist`.
- The runtime origin hosts no Nova credentials, private application data,
  authentication cookies, or service-worker authority over the main app.
- Communication between the two origins uses an exact-origin `postMessage`
  bootstrap followed by a dedicated `MessageChannel`, with all messages
  validated against versioned schemas (F6).
- Local development runs both origins as two Vite dev servers on distinct
  ports (`npm run dev` starts both via `concurrently`).
- Security headers and caching differ per origin (main origin: strict SPA
  policy; runtime origin: intentionally permissive for arbitrary web content).
  See M2.

## Alternatives considered

1. **Single origin with a sandboxed iframe.** Rejected: an iframe on the same
   origin (or `sandbox` without a separate origin) cannot fully isolate
   storage, cookies, and permission state from the application. The plan's
   isolation requirements (F4) call for a separate origin.
2. **One backend server (SSR or API).** Rejected: contradicts the fully static
   requirement, adds ops and attack surface, and the plan explicitly forbids a
   backend merely to simplify local application state.
3. **Separate repositories per origin.** Rejected: the two origins share the
   protocol schemas and engines; a single workspace keeps one lockfile, one
   version, and coordinated releases.
4. **Opaque sandbox for ordinary games plus an opt-in privileged runtime.**
   Kept open — this is exactly the decision gate owned by **F4**. If physical
   Mobile Safari or security testing makes the single shared privileged
   runtime untenable, F4 may select a two-tier model. Until then, one
   privileged runtime origin is the default.

## Tradeoffs

- **Isolation vs. engineering cost.** Two origins require cross-origin message
  plumbing, per-origin security headers, and two deployments. In exchange,
  game code cannot reach the main application's DOM, storage, or credentials.
- **Static vs. dynamic.** A fully static deployment has no room list, no
  moderation, no server-side game execution — acceptable because parties are
  discovered via Trystero and stored only locally.
- **Fragments.** Invite secrets must live in URL fragments (never paths or
  query strings) because fragments are not sent to static hosts (see
  ADR-0011).

## Consequences

- F4 must validate the two-origin runtime sandbox on physical Mobile Safari and
  record a capability matrix.
- M2 owns the production static deployment and per-origin security headers.
- No implementation issue may add a Nova backend; if connectivity testing
  (F5/M3) requires TURN, only a tiny serverless credential endpoint is
  permitted, and it must not execute game code or store room state.
- README documents the two-origin model as the architecture at a glance.
