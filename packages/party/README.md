# @rocketcrab/party

Private invite parties, with no room backend. See
[ADR-0004](../../docs/architecture/adr-0004-four-letter-rendezvous-vs-private-room.md)
and [ADR-0011](../../docs/architecture/adr-0011-secrets-and-invite-link-handling.md).

- `secrets.ts`: 32-byte CSPRNG secret; domain-separated room/password/session derivation.
- `invite.ts`: fragment-only invite URLs, no codes or admission.
- `session.ts`: one private transport, automatic membership, name updates, shell
  control succession, cooperative kick/reload, and classic-room announcements.
- `messages.ts`: validated private control messages, isolated from game APIs.
- `game-source.ts`: 2 MiB bounded, hash-verified source distribution and session cache.

The creator owns shell controls while connected; otherwise the lowest connected
member ID owns them. This does not elect game authority or migrate a classic
provider's host role. Every participant keeps the private room joinable and can
serve verified game HTML to later participants. An empty party is not persisted.

Anyone with the invite may rejoin after a cooperative kick. To exclude an invite
holder, start a fresh party and share a new link. Membership/control messages
validate their envelope against the actual transport sender and session.

Tests run the same flows over the in-memory transport. Real WebRTC uses the thin
Trystero adapter; cross-network/device behavior must still be checked separately.
