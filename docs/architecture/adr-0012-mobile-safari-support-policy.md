# ADR-0012: Mobile Safari support policy

- **Status:** Accepted (capability matrix **Pending** F4)
- **Date:** 2026-08-01
- **Owner:** Rocketcrab Nova planning (Phase 1)
- **Related:** F4 (sandbox spike), M1 (hardening), B6 (suspension),
  B1 (isolation vs. capabilities), A3 (media)

## Context

Rocketcrab Nova is **mobile-first**: the primary use case is a group of people
with phones. Mobile Safari is a first-class platform (plan section 3.3, M1),
and it is the most restrictive browser in scope: aggressive page suspension,
no reliable timers while backgrounded, dynamic browser chrome, viewport
instability, and strict audio/user-gesture rules.

## Decision

- **Mobile Safari is a first-class platform.** Everything that must work in
  the primary flow (create → paste → test → save → party → play) is required
  to work on physical iPhones.
- **Physical-device testing is mandatory for the hard parts.** F4 produces a
  committed capability matrix from at least one physical iPhone and one
  desktop browser (inline modules, jsDelivr ESM, `fetch`, WebSocket, canvas,
  WebGL, Web Audio, user-gesture audio, fullscreen, pointer lock where
  supported, file input, clipboard, camera, microphone, device orientation,
  suspend/resume, reload, destroy). M1 runs the lifecycle scenarios (portrait/
  landscape, keyboard, rotation, lock/unlock, backgrounding, tab switching,
  freeze/restore, network switches, offline, low-power, authority/greeter
  suspension, reconnect after reload).
- **Playwright WebKit is a CI supplement, never a substitute** for
  physical-device testing (plan engineering rule 17). CI runs WebKit
  automation; physical-device results are recorded manually (M4 release
  matrix).
- **Lifecycle reality:** timers and connections cannot be assumed to run while
  backgrounded (Blocker Register B6). Authority and greeter roles must
  migrate (ADR-0007, ADR-0004). The shell uses `pagehide`/`pageshow`,
  visibility, and network events, saves session recovery information locally,
  treats suspended authority as replaceable, and preserves an emergency exit.
- **Rendering reality:** avoid viewport units that break with changing browser
  chrome; respect safe-area insets; audio requires a user gesture and startup
  instructions must be clear (M1).
- **Pending F4:** the concrete capability matrix and the selected runtime
  model (ADR-0008) are recorded by F4 before F6/U3/A3/M1 unblock.

## Alternatives considered

1. **Desktop-first with mobile fallback.** Rejected: contradicts the product
   and the plan's mobile-first requirement.
2. **Treat WebKit automation as sufficient mobile coverage.** Rejected: CI
   browsers do not reproduce physical-device suspension, gestures, chrome
   changes, or permission flows (plan rule 17, B1).
3. **Defer Safari support.** Rejected: Safari is the dominant mobile browser
   for the target audience.

## Tradeoffs

- **Test cost.** Physical-device testing is slow and needs hardware; this is
  accepted as the cost of a mobile-first product.
- **Feature constraints.** Some APIs (pointer lock, fullscreen) may be
  unsupported or partial on Mobile Safari; Nova must fail clearly and
  document compatibility limitations rather than degrade silently.

## Consequences

- F4 and M1 own the physical-device matrices; U3/U6/P4/S3/A3 gate on F4 where
  the plan says so (F6, U3, A3, M1 blocked by F4).
- M4 records physical-device checks as a required release gate; known
  limitations are visible in the README.
- Game authors get clear guidance (A4 prompt, API docs) about capabilities
  that require user gestures and about limitations.
