# F5 Findings — Backendless Trystero Connectivity (Rocketcrab Nova)

Status: **DRAFT — automated same-machine results complete; cross-device results pending the human pass.**

Beads issue: `rocketcrab-9fv.1.5`. Trystero **0.25.3**, **Nostr** strategy (default).
Automated runs: `spikes/trystero-connectivity` Playwright suite, 11 scenarios,
multiple pages in one headless Chromium instance on one machine.

## 1. Scope and method

- **Automated (this document):** all scenarios executed between pages on one
  machine. WebRTC candidates are host/loopback candidates. This exercises the
  full protocol stack (Nostr relay discovery, signaling, SDP/ICE exchange, data
  channels, chunking, handshakes) but does **not** exercise real-network NAT
  traversal, carrier-grade NAT, corporate firewalls, VPNs, or phone lifecycle
  behavior.
- **Pending (human pass):** cross-device and phone scenarios. See
  `docs/testing/physical-device-checklist-f5.md`. Until that pass completes, no
  conclusion about TURN requirements is possible.

## 2. Scenario results (automated, one representative run)

| #   | Scenario                              | Result  | Key numbers                                                                                                                                                                                 |
| --- | ------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Two peers discover + establish WebRTC | PASS    | 497 ms join→peer-ready (loopback)                                                                                                                                                           |
| 2   | Four simultaneous peers               | PASS    | all 4 connected; all `connectionState === connected`                                                                                                                                        |
| 3   | Peer leave and rejoin                 | PASS    | leave→`onPeerLeave` immediate; **rejoin ≈ 20+ s** (see F3)                                                                                                                                  |
| 4   | Multi-megabyte HTML transfer          | PASS    | 5 MiB string in 1278 ms ≈ **3.9 MiB/s**; 322 send + 322 receive progress events; byte-exact hash match                                                                                      |
| 5   | Structured action transfer            | PASS    | nested JSON object round-trips                                                                                                                                                              |
| 6   | Binary transfer                       | PASS    | 1 MiB `Uint8Array`, exact hash match                                                                                                                                                        |
| 7   | Admission handshake rejection         | PASS    | rejected peer gets structured error, sees **zero** room events; approved peer connects after allow-list update                                                                              |
| 8   | Password-protected room               | PASS    | wrong password → structured `JoinError`; correct password connects                                                                                                                          |
| 9   | Latency measurement                   | PASS    | `room.ping` ≈ 1 ms loopback                                                                                                                                                                 |
| 10  | Relay disconnect + reconnect          | PASS    | socket reconnected in **3.28 s** (first backoff period ≈ 3.3 s); established peers unaffected; new peer joined after recovery                                                               |
| 11  | Connection failure reporting          | PARTIAL | unreachable relay → no peer joins; **no structured `JoinError`** for relay failure; diagnostics are socket `readyState` (stays CLOSED, silently retrying) + browser console WebSocket error |

## 3. Trystero 0.25.3 API facts used (verified from installed source)

- **Discovery:** Nostr strategy default relays = 47 public relays
  (`defaultRelayUrls`), 5 selected deterministically per `appId`
  (`getRelays(config, defaults, 5, deriveFromAppId=true)`: shuffle seeded by
  `appId` char-code sum). Override with `relayConfig.urls` and
  `relayConfig.redundancy`.
- **Admission:** `onPeerHandshake(peerId, send, receive, isInitiator)` in the
  third `joinRoom` argument. A peer is only activated (`onPeerJoin`) after **both**
  sides pass the handshake and exchange readiness. Throwing in the handler fails
  the peer with a structured `JoinError` (via `onJoinError`). Password
  challenge/response runs first when both sides set `password`.
- **Join errors:** `onJoinError` receives `{ error, appId, roomId, peerId }` for
  handshake failures (password mismatch, admission rejection, handshake timeout).
  It does **not** fire for unreachable relays.
- **Relay state:** `getRelaySockets()` returns `Record<url, WebSocket>` (raw
  sockets; `readyState` observable). Auto-reconnect is built in with exponential
  backoff: 3.3 s initial, doubling to a 60 s cap, jittered. `pauseRelayReconnection()`
  / `resumeRelayReconnection()` gate reconnects globally and are wired to browser
  online/offline events. `relayConfig.manualReconnection` exists in the types.
- **Large payloads:** `makeAction(ns, { onReceiveProgress })` +
  `send(data, { onProgress })` chunk large payloads automatically and report
  progress percentages on both sides.
- **Latency:** `room.ping(peerId)` returns ms.

## 4. Findings

- **F1 — Backendless discovery and WebRTC work.** Two and four peers discover and
  connect through public Nostr relays + WebRTC with no server. Loopback
  join→peer-ready ≈ 0.5 s when relays are healthy.
- **F2 — Large payloads transfer with progress and integrity.** 5 MiB transfers at
  ~3.9 MiB/s over loopback with byte-exact hashes and hundreds of progress events.
  Game HTML of this size is not a bottleneck for the protocol.
- **F3 — Rejoin latency is high (~20 s).** After a clean `leave()`, a rejoining
  peer took most of the 24 s test duration to be rediscovered. Plan for
  reconnect UX (retry, progress display) and investigate whether this is
  announce-propagation lag on relays; verify on real networks in the human pass.
