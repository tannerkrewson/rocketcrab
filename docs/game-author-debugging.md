# Game author and debugging guide

This guide is for someone **playing and debugging Nova games**, not for
changing Nova itself. The API is described in
`docs/api/nova-api-ai-reference.md`, which the master prompt embeds.

## The authoring loop

1. Open **Build** (`/build`) and copy the master prompt, or use
   **More → Copy AI prompt + my game** in the editor to keep iteration context.
2. In the editor, press **Paste game**. Nova validates the document, starts it
   in the isolated runtime origin (the game calls `nova.defineGame(...)`), and
   runs it as several simulated players on the **Test** tab.
3. To edit by hand, use the **Code** tab and press **Run**.
4. **Save** keeps the game in My games; **Play with friends** saves it and opens
   a real party. Leaving with unsaved changes asks to save or discard them.

Saved games live in this browser's IndexedDB only. When the last run had
problems, a **problems bar** appears above the tabs: it counts validation
issues, runtime errors (category, message and detail) and console
errors/warnings, and expands to list them. **Copy for AI** copies a full report
(validation, runtime errors, console tail, source size and SHA-256) to paste
into an AI chat or a bug report. The arena's **Advanced** toggle adds network
simulation, per-player connection controls and per-player logs.

All players must run byte-identical HTML; the party transfers the source
peer-to-peer and verifies the hash, so an edited file is a different game
version even when the game ID is unchanged.

## Common failures and what they mean

- **"Game did not call nova.defineGame within 10000ms."** (`missing_registration`)
  — the document loaded but never called `nova.defineGame` (or the script failed
  before it). Check the console and that the document has no syntax error.
- **Validation: incomplete HTML document** — Nova expects one complete document
  (`<!doctype html>` through `</html>`), not a fragment or multiple files.
- **`unknown_action`** — a dispatch named an action that is not in `actions`
  (`No action handler named "…" was registered.`).
- **`invalid_state`** — the state is not plain JSON. A cycle or a `BigInt`
  rejects the change. `NaN`/`Infinity` (often a division by zero) become `null`
  and a `Map` or `Set` becomes `{}`; the change still applies, and the message
  names the key. A failing `tick` is reported once, not every tick.
- **"Couldn't reach anyone in this party. It may have ended, or your networks may
  need a TURN relay."** — the joiner was admitted, but no peer data channel opened
  within 15 seconds. Same-Wi-Fi play often succeeds without TURN; different
  networks usually need TURN or the encrypted tunnel fallback (see below). This is
  infrastructure, not a game bug.
- **"Connecting to a player…" / "Couldn't connect to a player."** — a notice that
  names no player. "Connecting" shows while a direct path is set up and expires
  after 30 seconds. "Couldn't connect" offers **Retry** in the lobby. During play
  there is no button: the transport retries the pair on re-announce, and a
  reconnect would tear down the running game.
- **"Couldn't start the game. Try again."** — the host re-sends its start request
  every 2 seconds for up to 30 seconds. If the authority still has not started the
  game, the host returns to the lobby with this notice.
- **"the host removed you"** — the host used **Remove player**; the affected
  client leaves cooperatively.
- **Game ended / authority migrated notices** — expected events. Nova migrates
  authority when the current authority is backgrounded or disconnects; games
  should not depend on the creator remaining authoritative.
- **In-party "Logs"** — open **Menu → Logs** in the play shell to see your own
  game's console output (Nova-mode games only; Classic games run in their own
  frame). **Connection diagnostics** is in the party lobby, not the play shell.

## Connection diagnostics (parties)

The lobby's **Connection diagnostics** panel separates things that are easy to
confuse:

- **Connection** is this player's party state: `Connected`, `Connecting`,
  `Suspended`, `Disconnected`, or `Idle`.
- **Signaling** is `connected`, `disconnected`, or `unknown`. Signaling runs
  through Nova's edge Worker, not public relays. When it is disconnected, the
  panel says that no relay socket is open.
- **turn** is `configured`, `unavailable`, or `disabled` for this build and join.
  `unavailable` means the TURN credential mint failed, and the party went on
  without TURN.
- **Peers** lists each connected peer. A peer tagged **relayed** is connected
  through Nova's encrypted tunnel fallback rather than a direct connection.
- **Peer latency** shows the last sample per peer, refreshed by **Refresh**.

The edge Worker is not deployed yet (see `deploy/cloudflare.md`), so signaling,
TURN, and the tunnel fallback are not yet live for players.

## Debugging a real party

1. Confirm both players see the lobby with the other player listed. If
   **Signaling** is disconnected, nobody can discover anyone.
2. If the joiner never appears, or a player shows **Couldn't connect to a
   player.**, suspect the network path (direct, TURN, or the tunnel) rather than
   the game.
3. Use the arena first: it uses the same session and API semantics with an
   in-memory transport, so game logic bugs reproduce there without network
   variables.
4. For mobile-only symptoms, test with mobile emulation **and** a physical
   phone; see `docs/testing/mobile-safari-checklist.md`. WebKit automation is
   not a substitute for Mobile Safari.
5. A game that never yields CPU can wedge the tab (browser isolation is per
   site; see `docs/architecture/deployment.md`). Reload is the recovery; keep
   loops bounded.

## What Nova does not promise

Nova does not provide anti-cheat, server-authoritative simulation, guaranteed
direct connections on every network, or per-game isolation on the shared runtime
origin. A connection that cannot go direct may fall back to an encrypted relay
through Cloudflare's edge Worker, which still sees connection metadata. See `docs/architecture/threat-model.md`
and ADR-0008/ADR-0010 for the exact limits — do not describe stronger guarantees
to players than these documents support.
