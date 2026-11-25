/**
 * Canonical API usage examples.
 *
 * These strings are the JavaScript examples shown in the AI-oriented API
 * reference (`apps/nova/src/lib/prompt/nova-api-reference.md`). They are exported so tests can verify them against
 * the real API: every example is executed against a session-backed `nova`
 * client in `examples.test.ts`, and the minimal game is asserted to stay
 * under the ~30-line acceptance threshold.
 *
 * The examples are ordinary game code that would run inside the runtime
 * frame: plain `nova` calls, no imports, no DOM (so the same source runs in
 * the test arena).
 */

/** The minimal complete game, used for the <30-line criterion. */
export const MINIMAL_GAME_EXAMPLE = `// The smallest complete Nova game.
nova.defineGame({ title: "Hello Nova" });

// React to the game starting.
nova.onStart(function () {
  nova.log("Game started!");
});

// Announce that the game finished loading.
nova.ready();
`;

/** A lobby-style game: players, start, and an action. */
export const STATE_EXAMPLE = `// State example: a shared deck; every player draws their own card.
// Nova owns state, action ordering, and per-player views — the game only
// describes the rules (no networking code).
nova.defineGame({
  title: "Draw One",
  version: "1.0.0",
  createInitialState: function (context) {
    return { deck: ["ace", "king", "queen", "jack"], hands: {} };
  },
  actions: {
    drawCard: function (draft, context) {
      if (draft.hands[context.actor.id]) return; // already drew
      draft.hands[context.actor.id] = draft.deck.pop();
    }
  },
  selectView: function (state, viewer) {
    return { hand: state.hands[viewer.id], cardsLeft: state.deck.length };
  }
});

nova.onPlayerJoin(function (player) {
  nova.log(player.name + " joined (" + nova.players.length + " players)");
});

nova.onPlayerLeave(function (player) {
  nova.log(player.name + " left");
});

nova.onStart(function () {
  nova.log("Game started with " + nova.players.length + " players.");
});

// React to your own view: draw a card while you have no hand yet.
nova.state.onChange(function (state) {
  nova.log("State changed:", state);
  if (!state.hand) {
    // If two players raced on the same revision, Nova rejects the stale
    // one — the next view retries automatically. No networking code.
    nova.dispatch({ type: "drawCard" }).catch(function (error) {
      nova.log("Draw rejected:", error.code);
    });
  }
});

nova.ready();
`;

/** A ticking game: the authority steps it; players send controls. */
export const TICK_EXAMPLE = `// Ticking example: every player slides a paddle. Nova runs tick on one
// player's device 15 times a second and sends the state to everyone.
nova.defineGame({
  title: "Paddles",
  createInitialState: function () {
    return { paddles: {} };
  },
  tick: function (draft, context) {
    context.players.forEach(function (player) {
      var paddle = draft.paddles[player.id] || (draft.paddles[player.id] = { x: 50 });
      var controls = context.controls[player.id] || {};
      paddle.x += (controls.dx || 0) * 30 * context.dt;
    });
  },
});

nova.state.onChange(function (state) {
  nova.log("paddles", state.paddles);
});

nova.onStart(function () {
  nova.controls.set({ dx: 1 }); // hold right
});

nova.ready();
`;
