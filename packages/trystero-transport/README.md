# Trystero transport

This package implements Nova's real-party transport with pinned Trystero
0.27.0 and its WebSocket relay strategy. Games use the Nova API. The in-memory
arena and this adapter run the same transport contract tests.

- **Connection:** the adapter configures the room's edge signaling URL, TURN,
  and the WebSocket fallback. Trystero manages discovery and peer connections.
- **Identity:** signed Trystero user state carries Nova's seat, connection ID,
  name, and version. A readiness acknowledgement keeps the first game message
  from racing the remote handshake. Nova only sends game traffic to admitted
  peers.
- **Transfers:** Trystero handles actions, requests, chunking, and backpressure.
  The adapter sets receive budgets, validates metadata, tracks readiness, and
  maps errors into Nova's connection messages.
- **Recovery:** reconnect and resume rejoin with a fresh connection ID. Join
  waits for an earlier room to finish leaving before it opens another.

See the [transport decision](../../docs/architecture/adr-0003-trystero-transport-abstraction.md)
and [edge runbook](../../deploy/cloudflare.md). Run `npm run test:e2e:trystero`
from the repository root for the real-browser adapter tests.
