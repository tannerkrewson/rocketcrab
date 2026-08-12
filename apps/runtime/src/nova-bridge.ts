/**
 * Nova API bootstrap injection (deliverable: the tiny `window.nova` bridge
 * prepended to every game document).
 *
 * The injected script runs inside the game frame BEFORE any game code:
 *
 * - captures window `error` and `unhandledrejection` events (including
 *   resource load failures) and forwards them to the runtime page;
 * - wraps `console.*` so game output is observable by the host (rate-limited
 *   on the runtime page — see `rate-limiter.ts`);
 * - defines `window.nova` with the full game-facing API surface (S1): the
 *   same object shape `createNovaClient` builds in `@rocketcrab/nova-api`.
 *   Registration (`nova.defineGame`) and the forwarded calls (`ready`,
 *   `dispatch`, `raw.*`, `simulation.*`) report to the runtime page, which
 *   schema-validates them before anything reaches the host (never trust game
 *   metadata; threat model T10). The lifecycle is enforced in the frame too,
 *   so calls fail with a clear `NovaError` before readiness (S1 acceptance).
 *
 * S1 note: the runtime page validates forwarded calls and — since the host
 * session router landed (U6 arena, P1 party) — forwards them to the host as
 * `game.apiCall` messages, which the host routes into the player's
 * NovaSession over the transport. Host-pushed session events arrive as
 * `game.apiEvent` and are dispatched to the matching handlers by
 * `__novaGameBridge.receive`. The in-frame lifecycle guarantees that
 * everything reachable behaves exactly like the arena client.
 *
 * The game frame is same-origin with the runtime page (ADR-0008/B5), so the
 * bridge reports through a per-instance hook on the runtime page rather than
 * a second postMessage channel — no extra message listeners, nothing to leak
 * across restarts. The bridge never touches the host origin, never touches
 * Trystero, and contains no Nova secrets.
 */
import { PROTOCOL_VERSION, gameModeSchema, titleSchema, type GameMode } from "@rocketcrab/protocol";
import { NOVA_API_VERSION } from "@rocketcrab/nova-api/version";
import { z } from "zod";

/**
 * Nova API versions this build can execute. The game-facing API version
 * (NOVA_API_VERSION, @rocketcrab/nova-api) is independent of the protocol
 * version (S1 policy). Games declare the API version they target via
 * `nova.defineGame({ apiVersion })`; an unsupported version fails
 * registration with a clear `unsupported` runtime error.
 */
export const SUPPORTED_NOVA_API_VERSIONS: readonly number[] = [NOVA_API_VERSION];

/** What the runtime accepts from `nova.defineGame` (protocol keys). */
export const gameDeclarationSchema = z.object({
  title: titleSchema.optional(),
  gameMode: gameModeSchema.optional(),
  gameVersion: z.string().min(1).max(32).optional(),
  apiVersion: z.number().int().min(1).optional(),
});
export type GameDeclaration = z.infer<typeof gameDeclarationSchema>;

/**
 * Bounded payloads the runtime accepts from forwarded Nova API calls (S1).
 * Each schema mirrors the `@rocketcrab/nova-api` validation schemas so the
 * runtime boundary never trusts game-supplied call arguments.
 */
export const novaApiCallSchemas = {
  ready: z.object({}).strict(),
  dispatch: z
    .object({
      action: z.object({
        type: z.string().min(1).max(64),
        payload: z.unknown().optional(),
        baseRevision: z.number().int().nonnegative().optional(),
      }),
    })
    .strict(),
  "raw.createChannel": z
    .object({
      spec: z.object({
        name: z.string().min(1).max(64),
        reliable: z.boolean().optional(),
        ordered: z.boolean().optional(),
        binary: z.boolean().optional(),
      }),
    })
    .strict(),
  "raw.send": z
    .object({
      name: z.string().min(1).max(64),
      payload: z.unknown(),
      options: z
        .object({
          to: z.string().min(1).max(64).optional(),
          reliable: z.boolean().optional(),
          ordered: z.boolean().optional(),
        })
        .optional(),
    })
    .strict(),
  "simulation.register": z.object({}).strict(),
  "simulation.sendInput": z
    .object({
      input: z.object({
        type: z.string().min(1).max(64),
        payload: z.unknown().optional(),
        tick: z.number().int().nonnegative().optional(),
      }),
    })
    .strict(),
} as const;

