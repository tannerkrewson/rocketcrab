# Local large-room state-mode load experiment

Owned by [ADR-0003](../architecture/adr-0003-trystero-transport-abstraction.md); PLAN §3.7 remains open. These are single-machine, headless Chromium loopback observations, **not phone measurements, network capacity claims, or proof of unlimited rooms**.

## Reproduce

From this checkout, install dependencies (`npm ci`) and Playwright's matching Chromium and OS dependencies. Linux is required for the memory guard and `/proc` CPU sampler. Reserve ports before starting servers, and run each persistent server in a managed terminal. The harness pins the following local origins; do not silently reuse unrelated services:

```sh
# Three separate terminals, from repository root:
VITE_EDGE_ORIGIN=http://localhost:5287 ./node_modules/.bin/vite e2e-load --host 127.0.0.1 --port 5273 --strictPort
VITE_MAIN_ORIGIN=http://localhost:5273 ./node_modules/.bin/vite apps/runtime --host 127.0.0.1 --port 5274 --strictPort
npm run edge:dev -- --port 5287 --var ORIGIN_ALLOWLIST:http://localhost:5273

# Once all three are ready; preserve each output on disk, then clean up.
mkdir -p "$HOME/.cache/tmp"
TMPDIR="$HOME/.cache/tmp" LOAD_SELECT_AFTER_JOIN=1 LOAD_TIMEOUT_MS=120000 \
  node e2e-load/run.mjs 10 "$HOME/.cache/tmp/load-10.json"
# Repeat with 25, 50 and 100, increasing gradually only when resources permit.
```

`LOAD_SELECT_AFTER_JOIN=1` selects the game after the roster converges. It is a legitimate user flow, **not a fix** for the create-with-game issue below. Omit it to reproduce the other flow. Set `LOAD_OMIT_PAYLOAD=1` to dispatch actions without the optional payload (the default sends an explicit empty object). The default guard stops below 6 GiB `MemAvailable`, above 512 MiB growth in host swap usage, or on a >10 s driver event-loop delay; `LOAD_MIN_AVAILABLE_KIB` and `LOAD_MAX_SWAP_GROWTH_KIB` can make the memory safeguards stricter. The guard samples `/proc/meminfo` once per second, so it cannot guarantee prevention of a sudden resource spike or detect all forms of host unresponsiveness. Monitor the machine independently and stop if needed. Do not run if the host is already busy. There is no multi-machine orchestration in this harness; independent CI shards running separate rooms are **not** a substitute for one 100-player room.

The page instantiates the real `PartyEngine`, default Trystero adapter, real `NovaSession` and runtime iframe with a minimal state-mode counter game. The edge is the current local room-scoped Worker relay; WebRTC data runs over loopback. Both web origins are localhost (same site), unlike production's separate sites; this is not a process-isolation or production deployment test. Distinct browser contexts provide isolated storage and identities. The host has a separate Chromium browser process; all other contexts share another. Joins are deliberately sequential. The all-see-all timer starts immediately before the first join, includes those joins, and checks each roster; it is not time after the last join. Lobby polling is once a second. State latency is measured by the Node driver from initiating the Playwright click on player 1 until all game frames display the incremented value, with 10 ms browser polling and Playwright/scheduling overhead. Ten actions run sequentially; it is not a wire RTT, percentile distribution, or high-rate traffic benchmark.

Authority CPU is measured only if all engines agree the isolated host is the elected authority after start. Linux `/proc` user+system tick counts for that browser's entire process tree are subtracted across the ten-action batch and divided by elapsed wall time (average cores). This includes browser, renderer and utility work, not just Nova or game execution; tick resolution was 10 ms. Processes that terminate between endpoint samples can be missed. No CPU result is emitted if the authority cannot be attributed. This is not CPU utilization on a physical device. The host and guests share a machine with other activity, so results are noisy.

## Results, 2026-11-13

