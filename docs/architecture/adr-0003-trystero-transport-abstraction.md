# ADR-0003: Trystero transport abstraction

**Status:** Accepted.

The Nova API uses a transport interface from `packages/core`. The editor
arena uses an in-memory implementation so multiple players can test a game
without networking. Real parties use pinned Trystero 0.27.0 through
`packages/trystero-transport`. Both adapters run the same contract suite.
Games receive the Nova API and need no knowledge of Trystero.

Trystero owns discovery, WebRTC, peer routing, actions, and request/response
transfers. Nova uses the WebSocket relay strategy with one Cloudflare Durable
Object per signaling room. Use managed TURN when browsers cannot connect
directly. Early tests joined over shared Wi-Fi but repeatedly failed between
desktop Wi-Fi and iPhone cellular without TURN.
A pair whose data channel stalls or fails can use an encrypted WebSocket
tunnel via `rtcPolyfill`. The edge forwards data between two sockets. Each
browser confirms its choice over the tunnel before exposing it as open.
If a peer chooses WebRTC during pairing, Trystero can retry the interrupted
pair. Signaling and the tunnel both require a reachable edge hostname.

Nova keeps a game seat separate from a connection. Trystero's persistent
user identity groups tabs and can fall back to an ephemeral identity when
storage fails. Nova currently uses ephemeral Trystero endpoints and a
stable Nova seat ID. The adapter validates each peer's signed identity
announcement and transport version, then waits for mutual readiness.
A Trystero action sent during the remote peer's handshake can be dropped.
The adapter retries readiness acknowledgements and bounds early traffic
until a peer is ready. Nova's game authority and succession rules are
independent of Trystero's room roles.

Nova targets game traffic to admitted peers. Trystero's native room broadcast
can reach a peer before Nova validates its identity and version. A future
shared update can use the public broadcast API if the update is safe for every
Trystero room peer and fits the existing state and catch-up rules. Private
views remain targeted.

`scale()` keeps a mesh for up to ten players and routes small messages through
an overlay beyond that. Large transfers can temporarily open direct links
beyond the configured neighbor target. A game with frequent private updates
can still saturate its host's connection. See
[large-room measurements](../testing/large-room-load.md).

When changing the Trystero pin, exercise the arena contract, reconnect and
teardown, the edge relay protocol, forced tunnel play, and large source
transfers. Check which browser interfaces `rtcPolyfill` must implement, and
bump the Nova transport version for incompatible peer protocols.
See the [Cloudflare runbook](../../deploy/cloudflare.md) and
[release checks](../../PLAN.md).