export type NovaApiCallMethod = keyof typeof novaApiCallSchemas;

/** Every forwarded Nova API call kind the runtime accepts. */
export const NOVA_API_CALL_METHODS: readonly string[] = Object.keys(novaApiCallSchemas);

/**
 * JavaScript source injected ahead of the game document (F4 spike shape).
 * Kept dependency-free and Trystero-free: it must run in an untrusted frame
 * with no module loading. The surface mirrors `createNovaClient` from
 * `@rocketcrab/nova-api` (parity is asserted in `nova-bridge.test.ts`).
 */
export const NOVA_BRIDGE_SCRIPT = `(function () {
  "use strict";
  if (window.__novaGameBridge) return;
  function report(kind, payload) {
    try {
      var parent = window.parent;
      if (parent && parent.__novaRuntime && typeof parent.__novaRuntime.report === 'function') {
        parent.__novaRuntime.report(kind, payload);
      }
    } catch (_) {}
  }
  window.addEventListener('error', function (e) {
    var target = e.target;
    var isResource = target && target !== window && target !== document;
    report('error', {
      message: String((e.error && e.error.message) || e.message || 'Script error'),
      filename: e.filename || '',
      lineno: e.lineno || 0,
      colno: e.colno || 0,
      tag: isResource ? String(target.tagName || '') : ''
    });
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason;
    var message = reason && reason.message ? String(reason.message) : String(reason);
    report('unhandledrejection', { message: message });
  });
  var methods = ['debug', 'log', 'info', 'warn', 'error'];
  for (var i = 0; i < methods.length; i++) {
    (function (method) {
      var original = console[method];
      if (typeof original !== 'function') return;
      console[method] = function () {
        var args = Array.prototype.slice.call(arguments);
        try { original.apply(console, args); } catch (_) {}
        report('console', { level: method, args: args });
      };
    })(methods[i]);
  }

  // --- Nova API surface (S1). Mirrors createNovaClient in @rocketcrab/nova-api. ---
  var API_VERSION = ${NOVA_API_VERSION};
  var registered = false;
  var readySent = false;
  var started = false;
  var ended = false;
  // Session state pushed by the host (U6 session router): this player's
  // identity, the player list, the connection status, and canonical state.
  // The identity comes from the validated runtime.bootstrap, injected by the
  // runtime page before the bridge runs.
  var selfPlayer = null;
  var players = [];
  var connectionStatus = 'disconnected';
  var stateValue = null;
  try {
    var bootstrapPlayer = window.__novaBootstrap && window.__novaBootstrap.player;
    if (bootstrapPlayer && bootstrapPlayer.memberId) {
      selfPlayer = {
        id: String(bootstrapPlayer.memberId),
        name: String(bootstrapPlayer.displayName || bootstrapPlayer.memberId)
      };
    }
  } catch (_) {}

  function NovaError(code, message) {
    this.name = 'NovaError';
    this.code = code;
    this.message = message;
  }
  function fail(code, message) {
    throw new NovaError(code, message);
  }
  function subscribe(list, fn) {
    if (typeof fn !== 'function') return function () {};
    list.push(fn);
    return function () {
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }
  function requireStarted(method) {
    if (ended) fail('ended', 'nova.' + method + '() is not available after the game ended.');
    if (!started) {
      fail('not_started', 'nova.' + method + '() is only available after the game starts (see nova.onStart).');
    }
  }
  function gameDeclaration(options) {
    var out = {};
    if (options == null) return out;
    if (typeof options.title === 'string') out.title = options.title;
    if (typeof options.mode === 'string') out.gameMode = options.mode;
    if (typeof options.version === 'string') out.gameVersion = options.version;
    if (typeof options.apiVersion === 'number') out.apiVersion = options.apiVersion;
    return out;
  }

  var joinHandlers = [];
  var leaveHandlers = [];
  var connectionHandlers = [];
  var startHandlers = [];
  var endHandlers = [];
  var errorHandlers = [];
  var stateHandlers = [];
  var rawHandlers = {};
  var simulationInputHandler = null;
  var simulationSnapshotHandler = null;

  var stateHandle = {
    get: function () { return stateValue; },
    onChange: function (fn) { return subscribe(stateHandlers, fn); }
  };
  var rawHandle = {
    createChannel: function (spec) {
      requireStarted('raw.createChannel');
      report('raw.createChannel', { spec: spec });
    },
    send: function (name, payload, options) {
      requireStarted('raw.send');
      report('raw.send', { name: name, payload: payload, options: options || {} });
    },
    onMessage: function (name, fn) {
      var list = rawHandlers[name];
      if (list === undefined) {
        list = [];
        rawHandlers[name] = list;
      }
      return subscribe(list, fn);
    }
  };
  var simulationHandle = {
    register: function (handlers) {
      simulationInputHandler = typeof handlers.onInput === 'function' ? handlers.onInput : null;
      simulationSnapshotHandler = typeof handlers.onSnapshot === 'function' ? handlers.onSnapshot : null;
      report('simulation.register', {});
      return function () {
        simulationInputHandler = null;
        simulationSnapshotHandler = null;
      };
    },
    sendInput: function (input) {
      requireStarted('simulation.sendInput');
      report('simulation.sendInput', { input: input });
    }
  };

  function hasPlayer(id) {
    for (var i = 0; i < players.length; i++) {
      if (players[i].id === id) return true;
    }
    return false;
  }
  function removePlayer(id) {
    for (var i = 0; i < players.length; i++) {
      if (players[i].id === id) { players.splice(i, 1); return; }
    }
  }
  function callHandlers(list, arg) {
    var copy = list.slice();
    for (var i = 0; i < copy.length; i++) {
      try { copy[i](arg); } catch (_) {}
    }
  }
  /**
   * Receive one host-pushed session event (a validated \`game.apiEvent\`
   * payload: \`kind\` plus the event's data fields) and dispatch it to the
   * matching window.nova handlers. Plain data only: game-registered
   * functions never cross the frame.
   */
  function receive(kind, payload) {
    switch (kind) {
      case 'identity':
        if (payload && payload.player && payload.player.id) selfPlayer = payload.player;
        break;
      case 'playerJoined': {
        var joined = payload && payload.player;
        if (joined && joined.id && !hasPlayer(joined.id)) players.push(joined);
        callHandlers(joinHandlers, joined);
        break;
      }
      case 'playerLeft': {
        var left = payload && payload.player;
        if (left && left.id) removePlayer(left.id);
        callHandlers(leaveHandlers, left);
        break;
      }
      case 'connection':
        connectionStatus = payload && payload.status;
        callHandlers(connectionHandlers, connectionStatus);
        break;
      case 'start':
        started = true;
        callHandlers(startHandlers);
        break;
      case 'end':
        ended = true;
        callHandlers(endHandlers, payload && payload.reason);
        break;
      case 'state':
        stateValue = payload && payload.state;
        callHandlers(stateHandlers, stateValue);
        break;
      case 'rawMessage':
        if (payload && payload.channel) {
          var list = rawHandlers[payload.channel];
          if (list) {
            var message = payload.message;
            for (var j = 0; j < list.length; j++) {
              try { list[j](message); } catch (_) {}
            }
          }
        }
        break;
      case 'simulationInput':
        if (simulationInputHandler) {
          try { simulationInputHandler(payload && payload.input); } catch (_) {}
        }
        break;
      case 'simulationSnapshot':
        if (simulationSnapshotHandler) {
          try { simulationSnapshotHandler(payload && payload.snapshot); } catch (_) {}
        }
        break;
      case 'error':
        if (payload) {
          callHandlers(errorHandlers, new NovaError(
            String(payload.code || 'runtime'),
            String(payload.message || 'Runtime error')
          ));
        }
        break;
    }
  }

  var api = {
    version: API_VERSION,
    defineGame: function (options) {
      if (registered) fail('already_registered', 'nova.defineGame() was already called; call it exactly once.');
      if (options != null && typeof options.apiVersion === 'number' && options.apiVersion !== API_VERSION) {
        fail('unsupported_api_version', 'nova.defineGame() targets API version ' + options.apiVersion + ', but this build supports version(s) [' + API_VERSION + '].');
      }
      registered = true;
      report('defineGame', { options: gameDeclaration(options) });
    },
    ready: function () {
      if (!registered) fail('not_registered', 'nova.ready() must be called after nova.defineGame().');
      if (ended) fail('ended', 'nova.ready() is not available after the game ended.');
      if (started) fail('already_started', 'nova.ready() is not available after the game starts.');
      if (readySent) fail('already_ready', 'nova.ready() was already called.');
      readySent = true;
      report('ready', {});
    },
    log: function () { console.log.apply(console, arguments); },
    get player() { return selfPlayer; },
    get players() { return players; },
    get connectionStatus() { return connectionStatus; },
    onPlayerJoin: function (fn) { return subscribe(joinHandlers, fn); },
    onPlayerLeave: function (fn) { return subscribe(leaveHandlers, fn); },
    onConnectionChange: function (fn) { return subscribe(connectionHandlers, fn); },
    onStart: function (fn) { return subscribe(startHandlers, fn); },
    onEnd: function (fn) { return subscribe(endHandlers, fn); },
    onError: function (fn) { return subscribe(errorHandlers, fn); },
    dispatch: function (action) {
      requireStarted('dispatch');
      report('dispatch', { action: action });
    },
    state: stateHandle,
    raw: rawHandle,
    simulation: simulationHandle
  };
  window.nova = api;
  window.__novaGameBridge = { version: ${PROTOCOL_VERSION}, receive: receive };
})();
`;

