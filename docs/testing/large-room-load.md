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

## Open failures and gates

- With the game supplied when the host creates the room (omit `LOAD_SELECT_AFTER_JOIN`), two 10-player runs reached ten connected roster entries everywhere and every local frame registered ready, but the host's `canStart` remained false after 60 s and 15 s respectively, with some peers marked `waiting` for source. Peer notices showed other joiners serving game source. Inspection suggested source acceptance reached only the serving peer. A source-acknowledgment fix has since landed on `nova` (through `4ec4023`); the rebased 10-player browser check above passed. Do not regard the old select-after-join results as resolving it.
- In a separate 10-player run, dispatching `{type: "increment"}` without `payload` produced `invalid_message` notices and no increment; adding `payload: {}` allowed the run to proceed. The API documents payload as optional; the schema fix has since landed on `nova`, with separate protocol and session regression tests. The older 10/25/50 measured workload explicitly supplied a payload; the rebased 10-player run above exercised the fixed no-payload case.
- Real-phone authority CPU at 25+ players, multi-machine/CI room scaling, churn, longer and higher-rate workloads, and a complete 100-player run remain unverified. The owner's decision on the upstream overlay descriptor bound remains open (PLAN §3.6). Never close §3.6–3.7 based on these measurements alone.
