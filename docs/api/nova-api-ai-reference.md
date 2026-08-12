# Nova API — AI Quick Reference

The concise reference for building games against the Nova API. Intended to be
embedded in the master prompt; every game starts with `window.nova` already
available in the runtime frame. The API is identical in the local test arena
and in real parties.

## The whole API in one block

```js
// --- Registration (call first, exactly once) ---
nova.defineGame({
  title: "My Game", // optional, <= 64 chars
  mode: "state", // "state" (default) | "simulation" | "raw"
  version: "1.0.0", // optional game version, <= 32 chars
  apiVersion: 1, // optional; must match nova.version
});

// --- Lifecycle ---
nova.ready(); // the game finished loading; call once
nova.onStart(() => {
  /* play */
}); // game began; sending calls unlock here
nova.onEnd((reason) => {
  /* done */
}); // reason: "user_exit" | "host_closed"
//   | "authority_migrated" | "error"
nova.onConnectionChange((status) => {});
// status: "connecting" | "connected" | "reconnecting" | "suspended" | "disconnected"

// --- Players ---
nova.player; // { id, name } — this player (or null)
nova.players; // everyone, you first, join order
nova.onPlayerJoin((player) => {});
nova.onPlayerLeave((player) => {});

// --- Logging ---
nova.log("anything", ...args); // captured + rate-limited by the runtime

// --- State mode (default) ---
nova.state.get(); // current canonical state (or null)
nova.state.onChange((state) => {
  render(state);
});
nova.dispatch({ type: "playCard", payload: { card: "ace" } }); // Promise; after start

// --- Simulation mode ---
nova.simulation.register({
  onInput: (input) => {
    /* { type, payload?, tick?, sender: {id,name} } */
  },
  onSnapshot: (snapshot) => {},
});
nova.simulation.sendInput({ type: "move", payload: { dx: 1 } }); // after start

// --- Raw mode ---
nova.raw.createChannel({ name: "chat", reliable: true, ordered: true, binary: false });
nova.raw.send("chat", { text: "hi" }); // broadcast
nova.raw.send("chat", "hi", { to: "member-2" }); // targeted
nova.raw.onMessage("chat", (message) => {
  /* { from, payload, binary } */
});

// --- Errors ---
nova.onError((error) => {
  /* error: { code, message } */
});
```

## Rules that always hold

1. **Call `nova.defineGame` first, exactly once.** Everything else follows.
2. **Call `nova.ready()` once after loading.** The game starts when the host
   says so; you observe it with `onStart`.
3. **Sending calls only work after start.** `dispatch`, `raw.createChannel`,
   `raw.send`, and `simulation.sendInput` before `onStart` throw
   `not_started`; after `onEnd` they throw `ended`.
4. **Never call methods this version does not have.** They fail loudly.
5. **Every payload is plain JSON data.** No functions, no cycles, no BigInt,
   no DOM objects. Binary (`Uint8Array`/`ArrayBuffer`) only on raw channels.
6. **Subscriptions return an unsubscribe function** — call it to stop.
7. **No hosting, no rooms, no peers, no authority.** You never elect a host,
   never detect one, and never write networking code. Nova owns ordering,
   authority, and migration invisibly.
8. **Prefer state mode** unless the game genuinely needs another mode.

## The three modes

- **`state` (default)** — turn-based/board/card/trivia/party games. Nova owns
  the canonical state; your game dispatches plain actions and subscribes to
  state changes. No networking code required.
- **`simulation`** — faster continuous games. Register input handlers and
  send ordered inputs; Nova owns input ordering and (later) the simulation
  clock and snapshots.
- **`raw`** — specialized protocols. Named channels with
  reliable/unreliable, ordered/unordered, JSON or binary, broadcast or
  targeted. Nova provides transport only: no synchronization guarantees.

## Minimal game (9 lines)

```js
nova.defineGame({ title: "Hello Nova", mode: "state" });
nova.onStart(function () {
  nova.log("Game started!");
});
nova.ready();
```
