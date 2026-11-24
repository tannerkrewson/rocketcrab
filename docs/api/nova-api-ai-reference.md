# Nova API — AI Quick Reference

The compact reference for AI-built Nova games; the master prompt embeds this
file verbatim. `window.nova` already exists when your game's code runs, and it
behaves the same in the editor's test arena and in real parties.

## How a Nova game works

Nova keeps one copy of the game's state. Your handlers (`createInitialState`,
`actions`, `tick`) run on one player's device, which Nova picks and replaces
if that player leaves. Every player receives each new state through
`nova.state.onChange` and draws it. Players change the state in two ways:

- **Actions** (`nova.dispatch`) for things that happen once: play a card,
  answer, vote, jump, shoot, buy. Nova applies each one exactly once, in order.
- **Controls** (`nova.controls.set`) for what a player is doing right now:
  buttons held, a joystick direction, where a finger is. Only a game with a
  `tick` reads them.

A game with a `tick` handler is a real-time game: Nova calls `tick`
`tickRate` times a second (default 15) to move things along. Without one,
the state only changes when someone acts.

## The whole API

```js
// --- Registration: first, exactly once ---
nova.defineGame({
  title: "My Game", // <= 64 chars
  apiVersion: 1, // always include: keeps this game working after API changes
  createInitialState(context) {
    return {}; // the starting state (plain JSON)
  },
  actions: {
    playCard(state, context, payload) {
      // Validate, then change `state` in place. context.actor = who acted.
      // Throw an Error to reject the action; nothing changes.
    },
  },
  // Real-time games only:
  tickRate: 15, // ticks per second, 1..60
  tick(state, context) {
    // Move things by one step. context.dt = seconds per tick;
    // context.controls[playerId] = that player's latest controls (or undefined).
  },
  // Only when players must not see everything (hidden hands, secret roles):
  selectView(state, viewer) {
    return state; // what this one player may see
  },
});

// --- Lifecycle ---
nova.ready(); // once, when your game has loaded
nova.onStart(() => {}); // the party started the game
nova.onEnd((reason) => {}); // "user_exit" | "host_closed" | "error"
nova.onConnectionChange((status) => {});
// "connecting" | "connected" | "reconnecting" | "suspended" | "disconnected"

// --- Players ---
nova.player; // { id, name } for this player, or null
nova.players; // everyone, this player first, then join order
nova.onPlayerJoin((player) => {});
nova.onPlayerLeave((player) => {});

// --- State ---
nova.state.get(); // the latest state (or your view), or null before start
nova.state.onChange((state) => {}); // a new state arrived
nova.dispatch({ type: "playCard", payload: { card: "ace" } }); // Promise
// Resolves once applied; rejects with { code, message }.
nova.controls.set({ left: true, right: false }); // any time; only changes are sent

// --- Logging and errors ---
nova.log("anything", value); // shows in the editor's log panel
nova.onError((error) => {}); // { code, message }
```

## Rules

1. **`nova.defineGame` first, exactly once; `nova.ready()` once after
   loading.** The game starts when the party starts it; `onStart` tells you.
2. **Dispatch only after `onStart`.** `dispatch` throws
   `not_started` before it and `ended` after `onEnd`. `controls.set` works
   any time.
3. **Plain JSON in state, payloads and controls**: objects, arrays, strings,
   booleans and finite numbers. No functions, class instances, `Map`, `Set`,
   `Date`, `NaN`, `Infinity` or DOM objects. `NaN` arrives as `null`.
4. **Never invent methods**, and never write networking, rooms, hosts or
   peers. Your game never knows which device runs the handlers.
5. **Handlers only change `state`.** Never touch the DOM, globals, timers or
   `nova` from `createInitialState`, `actions`, `tick` or `selectView`; they
   run on one device only. `Math.random()` is fine there: it runs once and
   everyone receives the result.
6. **Treat received state as read-only.** Change it only through actions,
   controls and the tick.
7. **Every `on…` call returns an unsubscribe function.**
8. **Limits.** State at most 512 KiB, one action payload at most 16 KiB,
   controls at most 1 KiB. Each player's actions share 256 KiB/s. Going over
   rejects the call with `payload_too_large`, `state_too_large` or
   `rate_limited`.
9. **Render immediately; never wait for the party.** In the editor preview
   there is no party: `nova.connectionStatus` stays `"disconnected"` and
   `onStart`, `onPlayerJoin` and `onConnectionChange` never fire. Show a
   working screen at once (menu, board, or "waiting for players"). A
   connection indicator is a small chip over a working screen, never a
   blank screen with a spinner.

## Turn-based example

