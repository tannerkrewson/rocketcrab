# ADR-0008: Shared runtime-origin limitations

- **Status:** Accepted (runtime model decision **recorded** 2026-08-01; physical confirmation PENDING)
- **Date:** 2026-08-01
- **Owner:** Rocketcrab Nova planning (Phase 1)
- **Related:** ADR-0001 (origins), F4 (sandbox spike), M2 (deployment),
  B5 (shared origin), A3 (media bridging)

## Context

All games run on a **single** runtime origin (`runtime.nova.example`, ADR-0001)
inside the runtime iframe. Browsers scope storage, permissions, and some caches
**per origin**. Because every game shares that one origin, the isolation that
exists between the game and the Nova app does **not** exist between one game
and another game on the same runtime origin.

This is Blocker Register B5: "Different games on the same runtime origin may
share browser permission and storage boundaries. Store nothing sensitive there
and document this limitation."

## Decision

- **Nova does not claim strong per-game isolation on the shared runtime
  origin.** Different games may share:
  - permission state (e.g., camera/microphone grants, where the runtime
    origin is the permission subject);
  - browser storage scoped to the runtime origin (IndexedDB, cookies,
    localStorage, cache storage);
  - cached subresources, ETags, and origin-keyed network caches.
- **Nova stores nothing sensitive on the runtime origin**: no game source
  (ADR-0005), no party secrets (ADR-0011), no Nova credentials, no
  authentication cookies, no service-worker authority over the main app.
- The runtime origin's intentionally permissive policy (M2) is _compensated_
  by the separation of origins, the absence of secrets, disabled service
  workers, top-navigation prevention, and a strict main-origin policy —
  not by per-game isolation.
- **Future option:** unique runtime subdomains per game would restore
  per-game boundaries. This is deferred backlog ("unique runtime origins per
  game") and must not block v1.
- **Pending F4:** F4 decides the runtime _model_ — a separate-origin
  privileged runtime for all games, or an opaque sandbox for ordinary games
  plus an opt-in privileged runtime for powerful capabilities. One model is
  preferred unless physical Mobile Safari or security testing makes that
  untenable. This ADR assumes the single privileged runtime until F4 records
  otherwise.

## F4 record (2026-08-01)

F4's spike (findings in `docs/testing/runtime-sandbox-findings.md`)
**confirmed the single separate-origin
privileged runtime for all games** and rejected the two-tier model for v1:
capabilities (ESM, fetch, canvas, WebGL, audio, media, WS) work from the
sandboxed game frame on the runtime origin, isolation from the Nova app holds,
and a second tier would add complexity without fixing the shared-origin caveat
below. The shared-origin limitations documented in this ADR remain in force
and are accepted for v1 (runtime origin stays secret-free); the deferred
per-game subdomain escape hatch still exists if B5 ever becomes unacceptable.
Physical-device confirmation (Mobile Safari) is still required before F4
closes.

## Alternatives considered

1. **Per-game unique runtime subdomains now.** Rejected for v1: DNS,
   certificate, deployment, and CSP complexity per game; the plan defers it.
2. **One runtime origin with an opaque sandbox for everything.** Rejected:
   would break remote ESM, WebGL, audio, and device APIs that games need;
   F4 may still select a hybrid if isolation testing demands it.
3. **Store nothing on the runtime origin at all (deny storage APIs).**
   Rejected: games legitimately use IndexedDB/localStorage for their own
   state; the guarantee is "nothing _sensitive_ is stored there", not "no
   storage".

## Tradeoffs

- **Shared permission scope.** A camera/mic grant on the runtime origin
  technically extends to other games on that origin. Nova mitigates by
  acquiring media inside the game iframe with ordinary user prompts (A3) and
  documenting the scope.
- **Shared storage scope.** Game A's origin-scoped data is readable by
  game B. The mitigation is trust: parties are trusted friends (ADR-0010) and
  no Nova secrets live on the origin.

## Consequences

- The threat model records "shared runtime-origin storage" as a residual risk
  with this ADR as the owner (see `docs/architecture/threat-model.md`).
- M2 deploys the runtime origin without authentication cookies and without
  service workers.
- A3 validates media bridging on physical devices; unsupported combinations
  fail clearly.
- The README and release docs (M4) state the per-game isolation limitation
  explicitly.
