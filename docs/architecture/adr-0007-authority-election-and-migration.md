# ADR-0007: Authority election and migration

- **Status:** Accepted (election algorithm implemented by S3; see
  "Implementation (S3)" below)
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

## Implementation (S3)

The protocol lives entirely inside `packages/nova-api` (the state engine and
session); game code never learns which peer is authoritative.

### Roles and state

- The engine tracks the current **term** (starts at 1, strictly monotonic),
  the current **authority member id**, and the authority's last announced
  state revision. Terms are learned from announcements, heartbeats,
  elections, and snapshots; a strictly higher term always supersedes.
- The **initial authority** is the lowest connected eligible member at
  `start` (deterministic; announced at term 1).
- The authority broadcasts a **heartbeat** every `authorityHeartbeatIntervalMs`
  (1s default; protocol limits). A follower that hears nothing for
  `authorityGracePeriodMs` (5s default) suspects the authority. A dropped
  connection of the authority (peer leave) is immediate suspicion — no
  grace wait.

### Election

1. On suspicion, the peer increments its known term and broadcasts an
   `authority.election` message carrying its state observations.
2. Every connected eligible member is a candidate: a higher-term campaign
   makes followers join it and makes a sitting authority step down (its
   stale term can never win).
3. After `electionWindowMs`, the deterministic winner — the lowest connected
   eligible member id — is the same for every peer that sees the same
   membership. The winner announces its term and state revision.
4. If the winner never materializes (it missed the campaigns while
   reconnecting, or a partition hid it), a winner-wait timer re-elects at the
   next term, so the party cannot stall.

### Restore and buffering

- The elected winner waits `restoreWindowMs`; peers whose replicated state is
  higher (or conflicts at the same revision) push it to the winner, which
  adopts the **highest valid** replicated state — the adopted state's hash is
  verified at the end of the window and the previous replicated state is
  restored on mismatch — before processing any buffered actions.
- **Actions buffer during election**: dispatchers hold actions until an
  authority is announced, and in-flight actions are re-sent when the
  authority changes; the authority's bounded processed-action history and
  its queue deduplicate, so no action commits twice after migration.

### Reconciliation

- **Announcements** at the same term from different members reconcile by
  (state revision, then lower member id): both sides compute the same
  winner, so a partition merge converges on exactly one authority.
- **State** at the same revision with conflicting hashes resolves by the
  majority-matching hash (votes from snapshots, announcements, and election
  observations), then a stable tie-breaker (the hash reported by the lowest
  member id). The winning authority re-broadcasts so every shell converges.

### Configurability and testing

All timings (heartbeat, grace, election window, restore window) are
configurable per session for deterministic fake-timer tests; the test arena
can force and display migration (election state — term, in-progress flag,
last heartbeat — is visible in Nova diagnostics). fast-check property tests
over random join/leave/disconnect/reconnect/partition sequences assert
single-authority convergence, state convergence, and exactly-once action
application, and run in CI.

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
