# Game author and debugging guide

This guide is for someone **playing and debugging Nova games**, not for
changing Nova itself. The complete API contract is in `docs/api/nova-api.md`;
the condensed version embedded in the master prompt is
`docs/api/nova-api-ai-reference.md`. Read those for `nova.state`,
`nova.simulation`, and `nova.raw` semantics.

## The authoring loop

1. Open **Create** (`/build`) and copy the master prompt — or use
   **Copy prompt → Master prompt + my game** in the editor to keep iteration
   context.
2. Paste the AI's single HTML document into the editor.
3. Press **Run**. Nova validates the document, starts it in the isolated runtime
   origin, and the game calls `nova.defineGame(...)`.
4. Add simulated players in the test arena, then use **Save** to keep the game
   or **Play with friends** to open a real party.

Saved games live in this browser's IndexedDB only. The editor's **Diagnostics**
panel is the primary debugging surface:

| Section            | What it answers                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| **Validation**     | Is this a complete HTML document? Are there blocking source issues?                                  |
| **Runtime errors** | What failed in the last run (category + message + detail), if anything.                              |
| **Console**        | The game's own console output (bounded tail, rate-limited with drop counts).                         |
| **Copy report**    | Copies validation, runtime errors, console tail, size, and source hash for an AI chat or bug report. |

The source byte count and SHA-256 are shown beside the panel. All players must
run byte-identical HTML; the party transfers the source peer-to-peer and
verifies the hash, so an edited file is a different game version even when the
game ID is unchanged.

## Common failures and what they mean

- **"registration timeout" / missing `nova.defineGame`** — the document loaded
  but never called `nova.defineGame` (or the script failed before it). Check the
  console and that the document has no syntax error.
- **Validation: incomplete HTML document** — Nova expects one complete document
  (`<!doctype html>` through `</html>`), not a fragment or multiple files.
- **`stateRequest`/`simulationRequest` timeouts** — the game registered a mode
  but did not provide the handlers that mode needs (for example simulation
  without `nova.simulation.register`). Check that the declared mode matches the
  API surface you used.
- **"A player couldn't be reached directly over the network (no TURN relay available)"**
  — signaling worked but the WebRTC data channel did not. Same-Wi-Fi play often
  succeeds without TURN; different networks require it. This is infrastructure,
  not a game bug. Deployments without a TURN credential endpoint show this
  notice instead of pretending a player is present.
- **"the host removed you"** — the host used **Remove player**; the affected
  client leaves cooperatively.
- **Game ended / authority migrated notices** — expected events. Nova migrates
  authority when the current authority is backgrounded or disconnects; games
  should not depend on the creator remaining authoritative.
- **In-party "Logs"** — open **Menu → Logs** in the play shell to see your own
  game's console output. **Menu → Connection** (diagnostics) shows relay
  usability and TURN state.

## Connection diagnostics (parties)

The connection panel separates things that are easy to confuse:

- **Connected** means a relay socket is open.
- **Usable** means it is open _and_ has not recently rejected or throttled party
  traffic. A relay can be connected but rejecting.
- **Turn** is `configured`, `unavailable`, or `disabled` for this build/join.

If usable relays fall below the configured redundancy, the lobby warns instead
of silently degrading. Public relay policy can change without notice; a party
that worked yesterday may need a different relay set or a private relay.

## Debugging a real party

1. Confirm both players can reach discovery at all (the lobby code appears and
   the join reaches approval).
2. If discovery works but the joiner never appears, suspect the relayed data
   path (TURN) rather than the game.
3. Use the arena first: it uses the same session and API semantics with an
   in-memory transport, so game logic bugs reproduce there without network
   variables.
4. For mobile-only symptoms, test with mobile emulation **and** a physical
   phone; see `docs/testing/mobile-safari-checklist.md`. WebKit automation is
   not a substitute for Mobile Safari.
5. A game that never yields CPU can wedge the tab (runtime isolation is per
   origin). Reload is the recovery; keep loops bounded.

## What Nova does not promise

Nova does not provide anti-cheat, server-authoritative simulation, guaranteed
direct connections on every network, or per-game isolation on the shared runtime
origin. Media support is experimental. See `docs/architecture/threat-model.md`
and ADR-0008/ADR-0010 for the exact limits — do not describe stronger guarantees
to players than these documents support.