[Recorded machine-readable metric samples](./large-room-load-2026-11-13.json) preserve the unrounded values. Base commit `a934c5f`, Linux 7.2.15 Fedora, 12 logical CPUs, 30 GiB RAM, Node 26.13.0, Playwright/Chromium 1.62.1, local WebRTC without TURN, Trystero 0.27.0, local workerd. One measured run per size; all three used `LOAD_SELECT_AFTER_JOIN=1`, and sample game actions included an explicit empty payload. These runs used the earlier one-button version of the same counter; the harness now adds a second button for testing omitted payloads. No engine error notices or page exceptions were recorded in these successful runs. The local `/turn` mint returned HTTP 500 because credentials were not configured; every participant warned and proceeded without TURN. Therefore these runs do not validate TURN.

| Players |                            all-see-all (ms) | game ready (ms) | 10 action-to-all samples (ms, in order)                                    | authority browser CPU seconds / batch seconds | minimum host available KiB |
| ------- | ------------------------------------------: | --------------: | -------------------------------------------------------------------------- | --------------------------------------------- | -------------------------: |
| 10      |                                    11285.65 |        12322.49 | 64.27, 63.31, 51.50, 47.37, 51.36, 48.33, 51.81, 47.37, 49.23, 51.32       | 0.06 / 0.529                                  |                   19442664 |
| 25      |                                    27387.62 |        28548.19 | 62.40, 64.46, 52.28, 63.72, 52.25, 63.19, 52.01, 63.19, 52.29, 63.38       | 0.07 / 0.595                                  |                   20638356 |
| 50      |                                    59246.50 |        62905.67 | 232.17, 116.59, 141.57, 88.33, 113.35, 113.19, 99.50, 81.83, 102.77, 78.52 | 0.21 / 1.182                                  |                   12798572 |
| 100     | incomplete: swap guard stopped at 78 joined |               — | —                                                                          | —                                             |                   12540140 |

The recorded 10/25/50 runs used a 4 GiB memory guard; the stricter 6 GiB, swap-growth and event-loop guards were added afterward for future runs. The initial successful-run roster check counted connected expected member entries, rather than checking uniqueness explicitly; the harness now additionally checks unique IDs and exact roster length for subsequent runs. This does not retroactively prove that stronger assertion for the recorded runs. The guard minimum reflects the whole shared host and varies with unrelated work. An early setup run incorrectly omitted `VITE_MAIN_ORIGIN` on port 5274: 10 rosters converged in 10.51 s but all runtime bootstraps timed out. Correcting the runtime's exact parent origin fixed that setup error.

## Rebased verification and resource-limited 100 attempt

After rebasing onto `4ec4023`, a 10-player create-with-game run using `LOAD_OMIT_PAYLOAD=1` passed: all-see-all 10435.09 ms, ready 11456.48 ms, no engine/page errors, and all frames saw ten successive actions. Raw action-to-all times (ms): 55.21, 61.89, 48.67, 48.66, 49.00, 51.62, 46.73, 51.48, 63.23, 48.54. The isolated authority browser consumed 0.06 CPU seconds over a 0.536 s batch; minimum available memory was 23486504 KiB and swap usage did not grow. This is one real-browser check of the fixes, not proof of all source-selection and disconnect cases.

On the same base, a 100-player create-with-game, omitted-payload attempt added players sequentially. The swap guard stopped it after 78 joined: host swap rose from 2000144 to 2559448 KiB (+559304 KiB, exceeding the 512 MiB growth guard), with minimum available memory 12540140 KiB and maximum monitor interval 1006 ms. The last separately observed load average was approximately 25 on 12 logical CPUs. Browsers exited and available memory recovered to about 24 GiB. No 100-player convergence, latency or CPU was measured; this is an incomplete run due to shared-host resource safeguards, not evidence of a product limit. A future attempt needs a quieter/larger host or a genuinely distributed single-room driver; this harness cannot yet orchestrate remote contexts.

## Two local browser servers and distributed feasibility (2026-11-14)

The optional `LOAD_TWO_LOCAL_SERVERS=1` mode is limited to ten contexts. It launches two independently controlled Playwright browser servers on **this same host**: an isolated authority browser and a guest browser containing nine separate contexts. The guest connects via Playwright `connect` with `exposeNetwork` restricted to the three local test origins. It still uses one real party room and the same game, signaling, guards and measurement method above. Reproduce with the same three local servers and:

```sh
TMPDIR="$HOME/.cache/tmp" LOAD_TWO_LOCAL_SERVERS=1 LOAD_OMIT_PAYLOAD=1 \
  LOAD_TIMEOUT_MS=60000 node e2e-load/run.mjs 10 "$HOME/.cache/tmp/two-local-servers.json"
```

