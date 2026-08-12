# ADR-0003: Trystero transport abstraction

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owner:** Rocketcrab Nova planning (Phase 1)
- **Related:** U5 (InMemoryTransport), P1 (TrysteroTransport), S1 (Nova API),
  ADR-0004 (rendezvous), F5 (connectivity spike)

## Context

Real parties connect peer-to-peer. Rocketcrab Nova uses **Trystero** for all
real party transport (plan section 3.3). At the same time, the multi-player
test arena must run several simulated players on one page **without** WebRTC,
and the game-facing API must behave identically in both worlds.

Trystero provides multiple discovery strategies behind one room/action API
(Nostr is the default package strategy), plus structured and binary actions,
large-payload chunking, progress callbacks, request/response actions, peer
admission handshakes, latency measurement, media streams, join-error reporting,
and optional TURN configuration. F5 will validate the backendless premise and
recommend relay/TURN settings.

The transport-neutral interface lives in `packages/core`
(`packages/core/src/transport/`); the real-party adapter lives in its own
package `@rocketcrab/trystero-transport` (P1), which is the only package that
may import Trystero (enforced by the root oxlint `no-restricted-imports`
rule, per ADR-0013). `packages/core` does not depend on Trystero.

## Decision

- **Trystero is used for every real party connection** and is **never exposed
  to generated games**. Game code (via `packages/nova-api`) sees only the
  Nova API (S1) — no Trystero terminology, no room objects, no peer objects.
- **A transport-neutral Nova interface** lives in `packages/core` with at
  least two implementations:
  - `InMemoryTransport` — the local test arena (U5). Deterministic, seeded,
    with configurable latency, jitter, loss, duplication, reordering, and
    simulated background suspension. No production Trystero code required to
    run the arena.
  - `TrysteroTransport` — real parties (P1), Nostr strategy initially, with
    join-error mapping, relay-state diagnostics, ping/quality sampling, a TURN
    configuration hook, and retry/timeout policy.
- **The game-facing API behaves the same over both transports.** The adapter
  must pass the same contract suite as `InMemoryTransport` (P1 acceptance).
- Trystero remains replaceable _behind_ the interface, but the plan forbids
  silently replacing Trystero itself; F5/M3 own any TURN or relay changes.

## Alternatives considered

1. **Direct WebRTC code in the app.** Rejected: re-implements discovery, NAT
   traversal, chunking, and handshakes that Trystero already provides.
2. **Trystero only — no in-memory transport.** Rejected: the test arena needs
   deterministic, offline-capable simulation of many peers on one page; real
   WebRTC cannot do that.
3. **A fake transport layered only for tests.** Rejected: the arena is a
   product feature (U6), not a test seam; it must run the real game-facing API
   and lifecycle events.
4. **Exposing Trystero to games.** Rejected: games would depend on transport
   internals, break the test/party parity, and violate the isolation model.

## Tradeoffs

- **Abstraction cost vs. parity.** The interface is custom code at a core
  trust boundary; it must be validated by the shared contract suite (U5, P1).
- **Trystero version churn** is isolated to the adapter, at the cost of a thin
  mapping layer that must stay in sync with Trystero's API.
- **"Backendless" precision.** The abstraction does not guarantee direct
  connectivity; TURN may be needed (F5/M3, Blocker B2).

## Consequences

- P1 acceptance: core Nova code cannot import Trystero outside the adapter
  package (P1 landed: Trystero is a dependency of
  `@rocketcrab/trystero-transport` only; enforced by package boundary and an
  oxlint `no-restricted-imports` rule; see ADR-0013 for the npm workspaces
  note on boundary discipline).
- S1 acceptance: the same game code works in test and party transports.
- The test arena (U6) requires no production Trystero code.
- F5 records relay behavior, discovery/WebRTC timing, throughput, and a TURN
  recommendation; M3 decides whether TURN infrastructure ships.
