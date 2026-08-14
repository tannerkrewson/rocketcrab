# ADR-0006: State, simulation, and raw modes

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owner:** Rocketcrab Nova planning (Phase 1)
- **Related:** S1 (Nova API), S2 (state mode), A1 (simulation), A2 (raw),
  S4 (state-mode MVP; verification in
  `docs/testing/state-mode-vertical-slice.md`), ADR-0007 (authority)

## Context

AI-generated games cannot be expected to implement distributed-state logic.
Nova's core value is that **Nova owns state, action ordering, authority,
reconnects, and migration by default** (plan section 3.7). Different games
have very different needs — from turn-based card games to fast arcade games to
specialized protocols — so one mode cannot fit all.

## Decision

Nova exposes three game modes through the common Nova API (S1):

### State mode (default)

For party, card, board, trivia, drawing, voting, word, social, and turn-based
games. Nova provides:

- canonical serializable state (shells retain it);
- ordered actions with per-player sequences, base revisions, timeouts,
  deduplication, and rejection errors;
- per-player views (non-authority frames receive only their selected view);
- late joining, reconnection, duplicate-action prevention;
- automatic authority migration (ADR-0007);
- state revisioning and snapshots (every snapshot has a revision and hash).

Action handlers execute on the current authority's runtime through **Immer**
(`immer@11.1.15`), mutating a draft; the resulting canonical state receives a
new revision. The trusted-friend model accepts that a sophisticated peer may
inspect replicated canonical state in dev tools (ADR-0010).

### Simulation mode

For faster continuous games. Nova provides ordered player inputs, a shared
simulation clock, authority selection, periodic authoritative snapshots,
restore after migration, and basic interpolation hooks. **Rollback netcode
and sophisticated prediction are explicitly not required initially.** The game
owns simulation rules, rendering, optional interpolation/prediction, and its
snapshot serialization.

### Raw mode

For specialized games needing lower-level communication. Nova provides named
channels, broadcast and targeted messages, reliable/unreliable and
ordered/unordered delivery choices where the underlying browser permits,
binary payload support, and connection/peer events. **Nova does not guarantee
synchronization, migration, or cheating resistance for arbitrary raw-channel
protocols.**

## Alternatives considered

1. **A single generic message API.** Rejected: games would re-implement
   authority, ordering, and migration on top of raw messages — the exact
   burden Nova exists to remove.
2. **Server-authoritative simulation.** Out of scope for v1 (and contradicts
   ADR-0001); explicitly listed as a non-goal.
3. **Only state mode.** Rejected: continuous/fast games need simulation, and
   some games genuinely need raw channels; the plan defines all three.

## Tradeoffs

- **Nova complexity vs. game simplicity.** Three engines are more work than
  one, but each is small and independently testable, and S4 (the state-mode
  vertical slice) defines the backendless MVP milestone _before_ advanced
  modes are required to land.
- **Raw-mode escape hatch.** Raw mode trades guarantees for flexibility; the
  API and docs must clearly distinguish raw-channel guarantees from
  state-mode guarantees (A2 acceptance).

## Consequences

- S2 (state), A1 (simulation), and A2 (raw) implement the three modes; S1
  defines the common surface and mode declaration.
- The master AI prompt (A4) instructs chatbots to prefer state mode unless the
  game genuinely needs another mode, and must distinguish all three
  accurately.
- Documentation (M4) explains when to choose state vs. simulation mode.
