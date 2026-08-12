/**
 * Outgoing runtime-plane message construction.
 *
 * Every message the runtime sends is built here and validated against the
 * shared protocol schemas before it leaves the runtime (threat model T10;
 * engineering rules 15/21 — never emit an unvalidated message).
 */
import {
  PROTOCOL_VERSION,
  assertRuntimeMessage,
  gameLifecycleEventMessageSchema,
  gameRegistrationMessageSchema,
  runtimeConsoleMessageSchema,
  runtimeErrorMessageSchema,
  runtimePongMessageSchema,
  runtimeReadinessMessageSchema,
  type GameLifecycleEventMessage,
  type GameRegistrationMessage,
  type RuntimeConsoleMessage,
  type RuntimeErrorMessage,
} from "@rocketcrab/protocol";

/** Unique message ID for one runtime-plane message (envelope requirement). */
export function newMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Epoch-millisecond timestamp for the message envelope. */
export function nowSentAt(): number {
  return Date.now();
}

type GameLifecycleEvent = GameLifecycleEventMessage["event"];
type RuntimeConsoleLevel = RuntimeConsoleMessage["level"];
type RuntimeErrorMessageCategory = RuntimeErrorMessage["category"];

/** Build and validate a `runtime.ready` message. */
export function buildReadyMessage(runtimeInstanceId: string, sessionId?: string) {
  return assertRuntimeMessage(
    runtimeReadinessMessageSchema.parse({
      version: PROTOCOL_VERSION,
      runtimeInstanceId,
      ...(sessionId !== undefined ? { sessionId } : {}),
      messageId: newMessageId(),
      sentAt: nowSentAt(),
      type: "runtime.ready",
      status: "ready",
    }),
  );
}

/** Build and validate a `runtime.pong` message. */
export function buildPongMessage(runtimeInstanceId: string, sessionId?: string) {
  return assertRuntimeMessage(
    runtimePongMessageSchema.parse({
      version: PROTOCOL_VERSION,
      runtimeInstanceId,
      ...(sessionId !== undefined ? { sessionId } : {}),
      messageId: newMessageId(),
      sentAt: nowSentAt(),
      type: "runtime.pong",
    }),
  );
}

/** Build and validate a `game.lifecycle` event message. */
export function buildLifecycleMessage(
  runtimeInstanceId: string,
  event: GameLifecycleEvent,
  detail?: string,
  sessionId?: string,
) {
  return assertRuntimeMessage(
    gameLifecycleEventMessageSchema.parse({
      version: PROTOCOL_VERSION,
      runtimeInstanceId,
      ...(sessionId !== undefined ? { sessionId } : {}),
      messageId: newMessageId(),
      sentAt: nowSentAt(),
      type: "game.lifecycle",
      event,
      ...(detail !== undefined ? { detail } : {}),
    }),
  );
}

/** Build and validate a `game.registration` message. */
export function buildRegistrationMessage(
  runtimeInstanceId: string,
  registration: Omit<
    GameRegistrationMessage,
    "type" | "version" | "runtimeInstanceId" | "messageId" | "sentAt"
  >,
  sessionId?: string,
) {
  return assertRuntimeMessage(
    gameRegistrationMessageSchema.parse({
      version: PROTOCOL_VERSION,
      runtimeInstanceId,
      ...(sessionId !== undefined ? { sessionId } : {}),
      messageId: newMessageId(),
      sentAt: nowSentAt(),
      type: "game.registration",
      ...registration,
    }),
  );
}

/** Build and validate a `runtime.error` message. */
export function buildErrorMessage(
  runtimeInstanceId: string,
  category: RuntimeErrorMessageCategory,
  message: string,
  options: { details?: Record<string, unknown>; stack?: string; sessionId?: string } = {},
) {
  return assertRuntimeMessage(
    runtimeErrorMessageSchema.parse({
      version: PROTOCOL_VERSION,
      runtimeInstanceId,
      ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
      messageId: newMessageId(),
      sentAt: nowSentAt(),
      type: "runtime.error",
      category,
      message,
      ...(options.details !== undefined ? { details: options.details } : {}),
      ...(options.stack !== undefined ? { stack: options.stack } : {}),
    }),
  );
}

/** Build and validate a `runtime.console` message. */
export function buildConsoleMessage(
  runtimeInstanceId: string,
  level: RuntimeConsoleLevel,
  message: string,
  options: { details?: string; dropped?: number; sessionId?: string } = {},
) {
  return assertRuntimeMessage(
    runtimeConsoleMessageSchema.parse({
      version: PROTOCOL_VERSION,
      runtimeInstanceId,
      ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
      messageId: newMessageId(),
      sentAt: nowSentAt(),
      type: "runtime.console",
      level,
      message,
      ...(options.details !== undefined ? { details: options.details } : {}),
      ...(options.dropped !== undefined ? { dropped: options.dropped } : {}),
    }),
  );
}
