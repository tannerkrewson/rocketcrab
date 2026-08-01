# F5 Cross-Device Checklist (Human Pass)

Completes Beads issue **F5 — Validate backendless Trystero connectivity**
(`rocketcrab-9fv.1.5`). The automated same-machine results are in
`docs/testing/trystero-connectivity-findings.md`; this checklist covers the
scenarios that require real devices and real networks. The parent orchestrator
runs this pass with a human.

## Prerequisites

1. Serve the harness so phones can reach it:
   ```sh
   cd spikes/trystero-connectivity
   npm run dev:host        # vite on 0.0.0.0:5199
   # or: npm run build && npm run preview -- --host 0.0.0.0
   ```
   Get this machine's LAN IP (`hostname -I` or `ipconfig`). Phones must open
   `http://<LAN-IP>:5199`. (This URL only loads the page JS; all P2P traffic is
   relays + WebRTC, so corporate/guest Wi-Fi may block the LAN URL — in that case
   temporarily serve the harness from any HTTPS static host.)
2. Devices: at least 2 desktop browsers (can be this machine + a second laptop)
   and at least 2 iPhones (Mobile Safari). Best coverage: one iPhone on the same
   Wi-Fi as a desktop, one iPhone on cellular.
3. On every device, use the SAME `appId` (default `rocketcrab-f5-spike`) and the
   SAME room code. Create on one device, join on the others.

## How to record

For each scenario note: date, devices + browsers, network (same Wi-Fi / desktop
Wi-Fi + phone cellular / two phones different networks / hotspot), room code,
discovery time (log timestamps are auto-stamped), ping ms (shown in log), transfer
time for 5 MiB, and PASS/FAIL/notes. Screenshots or a short screen recording of the
phone(s) are ideal.

## Scenarios

### S1 — Two separate desktop devices

1. Serve the harness. Open on device A (desktop) and device B (second desktop).
2. A creates room `TST1`; B joins `TST1`.
3. Record: B appears in A's peer list and vice versa; ping from A.
4. PASS if both see each other within ~30 s.

### S2 — Desktop + iPhone on the same Wi-Fi

1. Desktop creates room `TST2`; iPhone joins `TST2` over the same Wi-Fi.
2. Record discovery time and ping (loopback/AP RTT expected, low).
3. PASS if connected.

### S3 — Desktop on Wi-Fi + iPhone on cellular (hotspot or carrier)

1. Desktop creates room `TST3` on Wi-Fi; iPhone joins over cellular data.
2. Record discovery time, ping, and whether the connection survives >1 min.
3. This is the first real NAT-traversal test. **If it fails**, capture the log
   (relay socket states, join errors) — this is the strongest TURN signal.

### S4 — Two phones on different networks

1. Phone 1 creates room `TST4` (network A); Phone 2 joins (network B, ideally
   different carrier or another location).
2. Record discovery + ping + 5 MiB transfer (S7 below can be combined here).
3. PASS if connected. This is the critical phone-to-phone case for the TURN
   decision.

### S5 — Four simultaneous peers (mix)

1. Desktop (creator) + 2 phones + 1 more device join room `TST5`.
2. Record whether all 4 see each other and can ping one another.

### S6 — Peer leave and rejoin (cross-device)

1. Connected pair/group. One phone leaves (Leave button), then rejoins the same
   room code.
2. Record rejoin time (the automated run measured ~20 s on loopback — is it
   similar cross-device?).

### S7 — Large HTML transfer (5 MiB)

1. With ≥2 devices connected, press "Send 5 MB" on one device.
2. Record transfer time shown in the receiving device's log and whether the hash
   sizes match (receiver logs byte count + ms).

### S8 — Backgrounding Mobile Safari

1. Connected pair: desktop + iPhone.
2. On the iPhone, press Home (background Safari for 1–3 minutes), then return.
3. Record: does the desktop report the peer leaving? Does the iPhone rejoin on
   its own, or is a manual Leave/Rejoin needed? What do the logs show?
   (Feeds M1 + S3: mobile browser suspension.)

### S9 — Connection failure reporting

1. On one device, switch to airplane mode or a dead relay (`relays` field is
   spec-only; simplest is airplane mode).
2. Try to join a room. Record what the UI/log shows (socket states, errors) and
   whether it eventually recovers when connectivity returns.

## Report back to the orchestrator

Send back: per-scenario PASS/FAIL + recorded numbers (especially S3 and S4), any
TURN-suspected cases (relay logs showing no usable candidates, STUN failures), and
a verdict on the F5 recommendation table:

- default Nostr relay configuration,
- TURN disabled or enabled by default,
- connection timeout,
- retry behavior,
- local telemetry.

If phone-to-phone connectivity is unreliable without TURN, the orchestrator will
spawn a **P0 discovered issue for temporary TURN credentials** that blocks
production release (per F5 blocking conditions). Do not silently replace Trystero.
