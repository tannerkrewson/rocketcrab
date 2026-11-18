# ADR-0006: State and raw modes

- **Status:** Accepted (amended 2026-11-18: simulation mode replaced by ticks)
- **Date:** 2026-08-01
- **Related:** ADR-0007 (authority), ADR-0010 (trusted friends). The state-mode
  milestone is verified in `docs/testing/state-mode-vertical-slice.md`.

## Context

Nova games are written by AI chat services, so their code is uneven. Nova
must own everything distributed — state, ordering, authority, catch-up and
migration — or those games break in ways their authors cannot debug.

## Decision

**State mode** is the one game model. Nova keeps a single canonical state
(JSON, at most 512 KiB). The elected authority (ADR-0007) runs the game's
handlers through Immer, and every shell replicates the result (deltas,
hash-checked), so any player can take over and late joiners catch up.

- **Actions** apply once each, in order, with deduplication and rejections.
- **`tick` + controls** make a game real-time. The authority runs `tick`
  `tickRate` times a second (default 15, at most 60) on an elapsed-time clock;
  each player's latest `nova.controls.set` value (at most 1 KiB) is sent to the
  authority only when it changes, and `tick` reads it. Frames draw received
  states and interpolate between them.
- **`selectView`** hides information per player. Without it, frames receive the
  replicated state and no per-player copies are sent.
- A player whose page is hidden is not eligible for authority, and a sitting
  authority hands off at once, because a suspended phone would freeze the game.

**Raw mode** is the escape hatch: named, reliable, ordered channels with no
shared state, no migration and no catch-up.

## Why not a client-side simulation mode

Simulation mode (removed 2026-11-18) ran a copy of the game on every device
from ordered inputs and corrected drift with authoritative snapshots every
second. Each game had to queue inputs, serialize and restore its complete
state, keep held inputs in it, and live with visible snaps; AI-written games
got each of these wrong. A host-run tick needs none of it.

## Tradeoffs

- **Input lag.** A player's controls make a round trip through the authority
  (about 50–150 ms on Wi-Fi, more over TURN or the tunnel). Twitchy games move
  their own character locally and send its position as controls; the friends-only
  threat model (ADR-0010) accepts the trust that implies.
- **Authority upload.** Every tick's delta goes to every player. Measured
  2026-11-18 (8 players, 20 Hz, 750-byte state): about 320 KB/s before
  per-player view copies were removed for games without `selectView`, which
  roughly halves it. Real-time games are practical for small parties, not
  dozens of players.
- **No rollback netcode or server-side execution** (ADR-0001).