const TRUNCATE_SUFFIX = "…";

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - TRUNCATE_SUFFIX.length))}${TRUNCATE_SUFFIX}`;
}

function stringifyArg(value: unknown, depth: number): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const type = typeof value;
  if (typeof value === "string") return value;
  if (type === "number" || type === "boolean" || type === "bigint") return String(value);
  if (value instanceof Error) {
    const stack = value.stack ? `\n${value.stack}` : "";
    return `Error: ${value.message}${stack}`;
  }
  if (depth > 2) return String(value);
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    // Circular or non-serializable — fall through to String().
  }
  return String(value);
}

export interface SerializedConsoleEntry {
  /** Bounded first-argument string (1..1024 chars). */
  message: string;
  /** Bounded serialization of the remaining arguments (0..4096 chars). */
  details: string;
}

/** Stringify and bound console arguments for the `runtime.console` schema. */
export function serializeConsoleArgs(args: readonly unknown[]): SerializedConsoleEntry {
  let message = "";
  let details = "";
  if (args.length > 0) {
    message = truncate(stringifyArg(args[0], 0), 1024);
    if (args.length > 1) {
      details = truncate(
        args
          .slice(1)
          .map((arg) => stringifyArg(arg, 0))
          .join(" "),
        4096,
      );
    }
  }
  if (message.length === 0) {
    message = "(empty console entry)";
  }
  return { message, details };
}

/** Title fallback when neither the game nor the host supplied a usable one. */
export const DEFAULT_GAME_TITLE = "Untitled game";

/**
 * Merge a schema-validated game declaration with the host's bootstrap into
 * the fields of a `game.registration` message. The gameId always comes from
 * the host bootstrap; game-supplied metadata is used only after validation.
 */
export function registrationFields(input: {
  bootstrapGameId: string;
  bootstrapGameMode: GameMode;
  bootstrapTitle?: string;
  declaration?: GameDeclaration;
}): {
  gameId: string;
  title: string;
  gameMode: GameMode;
  gameVersion?: string;
} {
  return {
    gameId: input.bootstrapGameId,
    title: input.declaration?.title ?? input.bootstrapTitle ?? DEFAULT_GAME_TITLE,
    gameMode: input.declaration?.gameMode ?? input.bootstrapGameMode,
    ...(input.declaration?.gameVersion !== undefined
      ? { gameVersion: input.declaration.gameVersion }
      : {}),
  };
}
