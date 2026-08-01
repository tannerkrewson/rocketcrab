# Trystero Connectivity Spike (F5)

Temporary spike for Beads issue **F5 — Validate backendless Trystero connectivity**
(`rocketcrab-9fv.1.5`). Proves the backendless party premise on a single machine and
provides a manual UI for the cross-device human pass.

- Uses Trystero **0.25.3** with the **Nostr** strategy (default).
- Same-machine tests: `e2e/connectivity.spec.ts` (Playwright, multiple pages = peers).
- Cross-device tests: manual, see `docs/testing/physical-device-checklist-f5.md`.
- Findings and recommendations: `docs/testing/trystero-connectivity-findings.md`.

## Run the automated (same-machine) suite

```sh
cd spikes/trystero-connectivity
npm run test:e2e
```

This starts the harness page with Vite on `http://localhost:5199` and runs 11
scenarios (two peers, four peers, leave/rejoin, 5 MiB transfer, structured action,
binary transfer, admission rejection, password room, ping, relay drop/reconnect,
connection failure). Requires network access to public Nostr relays.

## Serve the harness for the manual (cross-device) pass

```sh
cd spikes/trystero-connectivity
npm run dev:host        # binds 0.0.0.0:5199
# or: npm run build && npm run preview -- --host 0.0.0.0
```

Open `http://<this-machine-lan-ip>:5199` on each device. All devices must use the
same `appId` (default `rocketcrab-f5-spike`) and the same room code. Create on one
device, join on the others.

## Driver surface

The page exposes `window.__harness` (used by the spec, also wired to the UI):

- `createRoom(opts)` / `joinRoomByCode(opts)` — `{ room, password?, relays?, admission?, handshakeTimeoutMs? }`
- `leave()`, `sendStruct()`, `sendBinary(bytes)`, `sendLarge(size?)`, `ping()`
- `dropFirstRelay()`, `setAdmissionAllowList(ids)`, `getState()`, `getSelfId()`, `getConnectionStates()`
- `defaultRelayUrls`, `LARGE_SIZE`

Only Trystero's built-in surfaces are used: `onJoinError`, `onPeerHandshake`
(admission), `getRelaySockets` (relay state), `room.ping` (latency), and action
progress handlers. No parallel diagnostics were invented.

## Notes

- This spike is deliberately NOT part of the npm workspace; it resolves `vite`,
  `@playwright/test`, and `trystero` from the root `node_modules` via `../../`.
- Keep `spikes/trystero-connectivity` outside `apps/` and `packages/` so the
  workspace build/typecheck/test scripts are unaffected.
