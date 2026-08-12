# @rocketcrab/trystero-transport

P1 — the real-party implementation of the transport-neutral `NovaTransport`
interface (ADR-0003), built on **Trystero 0.25.3** (Nostr strategy). This is
the only package allowed to import Trystero (root oxlint
`no-restricted-imports`); generated games never see it (engineering rule 1).

The adapter mirrors `InMemoryTransport` (`@rocketcrab/testing`, U5) and passes
the same contract suite (`src/contract.test.ts`), so the game-facing Nova API
behaves identically in the local test arena and over real parties.

## Design summary

- **Room creation**: `joinRoom` with the Nostr strategy, relays pinned to the
  F5-verified `GOOD_RELAYS` set (F10) and redundancy 5.
- **App ID**: environment-specific — `rocketcrab-nova-dev` by default,
  `rocketcrab-nova-prod` for production builds (`vite build`). Every peer in
  a party must share the appId; override via options for e2e.
- **Peer identity**: exchanged during Trystero's built-in `onPeerHandshake`
  (same surface F5 used for admission policy). `peer:joined` always carries
  the peer's real `memberId`/`connectionId`/`displayName`.
- **Messages**: one `"nova"` action carries every message; the transport
  envelope (messageId, sentAt, channel, sessionId, seq, deliverySeq, binary,
  totalBytes) rides in Trystero action metadata. Broadcast (`target: null`)
  and targeted (`targetConnectionId`) sends; structured and binary payloads;
  Trystero's reliable-ordered channel (unreliable/unordered requests degrade
  to reliable/ordered — documented, not silent).
- **Progress**: Trystero reports progress as a fraction in [0, 1]; the
  adapter maps it to `TransferProgress` on both sides with byte counts.
- **Join errors**: categorized (`password_mismatch`, `rejected`,
  `handshake_timeout`, `peer_disconnected`, `peer_connection_failed`,
  `relay_unreachable`, `join_timeout`, …). Trystero gives NO structured error
  for relay failure (F5/F9), so the adapter detects it itself: relay socket
  `readyState` monitoring + `relayConnectTimeoutMs` (15 s) and an overall
  `joinTimeoutMs` (30 s). Errors after `join()` resolves (e.g. password
  mismatch during the slow discovery phase) go to the `onJoinError` observer
  and `getDiagnostics()`.
- **Diagnostics**: `getRelayDiagnostics()`, `onRelayStateChange()`,
  `getDiagnostics()`, `ping(connectionId)`, `sampleQuality()`.
- **TURN**: `turnConfig` option hook only — never hardcoded credentials
  (owned with M3 / Blocker B2).
- **Cleanup** (engineering rule 22): `leave()`/`suspend()`/failed joins
  detach room + action handlers, stop the relay monitor, and call
  `room.leave()`; rejected/failed joiners leave immediately (F4).

## Testing

- `src/*.test.ts` — deterministic contract tests with the `trystero` module
  fully mocked (fake clock + controllable relay sockets; no network).
- `src/contract.test.ts` — the shared contract suite, run against both
  `InMemoryTransport` and this adapter.
- `e2e-trystero/` at the repo root — real-browser integration tests over
  real relays + WebRTC (run `npm run test:e2e:trystero`; skips when the
  external relays are unreachable).
