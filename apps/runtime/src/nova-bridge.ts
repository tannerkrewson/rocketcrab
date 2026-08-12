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
 * - defines `window.nova` with `nova.defineGame(options)` and forwards the
 *   declaration to the runtime page, which schema-validates it before it is
 *   ever forwarded to the host (never trust game metadata).
 *
 * The game frame is same-origin with the runtime page (ADR-0008/B5), so the
 * bridge reports through a per-instance hook on the runtime page rather than
 * a second postMessage channel — no extra message listeners, nothing to leak
 * across restarts. The bridge never touches the host origin, never touches
 * Trystero, and contains no Nova secrets.
 */
import { PROTOCOL_VERSION, gameModeSchema, titleSchema, type GameMode } from "@rocketcrab/protocol";
import { z } from "zod";

/**
 * Nova API versions this build can execute (U4 validation category
 * `unsupported`). The game-facing `window.nova` bridge currently ships the
 * protocol version (the bridge sets `window.nova.version`); if the Nova API
 * ever diverges from the protocol version, S1 formalizes its own constant in
 * `@rocketcrab/nova-api`.
 */
export const SUPPORTED_NOVA_API_VERSIONS: readonly number[] = [PROTOCOL_VERSION];

/**
 * What the runtime accepts from `nova.defineGame` (S1 will widen this).
 * `apiVersion` declares the Nova API version the game was built against;
 * the runtime reports an `unsupported` error when it is not one this build
 * can execute (U4 validation category), without refusing to run.
 */
export const gameDeclarationSchema = z.object({
  title: titleSchema.optional(),
  gameMode: gameModeSchema.optional(),
  gameVersion: z.string().min(1).max(32).optional(),
  apiVersion: z.number().int().nonnegative().max(1024).optional(),
});
export type GameDeclaration = z.infer<typeof gameDeclarationSchema>;

/** JavaScript source injected ahead of the game document (F4 spike shape). */
export const NOVA_BRIDGE_SCRIPT = [
  "(function () {",
  "  if (window.__novaGameBridge) return;",
  "  function report(kind, payload) {",
  "    try {",
  "      var parent = window.parent;",
  "      if (parent && parent.__novaRuntime && typeof parent.__novaRuntime.report === 'function') {",
  "        parent.__novaRuntime.report(kind, payload);",
  "      }",
  "    } catch (_) {}",
  "  }",
  "  window.addEventListener('error', function (e) {",
  "    var target = e.target;",
  "    var isResource = target && target !== window && target !== document;",
  "    report('error', {",
  "      message: String((e.error && e.error.message) || e.message || 'Script error'),",
  "      filename: e.filename || '',",
  "      lineno: e.lineno || 0,",
  "      colno: e.colno || 0,",
  "      tag: isResource ? String(target.tagName || '') : ''",
  "    });",
  "  }, true);",
  "  window.addEventListener('unhandledrejection', function (e) {",
  "    var reason = e.reason;",
  "    var message = reason && reason.message ? String(reason.message) : String(reason);",
  "    report('unhandledrejection', { message: message });",
  "  });",
  "  var methods = ['debug', 'log', 'info', 'warn', 'error'];",
  "  for (var i = 0; i < methods.length; i++) {",
  "    (function (method) {",
  "      var original = console[method];",
  "      if (typeof original !== 'function') return;",
  "      console[method] = function () {",
  "        var args = Array.prototype.slice.call(arguments);",
  "        try { original.apply(console, args); } catch (_) {}",
  "        report('console', { level: method, args: args });",
  "      };",
  "    })(methods[i]);",
  "  }",
  "  var api = {",
  `    version: ${PROTOCOL_VERSION},`,
  "    defineGame: function (options) {",
  "      report('defineGame', { options: options || null });",
  "    }",
  "  };",
  "  window.nova = api;",
  "  window.__novaGameBridge = { version: " + String(PROTOCOL_VERSION) + " };",
  "})();",
].join("\n");

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