One run on base `275c850` passed create-with-game and ten no-payload actions: all-see-all 10480.67 ms, ready 11503.35 ms, action-to-all 47.87–72.47 ms; the authority and guest browser process trees used 0.10 and 0.45 CPU seconds respectively over a 0.540 s batch. The whole shared host's minimum available memory was 16444712 KiB and swap grew by 56040 KiB; no engine/page errors were recorded and the local TURN mint remained unavailable. [Unrounded samples](./large-room-two-local-servers-2026-11-14.json) are recorded. These are **two browser-server processes, not two machines**: their memory and swap are shared, and no per-host comparison, remote proxy forwarding, cross-host WebRTC, 100-player run or real phone was demonstrated.

The intended next step is to spread CPU and memory across machines for one 100-player room, not to replace the separate cross-network/TURN or physical-device gates. A remote single-room variant appears technically possible, but this experiment does **not** implement or validate it. Concrete prerequisites before an owner-approved multi-host run:

- A trusted worker on each consented machine must launch a pinned compatible Playwright browser server, report its local browser PID and resource samples, enforce its own memory/swap/responsiveness thresholds, and terminate children if control disconnects or the lease expires. The coordinator must abort the **whole** run on any guard, crash, timeout, missing heartbeat, or unclean shutdown. Current `/proc` sampling and guarding are only on the coordinator host. Endpoint-subtraction CPU misses processes that exit between samples; improve accounting or retain that qualification. Measure authority on its own worker, not a shared guest process.
- Protect browser RPC as remote code execution. Installed Playwright 1.62.1 `types/types.d.ts` says `launchServer` defaults to loopback, an unguessable path, and warns that knowledge of the path can control the OS user. Do not publish it to a LAN or log its endpoint; use an authenticated encrypted tunnel and owner-controlled identities, with least-privilege isolated worker accounts. The current harness accepts no remote endpoint and creates no remote process.
- Ensure all participants reach the **same** room-scoped Worker and app/runtime origins. The installed `ConnectOptions.exposeNetwork` supports a restricted hostname/port list and exposes the connecting client's network to a connected browser, but the same-host proof cannot establish how it behaves across hosts or whether all WebSocket/iframe traffic works. Alternatively use explicitly reachable HTTPS/WSS origins and configure exact allowlists and runtime `VITE_MAIN_ORIGIN`. Do not substitute separate CI rooms for one 100-player room. Check the Worker's `signal:<ip>` rate limiter and `ORIGIN_ALLOWLIST`; local `wrangler dev` behavior is not production-rate-limit evidence.
- Network/control paths are not evidence of a working WebRTC data plane. Validate actual cross-host ICE candidates, WebRTC connectivity, signaling and any required TURN independently; avoid assuming Playwright network exposure tunnels peer data. Record route/relay conditions without publishing IPs, room secrets, browser endpoints or credentials. Use one coordinator's monotonic timestamps for action-to-all observations to avoid comparing unsynchronized machine clocks, and record controller/network/polling overhead.
- Before scaling, prove two physical hosts with a small number of isolated contexts, local and remote resource telemetry, all-see-all roster and state convergence, disconnect/guard cleanup, and secure endpoint access. Only then increment the **same room** toward 100 with owner-approved capacity. This requires a worker protocol, configuration, per-host tests, failure handling and operational setup; it is not established by this local proof.

## In-process simulation (no WebRTC)

[Recorded samples](./large-room-sim-2026-11-13.json) and the generator, `packages/nova-api/src/large-room-sim.test.ts`, run N real `NovaSession`s (the real session, protocol and state engine) in **one Node process** over the in-memory transport hub. There are no browsers, WebRTC, Trystero, servers or ports. Reproduce with `npm run sim:large-room` (about 70 s). It runs only with `LARGE_ROOM_SIM=1`, so `npm run check` skips it. Owner decision (2026-11-13): a 100-browser-player test is not reasonable on any machine. Real-browser runs stay at 50 or fewer, and this simulation covers larger rooms.

Method:

