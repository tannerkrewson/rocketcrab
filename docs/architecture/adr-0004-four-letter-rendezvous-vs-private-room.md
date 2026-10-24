# ADR-0004: Private invite parties (supersedes four-letter rendezvous)

- **Status:** Accepted; revised by the Nova simplification program
- **Owner:** Rocketcrab Nova
- **Related:** ADR-0003 (transport), ADR-0010 (trust), ADR-0011 (secrets), ADR-0007 (game authority)

## Decision

A party uses one password-protected Trystero room. Creation generates a
32-byte (256-bit) Web Crypto random secret. SHA-256 with domain-separated labels
derives room ID, password, and session ID. These derivations are deterministic,
so the invite secret is the only capability friends need to join.

Share one private `/join#secret=…` link using native sharing, copy, or the displayed
QR code. Opening it automatically joins with a saved/generated player identity;
name editing is optional. Import the fragment into the trusted shell and remove
it from the address bar/history. No secrets in paths, queries, application logs,
or untrusted game frames. No scanner, accounts, room backend, public adverts,
room codes, manual approval, collisions, or greeter role.

Trystero owns discovery, room passwords, ICE and peer reconnection. Every
participant remains in the same private room, so any connected participant can
keep the party joinable and distribute the hash-verified source and game state.
A stale invite with no remaining peer fails clearly instead of creating a new
solo lobby. Once everyone leaves, the in-memory party history is gone; the
random capability is not a server-stored reservation or persistent party.

## Shell controls, not game authority

The creator owns Nova shell controls while connected. If absent, the lowest
connected member ID owns them. Existing members share the original creator ID in
a validated private `party.context` message on peer join; no timer or public
advertisement is needed. Joiners wait for context before offering controls.
Returning creators regain preference. All connected peers converge with the same
membership; partitions can temporarily disagree about shell controls. This is
cooperative UI policy, not consensus or authorization against malicious friends.
Game authority retains its independent term/revision/history safety protections.

Shell controls include selecting games, asking participants to leave, and
reloading frames. Classic games' external-provider host roles do **not** migrate
as a consequence of a Nova shell handoff. A successor can select a new external
room, but cannot promise continuation of an external game that needs its host.

## Security and operational limits

Anyone with the invite can join or forward it. Cooperative kick is not a ban;
the holder can reuse the invite. To exclude a leaked invite, leave and create a
new party with a new secret and share it only with the intended participants.
Connected friends can inspect shared shell state; game frames receive only their
allowed API views. Local recovery stores the capability on the trusted main
origin to survive Safari tab reload; clean leave/dismiss clears it (ADR-0011).

Tests cover private creation/join, creator departure and successor controls,
late-join verified source delivery, identity recovery, stale invites, malformed
and spoofed control traffic, and transport cleanup. Cross-network TURN and
physical iPhone acceptance remain release gates, not proven by in-memory tests.
