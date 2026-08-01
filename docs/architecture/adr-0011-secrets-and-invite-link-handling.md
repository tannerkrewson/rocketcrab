# ADR-0011: Secrets and invite-link handling

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owner:** Rocketcrab Nova planning (Phase 1)
- **Related:** ADR-0004 (rendezvous), P2 (implementation), M2 (deployment),
  U1 (routing), ADR-0008 (runtime origin)

## Context

Parties need private session material (the derived private room ID and Trystero
password, and the random session secret they come from). These secrets must
not leak to static hosts, server logs, the runtime frame, or other games.
Static hosts cannot help keep secrets: anything in a path or query string may
be logged by the host, CDN, or analytics.

## Decision

- **Invite secrets are carried in the URL fragment only** — never in path
  segments or ordinary query parameters. Fragments are not sent to servers,
  so they never reach the static host (verified in M2 acceptance).
- The secret is **imported into session memory before rendering the party
  route**, and visible persistence in browser history is removed or minimized
  where feasible.
- **Room codes are not secrets** (ADR-0004); they are public rendezvous
  namespaces.
- **Session secrets are generated with Web Crypto** (CSPRNG), and the private
  room ID and Trystero password are **derived** from that secret (e.g., via
  HKDF or hash-based derivation implemented with Web Crypto — final scheme in
  P2).
- **Party secrets never enter game runtime messages or the game DOM**
  (plan engineering rules 5, 6): game frames and game source have no access
  to session material, and the runtime bundle contains no party-secret logic
  (U3 acceptance).
- The runtime origin stores no secrets (ADR-0008).

## Alternatives considered

1. **Query parameters / path segments.** Rejected: sent to the static host,
   potentially logged (M2 verifies fragments are not sent in HTTP requests).
2. **Persisting the secret in localStorage/IndexedDB on the main origin.**
   Rejected as primary storage: the plan wants the secret imported to memory
   with minimized visible persistence; persistence where strictly needed is
   an implementation detail of P2 and must be justified.
3. **Server-mediated invite tokens.** Rejected: requires a backend
   (ADR-0001).
4. **Long human-readable passphrases in the room code.** Rejected: ruins the
   four-letter UX; the code is a rendezvous namespace precisely so entropy
   lives in the derived private room instead.

## Tradeoffs

- **Fragments vs. shareability.** Invite links work only if the fragment
  survives copying; some channels strip fragments. The QR invite (P4) and the
  four-letter path (with admission) are fallbacks.
- **Memory-only vs. convenience.** Reconnect after reload needs recovery
  state (M1); Nova balances memory-first secrets with locally saved session
  recovery information that does not expose the full secret unnecessarily.

## Consequences

- P2 implements creation/joining, admission, and secret derivation; invite
  links bypass four-letter discovery.
- U1 keeps party secrets out of path segments and query parameters in route
  design.
- M2 verifies that invite fragments are not sent in HTTP requests.
- Party secrets never appear in game runtime messages (P2 acceptance).
