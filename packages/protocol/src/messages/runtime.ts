import { z } from "zod";
import { runtimeEnvelopeFields } from "../envelope";
import {
  displayNameSchema,
  gameIdSchema,
  memberIdSchema,
  sha256Schema,
  timestampSchema,
  titleSchema,
} from "../ids";
import { htmlSourceSchema } from "../limits";
import { gameEndReasonSchema, gameModeSchema } from "./shared";

/**
 * Runtime-plane message schemas (host ↔ runtime).
 *
 * U6 added the session-router messages that make the local test arena (and,
 * later, a real party) work end-to-end without bypassing the runtime
 * protocol: `game.apiCall` carries a validated Nova API call from the game
 * frame (via the runtime) to the host's session router, and `game.apiEvent`
 * carries a session event from the host back into the frame. Both travel on
 * the same dedicated MessageChannel as every other runtime message and are
 * validated at both ends.
 */

/**
 * Nova API call methods the runtime forwards to the host (the session
 * router). Mirrors `novaApiCallSchemas` in apps/runtime (the runtime
 * validates before forwarding; the host re-validates at its boundary).
 */
export const NOVA_API_CALL_METHODS = [
  "ready",
  "dispatch",
  "raw.createChannel",
  "raw.send",
  "simulation.register",
  "simulation.sendInput",
] as const;

export type NovaApiCallMethod = (typeof NOVA_API_CALL_METHODS)[number];

/**
 * A forwarded Nova API call: the runtime validated the payload already
 * (never trust game input), then forwards it to the host session router
 * (U6/P1). The payload is the same shape the runtime's `novaApiCallSchemas`
 * accepted.
 */
export const gameApiCallMessageSchema = z
  .object({
    ...runtimeEnvelopeFields,
    type: z.literal("game.apiCall"),
    method: z.enum(NOVA_API_CALL_METHODS),
    payload: z.unknown(),
  })
  .strict();
export type GameApiCallMessage = z.infer<typeof gameApiCallMessageSchema>;

/** Connection status values the arena pushes into a frame (S1 surface). */
export const novaConnectionStatusSchema = z.enum([
  "connecting",
  "connected",
  "reconnecting",
  "suspended",
  "disconnected",
]);
export type NovaConnectionStatus = z.infer<typeof novaConnectionStatusSchema>;

/** One player as the host pushes it into a frame (S1 `NovaPlayer` shape). */
export const novaPlayerSchema = z.object({
  id: memberIdSchema,
  name: displayNameSchema,
});
export type NovaPlayer = z.infer<typeof novaPlayerSchema>;

/**
 * A session event pushed from the host into one runtime frame. Plain data
 * only (functions registered by a game never cross the frame); the bridge
 * dispatches each kind to the matching `window.nova` handler list.
 */
export const gameApiEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("identity"), player: novaPlayerSchema }),
  z.object({ kind: z.literal("playerJoined"), player: novaPlayerSchema }),
  z.object({ kind: z.literal("playerLeft"), player: novaPlayerSchema }),
  z.object({ kind: z.literal("connection"), status: novaConnectionStatusSchema }),
  z.object({ kind: z.literal("start") }),
  z.object({ kind: z.literal("end"), reason: gameEndReasonSchema }),
  z.object({ kind: z.literal("state"), state: z.unknown() }),
  z
    .object({
      kind: z.literal("rawMessage"),
      channel: z.string().min(1).max(64),
      message: z.object({
        from: novaPlayerSchema,
        payload: z.unknown(),
        binary: z.boolean(),
      }),
    })
    .strict(),
  z
    .object({
      kind: z.literal("simulationInput"),
      input: z.object({
        type: z.string().min(1).max(64),
        payload: z.unknown().optional(),
        tick: z.number().int().nonnegative().optional(),
        sender: novaPlayerSchema,
      }),
    })
    .strict(),
  z.object({ kind: z.literal("simulationSnapshot"), snapshot: z.unknown() }),
  z.object({
    kind: z.literal("error"),
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(512),
  }),
]);
export type GameApiEvent = z.infer<typeof gameApiEventSchema>;

/** Host → runtime: push one session event into the game frame. */
export const gameApiEventMessageSchema = z
  .object({
    ...runtimeEnvelopeFields,
    type: z.literal("game.apiEvent"),
    event: gameApiEventSchema,
  })
  .strict();
