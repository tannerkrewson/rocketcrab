# ADR-0003: Trystero transport abstraction

- **Status:** Accepted
- **Date:** 2026-08-01
- **Owner:** Rocketcrab Nova planning (Phase 1)
- **Related:** U5 (InMemoryTransport), P1 (TrysteroTransport), S1 (Nova API),
  ADR-0004 (private invites), F5 (connectivity spike), M3 (TURN decision),
  P0 `rocketcrab-23s` (TURN implementation)

## Amended 2026-11-15: WebSocket tunnel fallback

Networks that block all WebRTC, TURN included, are covered by a per-pair
tunnel. Nova passes Trystero a `rtcPolyfill` class
(`packages/trystero-transport/src/fallback-peer-connection.ts`) that wraps the
browser's `RTCPeerConnection`. If a pair's data channel has not opened 8 s after
both descriptions exist, or ICE reports `failed`, that pair's one data channel
moves to `wss://<edge>/tunnel/<pairId>`. The pair ID is a SHA-256 of both DTLS
fingerprints and the room ID, so both sides compute it without extra signaling.
Each `pairId` is one `TunnelPair` Durable Object (`deploy/edge/tunnel.ts`) that
forwards binary frames between at most two sockets. Frames are AES-GCM
encrypted with directional keys derived from the party secret
(`tunnel-crypto.ts`), so the edge never sees plaintext. Trystero keeps the same
channel object and sees `connecting` and then `connected`; the switch is
one-way once the pair is on the tunnel (see below). Media tracks are not tunnelled.

Native wins until the tunnel pairs: a side still waiting for `paired` whose
native channel opens drops its socket and stays native. Both sides start
their 8 s deadline one signaling hop apart, so this rule keeps them on the
same path. Once paired, the switch is one-way. The only remaining split is a
native open inside the one-way latency between the two `paired` frames; the
dropped socket then fails the partner at once and Trystero retries the pair.

Re-check the RTCPeerConnection surface in the upgrade checklist below on every
Trystero upgrade; the wrapper relies on it.

## Amended 2026-11-13: owned room-scoped signaling

The decision and addenda below preserve their historical context; Nostr relay
selection and older Trystero API descriptions are superseded by this amendment.
The real-party adapter uses pinned Trystero 0.27.0 and
`@trystero-p2p/ws-relay`, not public Nostr relays or a Nostr fallback. Trystero
still owns peer discovery protocol, WebRTC connections and action transport;
Nova owns the adapter, admission policy, and the signaling service. The local
arena remains transport-neutral and games do not see Trystero.

The adapter derives a room key from the first 16 bytes of SHA-256 of the
concatenated app ID and room ID, hex encoded, and connects to
`/signal/:roomKey` on the configured edge origin (HTTPS becomes WSS). The edge
routes each key to a separate `SignalHub` Durable Object. It implements the
Trystero WebSocket relay subscribe/publish protocol, including publisher echo;
socket subscription attachments survive hibernation and messages are not
persisted. Origin checks and connection rate limits apply. This is signaling,
not a WebRTC data fallback; TURN is the cross-network mechanism, with the
WebSocket tunnel (amendment above) as the last resort.

