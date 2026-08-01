# ADR-0009: Public CDN and arbitrary network-access policy

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owner:** Rocketcrab Nova planning (Phase 1)
- **Related:** ADR-0002 (game model), U4 (validation), P3 (distribution),
  M2 (runtime policy), B4 (remote dependency reliability)

## Context

Games are ordinary HTML (ADR-0002) and routinely need public libraries, remote
assets, and live data. The product explicitly does **not** include "a Nova
proxy for normal CDN imports, assets, `fetch`, WebSockets, canvas, WebGL,
audio, files, or device input" (plan out-of-scope list). Nova must therefore
decide how much network freedom game code has and how failures are handled.

## Decision

- **Game code may use the open web directly** from the runtime frame:
  remote scripts and ESM modules, remote images/audio/fonts/video/models,
  `fetch`, WebSockets, and any browser API the frame permits.
- **Nova does not proxy, rewrite, cache, or allowlist these requests.**
  No Nova infrastructure sits between a game and a CDN/API.
- The master AI prompt (A4) **recommends version-pinned dependency URLs**
  (e.g., `https://cdn.jsdelivr.net/npm/pkg@version/...`), but this is a
  recommendation, not enforcement.
- **Failure handling is diagnostic, not corrective.** U4 detects observable
  failures (remote dependency load failures when observable, runtime startup
  errors) and surfaces them in copyable diagnostics so the creator can paste
  them back into the AI chat. Nova does not retry, mirror, or bundle remote
  resources for the game.
- The runtime origin's Content-Security-Policy (M2) is intentionally
  permissive enough to allow HTTPS scripts/modules, HTTPS/WSS connections,
  remote media, and blob URLs, compensated by origin separation and the
  absence of secrets (ADR-0008).

## Alternatives considered

1. **Nova proxies all remote requests.** Rejected: requires a backend
   (ADR-0001), adds cost and a single point of failure, and contradicts the
   out-of-scope list.
2. **Strict CDN allowlist.** Rejected: brittle; games legitimately use many
   hosts, and a static allowlist cannot anticipate AI-generated choices.
3. **Offline dependency bundling / asset mirroring.** Deferred backlog; not
   required for v1.
4. **No network access for games.** Rejected: destroys the game model
   (ADR-0002).

## Tradeoffs

- **Capability vs. reliability.** Games get the full web; a CDN outage, CORS
  policy, or dead API can break a game (Blocker Register B4). Nova treats this
  as a documented residual risk and diagnoses observable symptoms only.
- **Privacy note.** Because games may call home, game code can perform network
  tracking of its own players; this is inherent to the open-network model and
  disclosed in the threat model.

## Consequences

- U4/P3 own B4 (remote dependency reliability): diagnose, do not proxy.
- M2 keeps the main-origin policy strict while permitting the open web on the
  runtime origin.
- P3 transfers only the HTML source; each player's browser loads remote
  dependencies directly, so remote assets are never copied into the HTML.
- Documentation (M4) states that Nova cannot guarantee third-party
  availability.