export type GameApiEventMessage = z.infer<typeof gameApiEventMessageSchema>;

/**
 * Runtime-plane messages (host ↔ runtime): messages between the Nova shell
 * and the runtime frame over the dedicated MessageChannel (U3, F4 spike
 * shape). Every schema extends the runtime envelope, so each message carries
 * the protocol version, message type, runtime instance ID, unique message
 * ID, and timestamp. Unlike peer messages there are no member/connection IDs:
 * the runtime frame is not a party member, it is an isolated execution
 * context (ADR-0001, ADR-0008).
 */

/**
 * Runtime bootstrap: the host hands a game document to the runtime frame for
 * execution (F4 spike bootstrap shape). Carries the full untrusted HTML
 * source, bounded by `htmlSourceBytes`, plus the player's identity and any
 * delegated permissions (F4 finding: `allow` must be carried at every iframe
 * hop).
 */
export const runtimeBootstrapMessageSchema = z.object({
  ...runtimeEnvelopeFields,
  type: z.literal("runtime.bootstrap"),
  gameId: gameIdSchema,
  gameTitle: titleSchema.optional(),
  gameMode: gameModeSchema,
  gameSource: htmlSourceSchema,
  player: z.object({
    memberId: memberIdSchema,
    displayName: displayNameSchema,
  }),
  permissions: z
    .object({
      allow: z.array(z.string().min(1).max(32)),
    })
    .optional(),
});
export type RuntimeBootstrapMessage = z.infer<typeof runtimeBootstrapMessageSchema>;

/** Runtime readiness: the runtime processed the bootstrap and is ready. */
export const runtimeReadinessMessageSchema = z.object({
  ...runtimeEnvelopeFields,
  type: z.literal("runtime.ready"),
  status: z.literal("ready"),
});
export type RuntimeReadinessMessage = z.infer<typeof runtimeReadinessMessageSchema>;

/**
 * Game registration: the game (via the Nova API bridge) declares itself to
 * the runtime, which forwards the registration to the host (S1, U4).
 */
export const gameRegistrationMessageSchema = z.object({
  ...runtimeEnvelopeFields,
  type: z.literal("game.registration"),
  gameId: gameIdSchema,
  title: titleSchema,
  gameMode: gameModeSchema,
  /** The game's own declared version; distinct from the protocol version. */
  gameVersion: z.string().min(1).max(32).optional(),
});
export type GameRegistrationMessage = z.infer<typeof gameRegistrationMessageSchema>;

/**
 * Game metadata: the descriptor for a saved game (ADR-0005 local storage)
 * shared between host contexts, and the same descriptor embedded as a
 * runtime-plane message when the host hands metadata to the runtime or test
 * arena.
 */
export const gameMetadataSchema = z.object({
  gameId: gameIdSchema,
  title: titleSchema,
  description: z.string().max(512).optional(),
  createdAtMs: timestampSchema,
  updatedAtMs: timestampSchema,
  sourceSha256: sha256Schema,
  sourceSizeBytes: z.number().int().nonnegative(),
});
export type GameMetadata = z.infer<typeof gameMetadataSchema>;

export const gameMetadataMessageSchema = z.object({
  ...runtimeEnvelopeFields,
  type: z.literal("game.metadata"),
  game: gameMetadataSchema,
});
export type GameMetadataMessage = z.infer<typeof gameMetadataMessageSchema>;

/**
 * Runtime error: an observable failure report from the runtime (U4
 * categories: empty source, missing structure/registration, oversized source,
 * syntax errors, remote load failures). Rate-limited by
 * `errorReportRatePerSecond`.
 */
export const runtimeErrorMessageSchema = z.object({
  ...runtimeEnvelopeFields,
  type: z.literal("runtime.error"),
  category: z.enum([
    "empty_source",
    "invalid_html",
    "missing_registration",
    "oversized_source",
    "syntax",
    "remote_load",
    "runtime",
    "crash",
    "security",
    "unsupported",
  ]),
  message: z.string().min(1).max(512),
  details: z.record(z.string(), z.unknown()).optional(),
  stack: z.string().max(4096).optional(),
});
export type RuntimeErrorMessage = z.infer<typeof runtimeErrorMessageSchema>;

