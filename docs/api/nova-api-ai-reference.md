# Nova API — AI Quick Reference

The compact reference for AI-built Nova games; the master prompt embeds this
file verbatim. `window.nova` already exists when your game's code runs, and it
behaves the same in the editor's test arena and in real parties. The full
human reference is `docs/api/nova-api.md`.

## The whole API

```js
// --- Registration: first, exactly once ---
nova.defineGame({
  title: "My Game", // <= 64 chars
  mode: "state", // "state" (default) | "simulation" | "raw"
  apiVersion: 1, // always include: keeps this game working after API changes
  // State mode only:
  createInitialState(context) {
    return {}; // the canonical state
  },
  actions: {
    playCard(draft, context, payload) {
      // Validate, then mutate the draft (or return a new state).
      // context.actor is the player who dispatched.
    },
  },
  selectView(state, viewer) {
    return state; // what this one player may see
  },
});

// --- Lifecycle ---
nova.ready(); // once, when your game has loaded
nova.onStart(() => {}); // the party started the game; sending works from here
nova.onEnd((reason) => {}); // "user_exit" | "host_closed" | "error"
nova.onConnectionChange((status) => {});
// "connecting" | "connected" | "reconnecting" | "suspended" | "disconnected"

// --- Players ---
nova.player; // { id, name } for this player, or null
nova.players; // everyone, this player first, then join order
nova.onPlayerJoin((player) => {});
nova.onPlayerLeave((player) => {});

// --- State mode ---
nova.state.get(); // your view, or null before start
nova.state.onChange((view) => render(view));
nova.dispatch({ type: "playCard", payload: { card: "ace" } }); // Promise
// Resolves once applied; rejects with { code, message }.

// --- Simulation mode ---
nova.simulation.register({
  onInput(input) {}, // { type, payload?, tick?, sender: { id, name } }, yours included
  onTick(tick) {}, // advance your local simulation one fixed step
  onSnapshot(snapshot) {}, // { tick, state }: replace your local state with snapshot.state
  serializeState() {
    return {}; // your simulation state as plain data (Nova shares it)
  },
});
nova.simulation.sendInput({ type: "move", payload: { dx: 1 } });
nova.simulation.getTick(); // local tick, for interpolation

// --- Raw mode ---
nova.raw.createChannel({ name: "chat" }); // after start; reliable and ordered
nova.raw.send("chat", { text: "hi" }); // to everyone
nova.raw.send("chat", "hi", { to: playerId }); // to one player
nova.raw.send("chat", bytes, { onProgress: (p) => {} }); // big payloads report progress
nova.raw.onMessage("chat", (message) => {}); // { from, payload, binary }
nova.raw.close("chat");

// --- Logging and errors ---
nova.log("anything", value); // shows in the editor's log panel
nova.onError((error) => {}); // { code, message }
```

## Rules

1. **`nova.defineGame` first, exactly once; `nova.ready()` once after
   loading.** The game starts when the party starts it; `onStart` tells you.
2. **Send only after `onStart`.** `dispatch`, `raw.createChannel`,
   `raw.send`, `raw.close` and `simulation.sendInput` throw `not_started`
   before it and `ended` after `onEnd`.
3. **Plain JSON data only** in state, payloads and views: no functions,
   class instances, cycles, `BigInt` or DOM objects. Binary
   (`Uint8Array`/`ArrayBuffer`) works on raw channels only.
4. **Never invent methods**, and never write networking, rooms, hosts or
   peers. Nova picks the authority, orders messages and migrates if a player
   leaves; your game never knows who the authority is.
5. **Treat views as read-only.** Change state only by dispatching actions.
6. **Every `on…` call returns an unsubscribe function.**
7. **Limits.** Each player shares 256 KiB/s (1 MiB burst) across actions,
   simulation inputs and raw sends; one action payload is at most 16 KiB,
   one raw payload at most 1 MiB, canonical state at most 512 KiB, and at
   most 120 raw messages per second. Going over rejects the send with
   `rate_limited` or `payload_too_large` (raw and simulation errors arrive
   through `nova.onError`).
8. **Render immediately; never wait for the party.** In the editor preview
   there is no party: `nova.connectionStatus` stays `"disconnected"` and
   `onStart`, `onPlayerJoin` and `onConnectionChange` never fire. Show a
   working screen at once (menu, board, or "waiting for players"). A
   connection indicator is a small chip over a working screen, never a
   blank screen with a spinner. Start real-time play only after `onStart`.

## Choosing a mode

- **state** (default; prefer it): turn-based, card, board, trivia, drawing,
  voting, word and social games. Nova keeps the canonical state, runs your
  actions in order exactly once, gives each player only their `selectView`,
  and catches up late joiners.
- **simulation**: continuous real-time games (arcade, movement, shared
  physics). Every player runs the simulation locally from ordered inputs;
  regular snapshots from the authority correct drift and restore after
  migration. No rollback netcode.
- **raw**: custom protocols over named channels. Nova only delivers
  messages: no shared state, no migration, no cheating resistance.

## State mode example

```js
nova.defineGame({
  title: "Draw One",
  mode: "state",
  apiVersion: 1,
  createInitialState(context) {
    // context: { self, players, revision, now }
    return { deck: ["ace", "king", "queen"], hands: {} };
  },
  actions: {
    drawCard(draft, context) {
      if (draft.hands[context.actor.id] || draft.deck.length === 0) return;
      draft.hands[context.actor.id] = draft.deck.pop();
    },
  },
  selectView(state, viewer) {
    // Each player receives only this, never the full state.
    return { hand: state.hands[viewer.id] ?? null, cardsLeft: state.deck.length };
  },
});

nova.state.onChange((view) => render(view));
nova.onStart(() => render(nova.state.get()));
nova.ready();

function render(view) {
  // Draw the screen from `view`; a "Draw" button calls draw().
}

function draw() {
  nova.dispatch({ type: "drawCard" }).catch((error) => {
    // stale_revision: someone acted first; the next onChange has the new view.
    // Other codes: timed_out, unknown_action, payload_too_large,
    // state_too_large, game_ended, no_authority.
    nova.log("draw rejected", error.code);
  });
}
```

What Nova guarantees in state mode:

- Actions apply one at a time, in order, exactly once. An action based on an
  old view is rejected with `stale_revision` and changes nothing; act again
  from the newest `onChange` view.
- A rejected or failed action never corrupts state.
- A player who joins late gets the current state and their view.

## Smallest game

```js
nova.defineGame({ title: "Hello Nova", mode: "state", apiVersion: 1 });
nova.onStart(() => nova.log("Game started!"));
nova.ready();
```