- **Hub:** seed `large-room-sim-v1`, one-way link latency 20 ms ± 5 ms (uniform jitter). Session authority timings are the defaults.
- **Game:** a counter with one score per player. Each player checks in once, so the canonical state holds N scores. Before measuring, the authority's processed-action history is filled to its cap (`STATE_HISTORY_LIMIT` = 256) with no-op actions, because every snapshot ships that history. An earlier attempt without this fill measured a smaller snapshot at small N. Those numbers were discarded.
- **Batch:** one non-authority player dispatches 20 sequential `increment` actions. Convergence is the wall-clock time until every session shows the new count. Bytes and messages come from wrapping each transport's `send`. A broadcast counts one transmission per recipient, as a WebRTC mesh pays for it.
- **Bytes** are JSON of an approximate envelope plus payload. They are not wire bytes.
- **CPU** is `process.cpuUsage()` across the batch. It is **whole-process** CPU, because every simulated player shares the process. It includes the waiting loop, and it is host CPU, not a phone.

Results, one committed run (sanity assertions only: convergence, one authority, and every session saw every action). A repeat run gave identical byte and message counts, convergence within 0.2 ms and CPU within about 15%.

| Players | Authority bytes/action | Authority msgs/action | Avg non-authority bytes/action (per member) | Authority bytes/action ÷ N | Convergence ms (mean / max) | Process CPU ms/action |
| ------: | ---------------------: | --------------------: | ------------------------------------------: | -------------------------: | --------------------------: | --------------------: |
|      10 |                120,892 |                 19.45 |                                         658 |                     12,089 |                 46.8 / 51.6 |                   2.6 |
|      25 |                326,745 |                 50.20 |                                         658 |                     13,070 |                 47.3 / 52.0 |                   3.8 |
|      50 |                684,986 |                101.45 |                                         658 |                     13,700 |                 48.5 / 52.9 |                   6.1 |
|     100 |              1,457,566 |                203.95 |                                         657 |                     14,576 |                 50.4 / 56.6 |                  11.1 |
|     200 |              3,227,527 |                408.95 |                                         657 |                     16,138 |                 52.1 / 58.3 |                  18.6 |

Only the dispatching player sends anything in this workload, so the non-authority average is that one player's bytes divided by N − 1.

Composition and peak memory:

| Players | Snapshot history per copy (B) | Snapshot state body per copy (B) | Dispatcher bytes/action (`action.dispatch`) | Peak process RSS (MiB, cumulative) |
| ------: | ----------------------------: | -------------------------------: | ------------------------------------------: | ---------------------------------: |
|      10 |                        11,777 |                              187 |                                       5,922 |                                155 |
|      25 |                        11,777 |                              412 |                                      15,792 |                                212 |
|      50 |                        11,777 |                              787 |                                      32,227 |                                312 |
|     100 |                        11,777 |                            1,537 |                                      65,083 |                                441 |
|     200 |                        11,777 |                            3,036 |                                     130,803 |                                447 |

Reading the results:

- **Authority bytes grow with N, slightly faster than linearly.** Across 10–200 players, bytes per action rise 26.7× for 20× the players (about N^1.10). Each commit broadcasts a full snapshot to all N − 1 peers, and each player then gets its own `state.view`. Views are about 4% of bytes; snapshots are about 95%. Heartbeats are 0.2% of batch bytes.
- **Most of each snapshot is the processed-action history, not game state.** The history is 11,777 bytes per copy at its 256-entry cap, which is 76–93% of each snapshot. That term does not depend on N, so it is the largest single cost even at 10 players. The state body grows about 15 bytes per player per copy.
- **Convergence stays near 47–52 ms (mean).** The hub delivers in parallel and does not model uplink serialization, so this understates what a real phone uplink would take.
- **Process CPU per action grows from 2.6 ms to 18.6 ms** across the same sizes. It is whole-process, so it is not the authority's CPU on any device.
- **Memory is well under the limit.** Peak process RSS was 447 MiB at 200 players, against a 4 GiB budget. Heap after setup (32–120 MiB) is noisy because GC was not forced.

Uplink estimate for the authority, from measured bytes per action. These are **projections, not measurements**, and they exclude WebRTC/SCTP/DTLS framing, so real totals are higher. Compare with a typical phone uplink of about 1–5 Mbit/s.

