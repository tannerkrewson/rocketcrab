# @rocketcrab/party

Private invite parties, with no room backend. See
[ADR-0004](../../docs/architecture/adr-0004-four-letter-rendezvous-vs-private-room.md)
and [ADR-0011](../../docs/architecture/adr-0011-secrets-and-invite-link-handling.md).

- `secrets.ts`: 32-byte CSPRNG secret; domain-separated room/password/session derivation.
- `invite.ts`: fragment-only invite URLs, no codes or admission.
- `session.ts`: one private transport, automatic membership, name updates, shell
  control succession, cooperative kick/reload, and classic-room announcements.
- `messages.ts`: validated private control messages, isolated from game APIs.
- `game-source.ts`: one binary request response, exact UTF-8 size and SHA-256
  verification, a cache of at most eight 2 MiB documents, and a verified-acceptance
  control message. Trystero owns chunking, backpressure, correlation, progress,
  timeout, disconnect and cancellation. No source chunk framing, chunk ACKs,
  negative-ACK retry loop or automatic retransmits remain. Source responses
  time out after 120 seconds; explicit refresh or reconnect requests them again.
  Late joiners can request the selected verified source from any remaining holder.
  Cached bytes still run compatibility checks and confirm acceptance.

The retained `game.source.accepted` message is an **application decision**, not
transport delivery confirmation: only exact-size, valid UTF-8, SHA-256-verified
HTML may open a player's start gate. Rejected/corrupt HTML is never cached or
accepted. Receiver progress comes from Trystero; sender UI shows transfer start
then verified acceptance because the request API exposes no response-send
progress callback. Abort suppresses local completion and stale responses; bytes
already queued remotely may still finish sending. No custom remote-cancel
protocol was added. Metadata/discovery remain small schema-validated shell
controls, separate from game state/actions and invisible to game frames.

The creator owns shell controls while connected; otherwise the lowest connected
member ID owns them. This does not elect game authority or migrate a classic
provider's host role. Every participant keeps the private room joinable and can
serve verified game HTML to later participants. An empty party is not persisted.

Anyone with the invite may rejoin after a cooperative kick. To exclude an invite
holder, start a fresh party and share a new link. Membership/control messages
validate their envelope against the actual transport sender and session.

Tests run the same flows over the in-memory transport. Real WebRTC uses the thin
Trystero adapter; cross-network/device behavior must still be checked separately.