- **F4 — Rejected peers are NOT cleaned up automatically (important).** When a
  peer fails the admission handshake, Trystero does not tear down the rejected
  client's room subscription. The rejected client keeps re-offering every ~5 s,
  churning the creator's offer pool and producing repeated `JoinError`s on both
  sides; in the spike this **starved a subsequent legitimate joiner** until the
  rejected client explicitly called `leave()`. **Implication for P2:** the join
  client must fail fast and leave the rendezvous on rejection; the greeter must
  also actively dispose of rejected peer handles. This is a real protocol-level
  behavior the Nova transport adapter must handle, not a hypothetical.
- **F5 — Relay-failure reporting is weak.** An unreachable relay produces no
  structured `JoinError`; Trystero silently retries forever (backoff to 60 s) and
  the only observables are `getRelaySockets()` readyState and browser console
  errors. **Implication for P1/P2:** Nova must surface relay state
  (connected/disconnected), impose its own discovery/join timeout, and map
  "no relay connectivity" to a user-actionable error category.
- **F6 — Relay auto-reconnect works.** Closing a relay socket reconnects in
  ~3.3 s (first backoff), re-subscribes topics, and established peer connections
  are unaffected (relays are signaling-only). New peers can still join after
  recovery.
- **F7 — TURN not exercised.** Loopback host candidates connect without STUN/TURN.
  Whether phone-to-phone connectivity needs TURN is **undetermined** until the
  human pass (Blocker Register B2).
- **F8 — Password errors are structured.** Wrong password surfaces
  `incorrect room password when decrypting offer` (or `incorrect password for
overlapping room` for overlapping-room cases) as a `JoinError`.

- **F9 — The harness must be HTTPS for real devices (WebCrypto secure
  context).** Trystero uses `crypto.subtle.importKey` (ECDH keygen) and
  `crypto.subtle.digest` (room namespace hash). `crypto.subtle` is only
  defined in secure contexts (HTTPS or `localhost`), so the harness served
  over plain HTTP on a LAN IP fails at `genKey`/`deriveRoomNamespace` with
  "Cannot read properties of undefined (reading 'importKey')" and peers
  never appear (0 peers). The automated suite passed on `http://localhost`
  precisely because localhost is a secure context, hiding this. Fixed
  2026-08-01: spike serves HTTPS with the F4 spike's locally-trusted certs
  (see checklist prerequisites).
- **F10 — Trystero's default relays are unreliable; pin verified relays.**
  On this network `wss://strfry.openhoofd.nl` fails TLS (`write EPROTO`)
  and others in `defaultRelayUrls` are dead/flaky. The spike now pins
  `GOOD_RELAYS` (`relay.damus.io`, `nos.lol`, `relay.primal.net`,
  `nostr.mom`, `relay.snort.social`, `offchain.pub`, `relay.nostr.info` —
  all probed reachable, 100–370 ms) with `relayConfig.urls` + redundancy 5.
  The recommendation-table row below is updated accordingly.

## 5. Recommendations (automated-pass basis; pending human-pass confirmation)

| Topic                             | Recommendation                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Default Nostr relay configuration | Ship with a pinned verified-reachable subset (the spike uses `GOOD_RELAYS`, 7 relays probed healthy, redundancy 5) and log which relays were selected; keep `relayConfig.urls` configurable. Trystero's `defaultRelayUrls` include dead/flaky endpoints (F10) — do not ship defaults unverified. Re-evaluate after the human pass measures real cross-network reliability.                 |
| TURN                              | **TURN disabled by default for the automated tests; likely required for phone-to-phone.** Cannot conclude until the human pass. Keep `turnConfig` wiring in the transport adapter from day one (a hook, not a hard dependency). If the human pass shows ordinary phone-to-phone fails without TURN, create the P0 TURN-credentials issue (per F5 blocking conditions) that blocks release. |
| Connection timeout                | Impose a Nova-level discovery/join timeout (~20–30 s) with visible progress, because Trystero's join can otherwise hang silently (F5). Distinguish "still connecting" from "relay unreachable".                                                                                                                                                                                            |
| Retry behavior                    | On structured `JoinError`: show the category (password mismatch, rejected, timed out) and offer retry. On relay failure: rely on built-in auto-reconnect, but surface relay state to the lobby; do not silently wait. Rejected joiners must leave the rendezvous immediately (F4).                                                                                                         |
| Local-only telemetry              | Keep telemetry local: per-join timings (discovery, establish), ping, transfer throughput, relay selection + socket state, join-error counts. All of this comes from Trystero's own surfaces (`getRelaySockets`, `ping`, `onJoinError`, progress) — no backend or analytics service needed.                                                                                                 |

## 6. What remains for the human pass

Cross-device and phone scenarios (two devices, iPhone on same Wi-Fi, phone on
cellular, phone backgrounding) — see `docs/testing/physical-device-checklist-f5.md`.
Until those pass: no TURN decision, no "backendless is reliable" claim, and per the
issue's blocking conditions **P1 and all real-party functionality remain blocked**.

**If phone-to-phone connectivity proves unreliable without TURN, the human pass
must spawn a P0 discovered issue for temporary TURN credentials blocking production
release. Do not silently replace Trystero.**