/**
 * Game lifecycle event: state transitions of the game frame (F4 spike
 * lifecycle: load / reload / destroy; M1: suspend / resume / restore).
 */
export const gameLifecycleEventMessageSchema = z.object({
  ...runtimeEnvelopeFields,
  type: z.literal("game.lifecycle"),
  event: z.enum([
    "created",
    "loaded",
    "started",
    "paused",
    "resumed",
    "suspended",
    "restored",
    "reloaded",
    "destroyed",
  ]),
  detail: z.string().max(256).optional(),
});
export type GameLifecycleEventMessage = z.infer<typeof gameLifecycleEventMessageSchema>;

/**
 * End-game request: the host asks the runtime to tear the game down (the
 * Emergency Stop control lives outside the frame and cannot be disabled by
 * game code — threat model T6/T21).
 */
export const endGameRequestMessageSchema = z.object({
  ...runtimeEnvelopeFields,
  type: z.literal("game.end"),
  reason: gameEndReasonSchema,
});
export type EndGameRequestMessage = z.infer<typeof endGameRequestMessageSchema>;

/**
 * Runtime heartbeat ping: the host asks the runtime to confirm liveness
 * (F4 spike heartbeat; threat model T6 — a wedged runtime must be visible
 * to the shell).
 */
export const runtimePingMessageSchema = z
  .object({
    ...runtimeEnvelopeFields,
    type: z.literal("runtime.ping"),
  })
  .strict();
export type RuntimePingMessage = z.infer<typeof runtimePingMessageSchema>;

/** Runtime heartbeat pong: the runtime's liveness reply to `runtime.ping`. */
export const runtimePongMessageSchema = z
  .object({
    ...runtimeEnvelopeFields,
    type: z.literal("runtime.pong"),
  })
  .strict();
export type RuntimePongMessage = z.infer<typeof runtimePongMessageSchema>;

/**
 * Reload request: the host asks the runtime to re-run the current game in a
 * completely fresh frame (F4 soft reload — same source, clean state).
 */
export const runtimeReloadMessageSchema = z
  .object({
    ...runtimeEnvelopeFields,
    type: z.literal("runtime.reload"),
  })
  .strict();
export type RuntimeReloadMessage = z.infer<typeof runtimeReloadMessageSchema>;

/**
 * Console capture: a rate-limited console entry from the game frame
 * (diagnostics for U4's runtime error panel). Entries are capped by
 * `runtimeLogRatePerSecond`; the runtime reports how many entries it
 * dropped since the previous forwarded entry.
 */
export const runtimeConsoleMessageSchema = z
  .object({
    ...runtimeEnvelopeFields,
    type: z.literal("runtime.console"),
    level: z.enum(["debug", "log", "info", "warn", "error"]),
    message: z.string().min(1).max(1024),
    /** Serialized, truncated console arguments. */
    details: z.string().max(4096).optional(),
    /** Console entries dropped by the runtime rate limiter since this entry. */
    dropped: z.number().int().nonnegative().optional(),
  })
  .strict();
export type RuntimeConsoleMessage = z.infer<typeof runtimeConsoleMessageSchema>;

/** Every runtime-plane message schema, discriminated by `type`. */
export const runtimeMessagesSchema = z.discriminatedUnion("type", [
  runtimeBootstrapMessageSchema,
  runtimeReadinessMessageSchema,
  gameRegistrationMessageSchema,
  gameMetadataMessageSchema,
  runtimeErrorMessageSchema,
  gameLifecycleEventMessageSchema,
  endGameRequestMessageSchema,
  runtimePingMessageSchema,
  runtimePongMessageSchema,
  runtimeReloadMessageSchema,
  runtimeConsoleMessageSchema,
  gameApiCallMessageSchema,
  gameApiEventMessageSchema,
]);

/** All runtime-plane message type strings, for useful unknown-type errors. */
export const RUNTIME_MESSAGE_TYPES: readonly string[] = runtimeMessagesSchema.options.map(
  (option) => option.shape.type.value,
);

/** Any valid runtime-plane message. */
export type RuntimeMessage = z.infer<typeof runtimeMessagesSchema>;
