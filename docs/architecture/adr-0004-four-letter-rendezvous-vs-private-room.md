# ADR-0004: Four-letter rendezvous versus private party room

- **Status:** Accepted (relay configuration details **Pending** F5)
- **Date:** 2026-08-01
- **Owner:** Rocketcrab Nova planning (Phase 1)
- **Related:** ADR-0011 (secrets), P2 (rendezvous and admission), F5
  (connectivity spike), ADR-0003 (transport)

## Context

Rocketcrab's signature experience is a short, human-friendly room code. Nova
must preserve a four-letter code experience **without a central room-code
server** (ADR-0001). A four-letter code has only ~26^4 combinations — far too
little entropy to be a private session secret — and codes will collide between
concurrent parties.

## Decision

**A four-letter code identifies a public rendezvous namespace, not the real
party room.** The alphabet is human-readable, omits easily confused letters,
and remains alphabetic.

### Creation flow (P2)

1. Generate a four-letter code.
2. Join its rendezvous room.
3. Listen briefly for an existing party advert.
4. Regenerate on detected collision where possible.
5. Generate a cryptographically random session secret (Web Crypto).
6. Derive the private room ID and Trystero password from that secret.
7. Advertise a **minimal** party summary through the rendezvous room.
8. Admit joiners explicitly (Trystero peer-handshake admission).
9. Send the private secret only after admission.
10. Join the private room.

### Joining flow (P2)

1. Normalize the entered code.
2. Join the rendezvous room.
3. Discover available party adverts.
4. Let the player select if a collision exposes more than one party.
5. Send a join request.
6. Wait for approval.
7. Receive private session data over the established encrypted peer
   connection.
8. Join the private party room.
9. Leave unnecessary rendezvous connections.

### Greeter migration

The original creator is initially the rendezvous **greeter**. If that peer
leaves, another admitted party member becomes the greeter so the four-letter
code remains usable for late joiners. **Greeter status is separate from game
authority** (ADR-0007) — the creator is never permanently privileged.

### Admission

Trystero's peer-handshake mechanism keeps unapproved peers out of normal party
events. A pending peer must not receive the game source or the private room
secret (P3 depends on this).

## Alternatives considered

1. **Code-as-secret (the code IS the room).** Rejected: 4 letters are
   guessable; anyone guessing a code would join the private room directly.
   This is the exact attack the two-tier model prevents.
2. **Fixed public room per code.** Rejected: no admission control, no way to
   distinguish colliding parties, no private channel for the game.
3. **Central room-code registry.** Rejected: requires a backend (ADR-0001).
4. **Long codes.** Rejected: destroys the product's four-letter UX.

## Tradeoffs

- **Two-phase join latency.** Joiners go through rendezvous discovery +
  admission + private-room join. The public rendezvous advert must be minimal
  (no game source, no secrets).
- **Collision handling.** Adverts are namespaced by code; collision detection
  and a picker add UI complexity (P2, P4) but make collisions safe.
- **Relay dependence.** Rendezvous depends on Nostr relay availability and
  behavior; F5 validates and records relay recommendations.

## Consequences

- Guessing a code never admits a peer (acceptance: P2).
- The private room uses high-entropy material derived from a CSPRNG session
  secret; invite links bypass four-letter discovery (ADR-0011).
- Malformed join requests are rejected; end-to-end tests cover creation,
  approval, rejection, collision, and greeter migration (P2).
- Party secrets never enter game runtime messages or the game DOM.
- Default relay configuration, connection timeout, and retry behavior are
  **Pending** until F5 completes.
