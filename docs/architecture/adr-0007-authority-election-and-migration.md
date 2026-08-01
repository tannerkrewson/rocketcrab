# ADR-0007: Authority election and migration

- **Status:** Accepted (election algorithm details **Pending** S3)
- **Date:** 2026-08-01
- **Owner:** Rocketcrab Nova planning (Phase 1)
- **Related:** S3 (implementation), ADR-0006 (modes), B3 (split-brain),
  B6 (mobile suspension), P2 (greeter migration)

## Context

Nova owns authority by default (ADR-0006), and game code must **never need to
know which peer executes authoritative state transitions**. There is no
permanent host: the party creator is not privileged (plan engineering rule 7),
and Mobile Safari backgrounding can suspend any phone, including the current
authority (Blocker Register B6). A lexical "lowest peer ID wins" rule alone is
insufficient (Blocker Register B3).

## Decision

### Member identity

The protocol distinguishes:

- stable local **member ID**;
- current **connection ID**;
- **display name**;
- **eligibility** for authority;
- current **connectivity**;
- last **heartbeat**.

### Election requirements (implemented by S3)

- Initial authority selected **deterministically** from active eligible
  members.
- Creator is **not permanently privileged**.
- Authority sends **heartbeats**; missing heartbeats begin a **grace period**.
- **Actions buffer during election.**
- Eligible peers elect deterministically from their observed active
  membership.
- New **terms are monotonic**.
- **Authority announcements include term and state revision.**
- **Conflicting announcements reconcile deterministically**; on partition
  merge, exactly one authority wins.
- The new authority **restores the highest valid replicated state**.
- **Duplicate buffered actions remain deduplicated** (every authority action
  is idempotent or deduplicated — plan engineering rule 23).

A practical initial election may prefer the lowest stable eligible member ID,
but the complete protocol **must include terms and reconciliation**, not rely
only on lexical sorting.

### Conflict reconciliation

State envelopes carry enough information to compare:

- revision;
- term;
- authority member ID;
- state hash;
- recent processed action IDs.

When peers report conflicting state at the same revision, the resolution is
deterministic and documented: prefer the **majority-matching hash** when
available, then a stable tie-breaker.

### Testing

S3 uses `fast-check` model/property tests over sequences of joins, leaves,
disconnects, reconnects, duplicate/reordered messages, simultaneous suspected
authority loss, partition/merge, suspended Mobile Safari authority, and
buffered action replay.

## Alternatives considered

1. **Permanent creator authority.** Rejected: plan rule 7; the creator may
   leave, background, or lose connection; a party must survive the creator.
2. **Lexical lowest-ID election only.** Rejected: breaks under partitions
   (B3) — two sides could each elect an authority; terms, revision
   comparison, state hashing, and reconciliation are required.
3. **Full Paxos/Raft replication.** Rejected as overkill for a trusted-friend
   scale with at most a handful of peers; the term + revision + hash model is
   sufficient and far simpler to explain to AI-generated game authors.
4. **Server-authoritative execution.** Out of scope (ADR-0001).

## Tradeoffs

- **Protocol complexity** is real (terms, heartbeats, buffering, reconcile),
  but it lives entirely inside `packages/core` and is invisible to game code.
- **Determinism requirements** make property testing mandatory; S3 acceptance
  requires property tests to run in CI and gates the claim "robust against
  host loss" (S3 blocking condition).

## Consequences

- S3 implements the protocol; the test arena can force and display migration;
  election state is visible in Nova diagnostics.
- A state-mode game continues after the authority closes its tab; no action
  commits twice after migration; a temporary partition converges (S3
  acceptance).
- Greeter migration (P2) is separate from authority migration — greeter status
  and game authority are different roles.
