/**
 * Canonical API usage examples (S1 documentation deliverable).
 *
 * These strings are the JavaScript examples shown in `docs/api/` and the
 * AI-oriented reference. They are exported so tests can verify them against
 * the real API: every example is executed against a session-backed `nova`
 * client in `examples.test.ts`, and the minimal game is asserted to stay
 * under the ~30-line acceptance threshold.
 *
 * The examples are ordinary game code that would run inside the runtime
 * frame: plain `nova` calls, no imports, no DOM (so the same source runs in
 * the test arena).
 */

/** The minimal complete game (state mode), used for the <30-line criterion. */
export const MINIMAL_GAME_EXAMPLE = `// The smallest complete Nova game (state mode).
nova.defineGame({ title: "Hello Nova", mode: "state" });

// React to the game starting.
nova.onStart(function () {
  nova.log("Game started!");
});

// Announce that the game finished loading.
nova.ready();
`;

/** A lobby-style state-mode game: players, start, and an action. */
export const STATE_MODE_EXAMPLE = `// State-mode example: a shared deck; every player draws their own card.
// Nova owns state, action ordering, and per-player views — the game only
// describes the rules (no networking code).
nova.defineGame({
  title: "Draw One",
  mode: "state",
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

/** A simulation-mode game: register input handlers and send inputs. */
export const SIMULATION_MODE_EXAMPLE = `// Simulation-mode example: continuous player inputs.
nova.defineGame({ title: "Pong-ish", mode: "simulation" });

nova.simulation.register({
  onInput: function (input) {
    nova.log(input.sender.name + " moved: " + input.type);
  }
});

nova.onStart(function () {
  // Send inputs as the player acts (here: once at start).
  nova.simulation.sendInput({ type: "move", payload: { dx: 1, dy: 0 } });
});

nova.ready();
`;

/** A raw-mode example: a named channel with JSON and binary messages. */
export const RAW_MODE_EXAMPLE = `// Raw-mode example: a "chat" channel plus a binary "positions" channel.
nova.defineGame({ title: "Chatter", mode: "raw" });

nova.onStart(function () {
  nova.raw.createChannel({ name: "chat", reliable: true, ordered: true });
  nova.raw.createChannel({ name: "positions", binary: true });

  nova.raw.send("chat", { text: "hello everyone" });
  nova.raw.send("positions", new Uint8Array([1, 2, 3]));
});

nova.raw.onMessage("chat", function (message) {
  nova.log(message.from.name + " says: " + message.payload.text);
});

nova.ready();
`;