| Players | Authority @ 1 action/s (Mbit/s) | Authority @ 5 actions/s (Mbit/s) | Dispatcher @ 5 actions/s (Mbit/s) |
| ------: | ------------------------------: | -------------------------------: | --------------------------------: |
|      10 |                             1.0 |                              4.8 |                              0.24 |
|      25 |                             2.6 |                             13.1 |                              0.63 |
|      50 |                             5.5 |                             27.4 |                              1.29 |
|     100 |                            11.7 |                             58.3 |                              2.60 |
|     200 |                            25.8 |                            129.1 |                              5.23 |

**Verdict: the authority's upload is a bottleneck for a phone at 25+ players.** At 5 actions/s it is at the top of the phone range already at 10 players, and at 1 action/s it exceeds 5 Mbit/s at about 50 players. Two further findings:

- `action.dispatch` is sent without a target (`sendBufferedDispatch` in `session.ts` passes only `{ seq }`), so the hub delivers every dispatch to every peer. A non-authority player's upload therefore grows with N too: about 5.2 Mbit/s at 200 players and 5 actions/s, from that one player alone.
- The snapshot history, not the state, dominates the authority's upload at every size measured.

What this does **not** prove:

- real WebRTC/SCTP/DTLS cost, or real network bandwidth;
- Trystero `scale()` multi-hop routing (the hub is a full mesh);
- encryption cost;
- phone CPU, battery or thermal behavior (CPU here is host CPU, whole process);
- uplink serialization time, which convergence excludes;
- churn, disconnects, elections under load, or games other than this counter;
- rates above what the batch measured. The 1 and 5 actions/s figures are projections from measured bytes per action;
- more than 20 actions per size, or any run longer than about one second of batch time.

**Proposal for owner (not implemented; no cap):** each option below targets a measured cost, and the owner should choose among them:

1. **Stop shipping the full processed-action history on every commit.** Send it only to late joiners and during migration, or send incremental ids. This removes 76–93% of snapshot bytes. Re-verify the dedupe guarantees of [ADR-0007](../architecture/adr-0007-authority-election-and-migration.md) first.
2. **Send state deltas instead of the full state body per commit.** This matters after item 1, because the state body is only about 15% of a snapshot today. It would also shrink the per-player views.
3. **Target `action.dispatch` at the current authority.** That cuts a non-authority's upload from (N − 1) × 658 B to one copy per action. Check the migration re-send path first, since it may depend on the broadcast.
4. **Fan out through `scale()` routing.** This relieves the authority's per-player uplink but adds hops and latency, and the upstream feature is experimental. It needs a multi-hop test before adoption. Trystero promotes messages over 16 KiB to direct links ([PLAN §3.6](../../PLAN.md)). At 200 players a snapshot is about 15.1 KiB per copy, just under that threshold, so the state size at which this matters must be checked.
5. **Then re-measure:** run `npm run sim:large-room` after any change, and add a real-phone authority run at 25+ players.

## Open failures and gates

- With the game supplied when the host creates the room (omit `LOAD_SELECT_AFTER_JOIN`), two 10-player runs reached ten connected roster entries everywhere and every local frame registered ready, but the host's `canStart` remained false after 60 s and 15 s respectively, with some peers marked `waiting` for source. Peer notices showed other joiners serving game source. Inspection suggested source acceptance reached only the serving peer. A source-acknowledgment fix has since landed on `nova` (through `4ec4023`); the rebased 10-player browser check above passed. Do not regard the old select-after-join results as resolving it.
- In a separate 10-player run, dispatching `{type: "increment"}` without `payload` produced `invalid_message` notices and no increment; adding `payload: {}` allowed the run to proceed. The API documents payload as optional; the schema fix has since landed on `nova`, with separate protocol and session regression tests. The older 10/25/50 measured workload explicitly supplied a payload; the rebased 10-player run above exercised the fixed no-payload case.
- Real-phone authority CPU at 25+ players, multi-machine/CI room scaling, churn, and longer or higher-rate workloads remain unverified. A complete 100-player real-browser run is not planned (owner decision 2026-11-13); the in-process simulation above measures 100- and 200-player authority traffic instead, without phone or WebRTC evidence. The owner's decision on the upstream overlay descriptor bound remains open (PLAN §3.6). Never close §3.6–3.7 based on these measurements alone.
