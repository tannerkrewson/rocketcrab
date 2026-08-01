# ADR-0010: Trusted-friend threat model

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owner:** Rocketcrab Nova planning (Phase 1)
- **Related:** `docs/architecture/threat-model.md`, ADR-0004 (admission),
  ADR-0006 (modes), M4 (release docs)

## Context

Parties in Nova are formed by friends: a creator generates a four-letter code
and shares it directly, or shares an invite link containing a session secret.
There are no accounts, no moderation, no public catalog, and no server-side
game execution. This shapes what Nova can and should defend against.

## Decision

**The threat model is "trusted friends with honest curiosity".** Concretely:

- **Admission is a social gate.** The four-letter code is a rendezvous
  namespace, and joiners are explicitly admitted by a greeter (ADR-0004).
  This keeps out strangers who guess codes — but it is not a cryptographic
  boundary against a determined peer.
- **Party members may inspect shared state.** In state mode, canonical state
  is replicated to party shells for migration; a technically sophisticated
  peer can read it in developer tools. Nova accepts this and does not attempt
  hidden-information secrecy against party members.
- **Nova does not provide anti-cheat, competitive fairness guarantees, or
  server-authoritative simulation.** These are explicit non-goals (see
  `docs/architecture/threat-model.md` → "What Nova does not secure").
- **What Nova _does_ secure** is the boundary between game code and the Nova
  application: isolation of the runtime origin (ADR-0001, F4), validated
  protocol messages (F6), and the secrecy of party session material
  (ADR-0011).

## Alternatives considered

1. **Adversarial / anti-cheat model.** Rejected for v1: requires server-side
   authority or heavy client integrity work; explicitly out of scope
   (competitive anti-cheat, server-authoritative simulation).
2. **Cryptographic hidden-information protocols.** Deferred backlog
   ("cryptographic hidden-information protocols"); not required for the
   initial release.
3. **Moderation / reputation.** Out of scope: no public parties or catalog in
   v1.
4. **Untrusted-everything (treat party members as attackers).** Rejected:
   would forbid the replicated canonical state that makes migration work
   (ADR-0007) and dramatically complicate the protocol.

## Tradeoffs

- **Honesty-based vs. adversarial robustness.** Nova optimizes for a small
  group of friends playing together; a determined party member can cheat or
  inspect state. The product surfaces this honestly rather than pretending
  otherwise.
- **Simple vs. strong admission.** Explicit admission adds friction to joining
  but is what makes code-guessing non-fatal.

## Consequences

- The threat model document must explicitly list what Nova does **not**
  secure (acceptance criteria for F3).
- The master AI prompt and README (A4, M4) describe the trusted-friend model
  so game authors and players have accurate expectations.
- Hidden-information game designs that rely on secrecy from peers are
  documented as unsupported for v1.