Source and local test evidence are in PLAN §4.5 and the
[edge runbook](../../deploy/cloudflare.md). The code is staged, not evidence of
a live deployment or successful real-device cross-network operation; release
verification remains in PLAN §9. Historical public relay observations are
retained in [F5 findings](../testing/trystero-connectivity-findings.md). The
[large-room state-mode experiment](../testing/large-room-load.md) records local
headless measurements and open release gates; it is not phone evidence. Its
[in-process authority fan-out simulation](../testing/large-room-load.md#in-process-simulation-no-webrtc)
measures 10–200-player authority traffic over the in-memory transport, with no
WebRTC, and is likewise not phone or real-network evidence.

## Context

Real parties connect peer-to-peer. Rocketcrab Nova uses **Trystero** for all
real party transport (plan section 3.3). At the same time, the multi-player
test arena must run several simulated players on one page **without** WebRTC,
and the game-facing API must behave identically in both worlds.

Trystero provides multiple discovery strategies behind one room/action API
(Nostr is the default package strategy), plus structured and binary actions,
large-payload chunking, progress callbacks, request/response actions, peer
admission handshakes, latency measurement, media streams, join-error reporting,
and optional TURN configuration. F5 will validate the backendless premise and
recommend relay/TURN settings.

The transport-neutral interface lives in `packages/core`
(`packages/core/src/transport/`); the real-party adapter lives in its own
package `@rocketcrab/trystero-transport` (P1), which is the only package that
may import Trystero (enforced by the root oxlint `no-restricted-imports`
rule, per ADR-0013). `packages/core` does not depend on Trystero.

## Decision

- **Trystero is used for every real party connection** and is **never exposed
  to generated games**. Game code (via `packages/nova-api`) sees only the
  Nova API (S1) — no Trystero terminology, no room objects, no peer objects.
- **A transport-neutral Nova interface** lives in `packages/core` with at
  least two implementations:
  - `InMemoryTransport` — the local test arena (U5). Deterministic, seeded,
    with configurable latency, jitter, loss, duplication, reordering, and
    simulated background suspension. No production Trystero code required to
    run the arena.
  - `TrysteroTransport` — real parties (P1), Nostr strategy initially, with
    join-error mapping, relay-state diagnostics, ping/quality sampling, a TURN
    configuration hook, and native request/timeout delegation.
- **The game-facing API behaves the same over both transports.** The adapter
  must pass the same contract suite as `InMemoryTransport` (P1 acceptance).
- Trystero remains replaceable _behind_ the interface, but the plan forbids
  silently replacing Trystero itself; F5/M3 own any TURN or relay changes.

## Simplification addendum: native source requests

The source coordinator uses one native binary request response (maximum 2 MiB)
with Trystero's fragmentation/backpressure, response correlation, progress,
receive admission, timeouts and disconnect handling. Nova removed its source
chunk framing, ACK-driven retransmits, retry counts and cancel-message protocol.
The adapter has an 8 MiB shared receive reservation budget, 16 KiB request limit,
and per-request response admission. The source cache retains at most eight
verified documents. In-memory request parity is exercised through the existing
fault-injected hub; the real adapter adds no custom reliability protocol.

Nova deliberately retains metadata/compatibility checks, SHA-256 and exact-size
verification, and the positive `game.source.accepted` application decision.
Transport delivery alone cannot establish that a game was verified/accepted.
State/action IDs, deduplication, revisions and authority ordering are untouched.
Explicit refresh/reconnect retries a failed source; there is no automatic source
retry loop. The selected source remains available from surviving verified peers.

Nostr uses maintained Trystero defaults, not the F5 spike-era pinned relay list.
Operator overrides remain possible. Historical probe results below/in F5 do not
establish current cross-network reliability. A real two-page 2 MiB source transfer
passes on this machine; multi-hour and Mobile Safari cross-network proof remains
required before release. See the party/transport package READMEs for retained
mechanisms and browser test commands.

## Amended 2026-11-13: experimental scale routing

The Trystero adapter enables the 0.27 `scale()` plugin with nine direct
neighbors, retaining a full mesh for up to ten peers while allowing virtual
routes in larger rooms. Trystero owns overlay routing and bulk transfer; Nova
still owns identity admission, source verification, cancellation and party
semantics. A test-only eight-browser, four-neighbor setup verifies a 2 MiB
source over a multi-hop route with new signaling blocked. This is not proof of
arbitrary room size or real-device behavior: the 10/25/50/100 load tests and
phone gate in `PLAN.md` remain open.

Source review on 2026-11-13 found a further release blocker: pinned Trystero
0.27.0 `scale/descriptors.mjs` bounds tracked overlay descriptors at 2,048,
including the local descriptor. When admitting a new non-direct peer at that
count it evicts an expired non-direct descriptor, or refuses admission if none
is eligible; direct peers bypass that check. This is not a simple room-size
cap, but it prevents a claim of arbitrary-size complete rosters and routing.
The owner must decide how to address the bound and its security/resource
tradeoffs; see §3.6 in `PLAN.md`. No boundary load test has been performed.

## Status update 2026-11-13: Trystero 0.27

Checked against the code at base `b760379` on branch `nova`. The table states
what the code does today. Planned or deferred work appears only where it is
labelled, with its PLAN section. Where this section disagrees with the Context
or Decision text above (Nostr strategy, older API names), this section governs;
the older text is kept as history.

"Trystero owns" means the behaviour is implemented by the pinned
`@trystero-p2p/ws-relay` 0.27.0 package and its `@trystero-p2p/core` dependency.
"Nova owns" means Nova code decides the behaviour, even where it calls a
Trystero API. Code locations are relative to the repository root.

### Ownership split

| **Trystero owns**                                                                                                                                                                                                                                                                                               | **Nova owns**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Signaling client.** Relay WebSocket and the subscribe/publish/echo protocol, via `joinRoom` `relayConfig` (`packages/trystero-transport/src/trystero-transport.ts:684-696`). Socket state is read from `getRelaySockets()` (`:1074-1088`). Trystero implements the wire protocol; Nova supplies only the URL. | **Signaling service.** `SignalHub` Durable Object with per-socket limits and hibernation attachments (`deploy/edge/signal.ts`); `/signal/:roomKey` Origin and rate-limit gate (`deploy/edge/worker.ts:80-101`); room key from SHA-256 of appId plus roomId (`packages/trystero-transport/src/signal-url.ts`). Nova runs the relay, so signaling availability is site availability (PLAN §4).                                                                                                                                                          |
| **Peer connections and transfer.** WebRTC peer connections, data channels, chunking, backpressure and action progress (`onReceiveProgress`, `trystero-transport.ts:219, 864`).                                                                                                                                  | **Transfer policy.** Receive cap `maxReceiveBytes` of 8 MiB (`:690`); pre-admission buffer of 32 messages and 8 MiB (`:1007-1008`); request limit of 16 KiB and response limit of 2 MiB per request (`:213-216`). Nova sets the limits; Trystero enforces the transfer.                                                                                                                                                                                                                                                                               |
| **ICE and TURN use.** Applies `turnConfig` entries to the peer connections (`trystero-transport.ts:696`).                                                                                                                                                                                                       | **TURN credentials.** Short-lived credentials minted by `/turn` (`deploy/edge/turn.ts`) and fetched once per party (`apps/nova/src/lib/party/turn-creds.ts`). The long-lived key stays a Worker secret (M3; PLAN §1).                                                                                                                                                                                                                                                                                                                                 |
| **Source transfer mechanics.** The single binary request: fragmentation, backpressure, correlation, cancellation and timeout (`packages/party/src/game-source.ts:452-457` calls `transport.request`; adapter `requestAction` at `trystero-transport.ts:202-238`).                                               | **Source acceptance.** Metadata and compatibility checks, SHA-256, exact-size and UTF-8 verification, the eight-source cache and the positive `game.source.accepted` decision (`packages/party/src/game-source.ts:18, 426-497, 590-600`). Delivery alone is not acceptance.                                                                                                                                                                                                                                                                           |
| **Identity transport.** Signed user-state slot `nova.identity` (`makeUserState`, `trystero-transport.ts:765`) under ephemeral `identity: "none"` (`:687`). Trystero user IDs are not Nova identities.                                                                                                           | **Identity and admission.** Stable `member-` IDs (`apps/nova/src/lib/party/identity.ts:12`); payload parsing (`packages/trystero-transport/src/wire.ts:86`); bilateral acknowledgement before a peer is published, admission timeout and duplicate-connection rejection (`trystero-transport.ts:762-900`). Persistent Trystero identity is deferred pending an owner decision (PLAN §3.5).                                                                                                                                                            |
| **Typed room errors.** `RoomError` reports carrying `code`, `peerId`, `appId` and `roomId`, delivered through `room.onError` (`trystero-transport.ts:889`).                                                                                                                                                     | **Error meaning and notices.** Code-to-category mapping (`packages/trystero-transport/src/errors.ts:86-107`); adapter-detected `relay_unreachable`, `join_timeout` and `handshake_timeout` (`trystero-transport.ts:722, 876, 1104-1112`); attempt-scoped, qualified notices (`apps/nova/src/lib/party/connection-errors.ts`, `engine.ts:518-519, 1579, 1879`). A per-peer `room-full` or `decrypt-failed` does not diagnose the local join.                                                                                                           |
| —                                                                                                                                                                                                                                                                                                               | **Roster and host.** Members are deduplicated by Nova member ID; host is the connected creator, otherwise the first sorted member ID (`packages/party/src/session.ts:109-124`). `makeUserState` replacement is deferred: a per-user list can include unadmitted peers or several users for one member, and no ready flag exists (PLAN §3.5).                                                                                                                                                                                                          |
| —                                                                                                                                                                                                                                                                                                               | **Creator context.** The first valid context from an admitted, connected peer is kept (`session.ts:241-244`). `makeState` replacement is deferred: a signed slot can relay a departed author's value, and validation must still bind to the admitted forwarder (PLAN §3.5).                                                                                                                                                                                                                                                                           |
| —                                                                                                                                                                                                                                                                                                               | **Classic-room selection.** Announcements are accepted only from the current host (`session.ts:260-261`); requests are surfaced without a host check (`:257-258`). A `makeState` replacement would need the same host check, so it stays deferred (PLAN §3.5).                                                                                                                                                                                                                                                                                        |
| —                                                                                                                                                                                                                                                                                                               | **Authority election and migration.** Heartbeats, deterministic election and snapshot restore in `packages/nova-api/src/state-engine.ts` (`startElection` at `:909`, `finalizeElection` at `:957`) and the simulation engine, per ADR-0007. Trystero's `authority.mjs` is not used: it handles signed roles and moderation, not game-executor election (PLAN §3.4).                                                                                                                                                                                   |
| **Room lifecycle primitives.** `room.leave()`, and unsubscribe handles returned by room, action and user-state listeners.                                                                                                                                                                                       | **Lifecycle state machine.** Shared teardown barrier: `releaseRoom` keeps a rejected release as the barrier (`trystero-transport.ts:1153-1162`); `join`, `leave`, `reconnect`, `suspend` and `resume` (`:268-530`) rejoin with a fresh connection ID. Suspend tears the room down and resume rejoins; `setRelayConnectivity` is exported by 0.27 but not called. Engine: fail-closed on teardown failure (`engine.ts:267, 1134`) and auto-reconnect with backoff (`engine.ts:326, 1431`).                                                             |
| **Overlay routing.** `scale()` multi-hop routing, promotion of bulk transfers to direct links, and the upstream 2,048-descriptor bound (`@trystero-p2p/core` `scale/descriptors.mjs`).                                                                                                                          | **Configuration and status.** `scale({ maxDirectPeers: 9 })` (`trystero-transport.ts:689`) gives a full mesh up to ten players. Identity admission, source verification, cancellation and party semantics stay with Nova. Status per PLAN §3.6: adopted in code and marked experimental; a test-only eight-browser, four-neighbour proof passes; 10/25/50-player local headless runs are recorded in [large-room load](../testing/large-room-load.md) and 100 is incomplete; the descriptor bound is an open owner decision. No arbitrary-size claim. |
| `rtcPolyfill` hook.                                                                                                                                                                                                                                                                                             | **Tunnel fallback.** `FallbackPeerConnection` and its encryption, plus the edge `TunnelPair` (amendment 2026-11-15).                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Upgrade checklist

Re-verify every item on each Trystero upgrade. The installed core is under
`node_modules/@trystero-p2p/ws-relay/node_modules/@trystero-p2p/core/dist/`.

- **Pins and app IDs.** `@trystero-p2p/ws-relay` stays pinned exactly (root and
  `packages/trystero-transport/package.json`). Bump
  `packages/trystero-transport/src/app-id.ts` when the wire or identity format
  changes (PLAN §3.1).
- **RTCPeerConnection surface** (PLAN §5, `peer.mjs`). Trystero 0.27 uses
  `setLocalDescription` (implicit), `setRemoteDescription`, `addIceCandidate`,
  `localDescription`, `remoteDescription`, `signalingState`, `connectionState`,
  `iceConnectionState`, `onicecandidate`, `onconnectionstatechange`,
  `onnegotiationneeded`, `addEventListener`, `createDataChannel`,
  `ondatachannel`, `close`, `addTrack`, `removeTrack`, `getSenders` and
  `ontrack`. Data channels use `onopen`, `onmessage`, `onerror`, `onclose`,
  `close`, `binaryType`, `bufferedAmountLowThreshold` and `onbufferedamountlow`
  (`bufferedAmount` derives from them). Re-check the list. Confirm channels
  remain ordered and reliable, which the fallback design assumes.
- **State and identity** (PLAN §3.5, `state.mjs`, `identity.mjs`). User state
  is still last-writer-wins per user, keyed by user ID and ordered by HLC. A
  slot is still relayed after its author leaves. A value rejected by the
  application validator is not stored. `identity.mjs` still derives a
  22-character `userId` from the P-256 key and falls back to an ephemeral
  identity when IndexedDB fails. The adapter must still reject any change to
  the `nova.identity` payload, including `displayName`, and the admission tests
  must still pass.
- **Decrypt-failed semantics** (PLAN §7, `signal-handler.mjs`). As of
  2026-11-13, `decrypt-failed` is reported per peer for an incorrect password or
  a corrupted signal, deduplicated per peer for 60 seconds. Confirm this still
  holds. Confirm the `errors.ts` mapping and the qualified notice wording still
  match it.
- **Relay protocol** (PLAN §4, `ws-relay` `protocol.mjs` and `server.mjs`).
  Topics match `^[A-Za-z0-9_-]+$` and are at most 256 characters; 128
  subscriptions per socket; 200 messages per second with a burst of 400;
  256 KiB frames; publisher echo. Compare with `deploy/edge/signal.ts`.
- **Exports the adapter uses.** `joinRoom`, `scale`, `getRelaySockets`,
  `RoomError` codes, and room methods `makeAction`, `makeUserState`, `onError`,
  `onPeerJoin`, `onPeerLeave`, `getPeers` and `leave`. Confirm each still exists
  with the same semantics.
- **Scale** (PLAN §3.6). Re-check the 2,048 descriptor bound
  (`scale/descriptors.mjs`), the `maxDirectPeers` range of 4 to 32
  (`scale/topology.mjs`) and the 64-hop route limit. If upstream now offers a
  setting that removes the bound, revisit the owner decision before changing
  the status above.
- **Tests** (PLAN §3.1, §3.6, §5). Run `npm run check`,
  `npm run test:e2e:trystero` (`e2e-trystero/playwright.config.ts`),
  `npx playwright test -c e2e-trystero/scale.playwright.config.js`,
  `npx playwright test -c e2e-trystero/fallback.playwright.config.js` and
  `npm run test:edge:integration`. Run the Playwright suites in the pinned
  Playwright 1.62.1 image. Record results in the matching PLAN evidence.

## Alternatives considered

1. **Direct WebRTC code in the app.** Rejected: re-implements discovery, NAT
   traversal, chunking, and handshakes that Trystero already provides.
2. **Trystero only — no in-memory transport.** Rejected: the test arena needs
   deterministic, offline-capable simulation of many peers on one page; real
   WebRTC cannot do that.
3. **A fake transport layered only for tests.** Rejected: the arena is a
   product feature (U6), not a test seam; it must run the real game-facing API
   and lifecycle events.
4. **Exposing Trystero to games.** Rejected: games would depend on transport
   internals, break the test/party parity, and violate the isolation model.

## Tradeoffs

- **Abstraction cost vs. parity.** The interface is custom code at a core
  trust boundary; it must be validated by the shared contract suite (U5, P1).
- **Trystero version churn** is isolated to the adapter, at the cost of a thin
  mapping layer that must stay in sync with Trystero's API.
- **"Backendless" precision.** The abstraction does not guarantee direct
  connectivity; TURN may be needed (F5/M3, Blocker B2).

## Consequences

- P1 acceptance: core Nova code cannot import Trystero outside the adapter
  package (P1 landed: Trystero is a dependency of
  `@rocketcrab/trystero-transport` only; enforced by package boundary and an
  oxlint `no-restricted-imports` rule; see ADR-0013 for the npm workspaces
  note on boundary discipline).
- S1 acceptance: the same game code works in test and party transports.
- The test arena (U6) requires no production Trystero code.
- F5 records relay behavior, discovery/WebRTC timing, throughput, and a TURN
  recommendation; M3 decided whether TURN infrastructure ships (2026-08-12:
  **it does** — Outcome B, see addendum below).

## M3 addendum: TURN is required for cross-network release (2026-08-12)

- **Status:** Accepted (M3 verdict, Outcome B)
- **Related:** M3 (`rocketcrab-9fv.6.3`), F5 (`rocketcrab-9fv.1.5`), P0
  `rocketcrab-23s` (blocks M4/release), Blocker Register B2

### Decision

A fully static release is **not** reliable: **TURN is required** for
cross-network WebRTC (M3 selects Outcome B). The P0 implementation issue
`rocketcrab-23s` — a managed TURN service plus one tiny serverless endpoint
issuing short-lived credentials, with rate limiting, origin checks, and
abuse controls; **no game code execution, no room-state database, no
replacement of Trystero** — blocks M4 (`rocketcrab-9fv.6.4`) and production
release. Nova ships no reusable paid TURN credentials in public JavaScript;
production enables TURN only after that P0 issue lands (the `turnConfig`
hook is already wired in `@rocketcrab/trystero-transport`, P1).

### Decision inputs (measured / estimated)

| Input                                       | Value                                                                                                                                                                                                                                                                       | Source                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Cross-network success rate                  | **0% without TURN** (S3: desktop Wi-Fi → iPhone cellular FAILED repeatedly; same-Wi-Fi S1/S2 PASS via host candidates)                                                                                                                                                      | F5 human pass — `docs/testing/trystero-connectivity-findings.md` §7 |
| Mobile carrier failures                     | Carrier-NAT phone gathers only host candidates (no STUN); ICE never completes; repeated "configure TURN servers" errors                                                                                                                                                     | F5 S3                                                               |
| Corporate / restricted-network failures     | **NOT device-tested** — assumed likely worse than home Wi-Fi; consistent with Outcome B                                                                                                                                                                                     | assumption (residual risk)                                          |
| VPN behavior                                | **NOT device-tested** — assumed similar to corporate/restricted networks                                                                                                                                                                                                    | assumption (residual risk)                                          |
| Trystero join-error classification          | Structured `JoinError` for SDP/ICE failure → adapter maps to `peer_connection_failed` (`packages/trystero-transport/src/errors.ts`); relay failures are not structured (F5) — adapter detects via relay state + join timeouts                                               | F5, P1 transport                                                    |
| User-facing retry behavior                  | P4 party engine: categorized join errors drive retry UX; reconnect screen + auto-reconnect backoff (`apps/nova/src/lib/party/engine.ts`, `FATAL_CATEGORIES` in errors.ts)                                                                                                   | P4 party engine                                                     |
| Estimated TURN bandwidth                    | Payloads ≤ 5 MiB per transfer at ~3.9 MiB/s (loopback baseline); a 5 MiB payload to 4 peers ≈ 20 MiB per host; typical action payloads are KB-scale. Free tiers (Metered openrelay 50 GB/mo, free-tier coturn) are ample at party scale; re-measure on the P0 S3/S4 re-test | F5 measured throughput + estimate                                   |
| Abuse risk of public long-lived credentials | **High** — any visitor could relay arbitrary traffic through a public TURN account (bandwidth burn, IP-abuse exposure). Mitigation: short-lived credentials from the serverless endpoint + rate limiting + origin checks; long-lived credentials only for local dev         | analysis                                                            |

### Residual risks

- Corporate/VPN networks were **not device-tested**; assume worse than home
  Wi-Fi (consistent with Outcome B). Verify opportunistically during P0's
  S3/S4 re-test if a corporate/VPN device is available.
- The credential endpoint is new attack surface; rate limiting, origin
  checks, and abuse controls are mandatory, not optional.
- Free-tier provider allowances and stability are unverified until P0
  evaluates them (free options first — Metered openrelay, free-tier coturn —
  before any paid account).

### Pointer

P0 implementation issue **`rocketcrab-23s`**, updated 2026-08-12 to the full
Outcome B shape; blocks M4 (`rocketcrab-9fv.6.4`) and production release.
