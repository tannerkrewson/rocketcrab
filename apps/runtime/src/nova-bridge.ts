/**
 * The runtime side of the game-facing API: the script inlined into every game
 * frame (`NOVA_BRIDGE_SCRIPT`, built from src/frame/entry.ts around the tested
 * `@rocketcrab/nova-api` client) and the schemas the runtime page uses to
 * validate everything that script reports before it reaches the host.
 */
import {
  gameModeSchema,
  simulationResponseSchema,
  stateResponseSchema,
  tickRateMax,
  titleSchema,
  type GameMode,
} from "@rocketcrab/protocol";
import { NOVA_API_VERSION } from "@rocketcrab/nova-api/version";
import { z } from "zod";

/**
 * Nova API versions this build can execute. The game-facing API version
 * (NOVA_API_VERSION, @rocketcrab/nova-api) is independent of the protocol
 * version. Games declare the version they target via
 * `nova.defineGame({ apiVersion })`; an unsupported version fails registration
 * with a clear `unsupported` runtime error rather than being guessed at.
 */
export const SUPPORTED_NOVA_API_VERSIONS: readonly number[] = [NOVA_API_VERSION];

/** What the runtime accepts from `nova.defineGame` (protocol keys). */
export const gameDeclarationSchema = z.object({
  title: titleSchema.optional(),
  gameMode: gameModeSchema.optional(),
  gameVersion: z.string().min(1).max(32).optional(),
  apiVersion: z.number().int().min(1).optional(),
  tickRate: z.number().int().min(1).max(tickRateMax).optional(),
});
export type GameDeclaration = z.infer<typeof gameDeclarationSchema>;

/**
 * Bounded payloads the runtime accepts from forwarded Nova API calls. Each
 * schema mirrors the `@rocketcrab/nova-api` validation schemas, so the runtime
 * boundary never trusts game-supplied call arguments.
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
      // The frame generates the action id so the host can correlate the
      // authority's ack back to the dispatch promise.
      actionId: z.string().min(1).max(64),
    })
    .strict(),
  "raw.createChannel": z
    .object({
      spec: z.object({
        name: z.string().min(1).max(64),
      }),
    })
    .strict(),
  "raw.close": z
    .object({
      name: z.string().min(1).max(64),
    })
    .strict(),
  "raw.send": z
    .object({
      name: z.string().min(1).max(64),
      payload: z.unknown(),
      options: z
        .object({
          to: z.string().min(1).max(64).optional(),
        })
        .optional(),
    })
    .strict(),
  "controls.set": z.object({ controls: z.unknown() }).strict(),
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
  stateResponse: z
    .object({
      requestId: z.string().min(1).max(64),
      result: stateResponseSchema,
    })
    .strict(),
  simulationResponse: z
    .object({
      requestId: z.string().min(1).max(64),
      result: simulationResponseSchema,
    })
    .strict(),
} as const;

export type NovaApiCallMethod = keyof typeof novaApiCallSchemas;

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
  bootstrapGameMode: GameMode;
  bootstrapTitle?: string;
  declaration?: GameDeclaration;
}): {
  gameId: string;
  title: string;
  gameMode: GameMode;
  gameVersion?: string;
  tickRate?: number;
} {
  return {
    gameId: input.bootstrapGameId,
    title: input.declaration?.title ?? input.bootstrapTitle ?? DEFAULT_GAME_TITLE,
    gameMode: input.declaration?.gameMode ?? input.bootstrapGameMode,
    ...(input.declaration?.gameVersion !== undefined
      ? { gameVersion: input.declaration.gameVersion }
      : {}),
    ...(input.declaration?.tickRate !== undefined ? { tickRate: input.declaration.tickRate } : {}),
  };
}