```js
nova.defineGame({
  title: "Draw One",
  apiVersion: 1,
  createInitialState(context) {
    return { deck: ["ace", "king", "queen"], hands: {} };
  },
  actions: {
    drawCard(state, context) {
      if (state.hands[context.actor.id]) throw new Error("You already drew.");
      if (state.deck.length === 0) throw new Error("The deck is empty.");
      state.hands[context.actor.id] = state.deck.pop();
    },
  },
  selectView(state, viewer) {
    // Each player sees only their own card.
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
    // error.message is the Error your action threw, or a Nova reason such as
    // stale_revision (someone acted first) or timed_out.
    showMessage(error.message);
  });
}
```

Nova guarantees: actions apply one at a time, in order, exactly once; a
rejected action changes nothing; a player who joins late gets the current
state.

## Real-time example

```js
nova.defineGame({
  title: "Bumper Dots",
  apiVersion: 1,
  tickRate: 15,
  createInitialState() {
    return { dots: {}, timeLeft: 60 };
  },
  tick(state, context) {
    state.timeLeft = Math.max(0, state.timeLeft - context.dt); // timers live in state
    const here = new Set(context.players.map((player) => player.id));
    for (const id in state.dots) if (!here.has(id)) delete state.dots[id]; // left
    for (const player of context.players) {
      const dot = (state.dots[player.id] ??= { x: 50, y: 50, score: 0 });
      const c = context.controls[player.id] ?? { dx: 0, dy: 0 };
      dot.x = round(clamp(dot.x + c.dx * 40 * context.dt, 0, 100));
      dot.y = round(clamp(dot.y + c.dy * 40 * context.dt, 0, 100));
    }
  },
  actions: {
    boost(state, context) {
      state.dots[context.actor.id].score += 1; // one-off events are actions
    },
  },
});

// Smooth drawing: glide from the previous state to the latest one.
let previous = null;
let latest = null;
let arrivedAt = 0;
nova.state.onChange((state) => {
  previous = latest ?? state;
  latest = state;
  arrivedAt = performance.now();
});
requestAnimationFrame(function frame() {
  if (latest) {
    const t = Math.min(1, (performance.now() - arrivedAt) / (1000 / 15));
    draw(previous, latest, t); // position = a + (b - a) * t
  }
  requestAnimationFrame(frame);
});

// Controls: report what is held. Calling set often is fine.
const held = { dx: 0, dy: 0 };
function steer(dx, dy) {
  held.dx = dx;
  held.dy = dy;
  nova.controls.set(held);
}
addEventListener("keydown", (e) => e.key === "ArrowLeft" && steer(-1, held.dy));
addEventListener("keyup", (e) => e.key === "ArrowLeft" && steer(0, held.dy));
addEventListener("blur", () => steer(0, 0)); // a hidden tab never sees keyup
boostButton.onclick = () => nova.dispatch({ type: "boost" }).catch(() => {});

function round(n) {
  return Math.round(n * 10) / 10; // short numbers keep updates small
}
function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}
nova.ready();
```

What a real-time game must do:

- **Keep everything in the state**: positions, velocities, scores, timers
  (count down with `context.dt`), the current round. Nothing that matters may
  live only in a local variable.
- **Read players from `context.players` in `tick`**: add an entity for a new
  player and delete the entities of players who left.
- **Use controls for held input and actions for one-off events.** Put the
  current direction or buttons in controls; a jump, shot or purchase is an
  action.
- **Draw every animation frame**, gliding between the last two states as
  above. New states arrive `tickRate` times a second plus network delay
  (often 50–200 ms), so never move things only when a state arrives.
- **Keep the state small**: it goes to every player every tick. Round
  positions, and leave out anything you can recompute while drawing.
- **For twitchy games** (racing, aiming), move this player's own character on
  screen at once, put its position in controls, and have `tick` copy that
  position into the state. Everything else follows the state.

## Phones and browsers

- **Sound starts after a tap.** Create or resume the `AudioContext` inside a
  tap or click handler, never on load, and show a "tap for sound" hint. The
  iPhone silent switch still mutes it.
- **Touch first.** No hover-only or keyboard-only controls; buttons at least
  44 px. Fullscreen, pointer lock and tilt (device orientation) do not work.
- **The page can freeze.** A backgrounded phone stops timers and animation
  frames, and Nova moves the game to another device. When the page comes
  back it gets the current state through `onChange`; draw from that, never
  from time measured locally while away.
- **Camera and microphone** (`getUserMedia`) work after `onStart`, from a
  tap, with the usual browser prompt.

## Smallest game

```js
nova.defineGame({ title: "Hello Nova", apiVersion: 1 });
nova.onStart(() => nova.log("Game started!"));
nova.ready();
```
