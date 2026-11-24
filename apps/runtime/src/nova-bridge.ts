/**
 * The runtime side of the game-facing API: the script inlined into every game
 * frame (`NOVA_BRIDGE_SCRIPT`, built from src/frame/entry.ts around the tested
 * `@rocketcrab/nova-api` client) and the schemas the runtime page uses to
 * validate everything that script reports before it reaches the host.
 */
import { NOVA_API_VERSION } from "@rocketcrab/nova-api/version";
import { type RuntimeGameDeclaration } from "@rocketcrab/protocol";

/**
 * Nova API versions this build can execute. The game-facing API version
 * (NOVA_API_VERSION, @rocketcrab/nova-api) is independent of the protocol
 * version. Games declare the version they target via
 * `nova.defineGame({ apiVersion })`; an unsupported version fails registration
 * with a clear `unsupported` runtime error rather than being guessed at.
 */
export const SUPPORTED_NOVA_API_VERSIONS: readonly number[] = [NOVA_API_VERSION];

/** The script inlined ahead of every game document (src/frame/entry.ts, bundled). */
export { default as NOVA_BRIDGE_SCRIPT } from "virtual:nova-frame-script";

const TRUNCATE_SUFFIX = "…";

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - TRUNCATE_SUFFIX.length))}${TRUNCATE_SUFFIX}`;
}

function stringifyArg(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const type = typeof value;
  if (typeof value === "string") return value;
  if (type === "number" || type === "boolean" || type === "bigint") return String(value);
  if (value instanceof Error) {
    const stack = value.stack ? `\n${value.stack}` : "";
    return `Error: ${value.message}${stack}`;
  }
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    // Circular or non-serializable — fall through to String().
  }
  return String(value);
}

interface SerializedConsoleEntry {
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
    message = truncate(stringifyArg(args[0]), 1024);
    if (args.length > 1) {
      details = truncate(
        args
          .slice(1)
          .map((arg) => stringifyArg(arg))
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

export const DEFAULT_GAME_TITLE = "Untitled game";

/**
 * Merge a schema-validated game declaration with the host's bootstrap into
 * the fields of a `game.registration` message. The gameId always comes from
 * the host bootstrap; game-supplied metadata is used only after validation.
 */
export function registrationFields(input: {
  bootstrapGameId: string;
  bootstrapTitle?: string;
  declaration?: RuntimeGameDeclaration;
}): {
  gameId: string;
  title: string;
  gameVersion?: string;
  tickRate?: number;
  minPlayers?: number;
  maxPlayers?: number;
} {
  return {
    gameId: input.bootstrapGameId,
    title: input.declaration?.title ?? input.bootstrapTitle ?? DEFAULT_GAME_TITLE,
    ...(input.declaration?.gameVersion !== undefined
      ? { gameVersion: input.declaration.gameVersion }
      : {}),
    ...(input.declaration?.tickRate !== undefined ? { tickRate: input.declaration.tickRate } : {}),
    ...(input.declaration?.minPlayers !== undefined
      ? { minPlayers: input.declaration.minPlayers }
      : {}),
    ...(input.declaration?.maxPlayers !== undefined
      ? { maxPlayers: input.declaration.maxPlayers }
      : {}),
  };
}
