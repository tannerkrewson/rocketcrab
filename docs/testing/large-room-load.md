# Large-room measurements (2026-11-13/14)

Owned by [ADR-0003](../architecture/adr-0003-trystero-transport-abstraction.md).
These were one-off experiments; the harness (`e2e-load/`), the in-process
simulation and their raw JSON were removed on 2026-11-15 once the fan-out work
they guided had landed. Git history has them if a rerun is ever needed.

## Real browsers, one machine (headless Chromium, local WebRTC, no TURN)

| Players | Everyone sees everyone | Game ready | Action reaches all |
| ------: | ---------------------: | ---------: | -----------------: |
|      10 |                 11.3 s |     12.3 s |           47–64 ms |
|      25 |                 27.4 s |     28.5 s |           52–64 ms |
|      50 |                 59.2 s |     62.9 s |          79–232 ms |

Players joined one after another, so join time grows linearly. A 100-browser
run stopped at 78 joins when the host ran low on memory; real-browser runs stay
at 50 or fewer (owner decision).

## Authority upload (in-process simulation, no WebRTC)

The elected authority sends each player its own view, so its upload grows
with party size. Incremental history, dispatch sent only to the authority, and
state deltas cut the authority's bytes per action by 87% at 10 players and 89%
at 200. Projected at 5 actions/s, before WebRTC framing:

| Players | Authority upload | A non-authority player's upload |
| ------: | ---------------: | ------------------------------: |
|      10 |       0.6 Mbit/s |                     0.03 Mbit/s |
|      25 |       1.7 Mbit/s |                     0.03 Mbit/s |
|      50 |       3.4 Mbit/s |                     0.03 Mbit/s |
|     100 |       6.8 Mbit/s |                     0.03 Mbit/s |
|     200 |      13.6 Mbit/s |                     0.03 Mbit/s |

These figures come from a sample game whose state changes two values per
action; a game that rewrites most of its state each action sends more.

## Not measured

Phone CPU as the authority at 25+ players, real cross-network rooms beyond 10,
churn, and long sessions.
