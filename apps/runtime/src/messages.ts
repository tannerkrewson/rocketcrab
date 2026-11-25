/** Validate every outgoing runtime message against shared protocol schemas. */
import {
  PROTOCOL_VERSION,
  assertRuntimeMessage,
  gameApiCallMessageSchema,
  gameLifecycleEventMessageSchema,
  gameRegistrationMessageSchema,
  runtimeConsoleMessageSchema,
  runtimeErrorMessageSchema,
  runtimePongMessageSchema,
  runtimeReadinessMessageSchema,
  type GameLifecycleEventMessage,
  type GameRegistrationMessage,
  type NovaApiCallMethod,
  type RuntimeConsoleMessage,
  type RuntimeErrorMessage,
} from "@rocketcrab/protocol";

export function newMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function nowSentAt(): number {
  return Date.now();
}

type GameLifecycleEvent = GameLifecycleEventMessage["event"];
type RuntimeConsoleLevel = RuntimeConsoleMessage["level"];
type RuntimeErrorMessageCategory = RuntimeErrorMessage["category"];

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

export function buildApiCallMessage(
  runtimeInstanceId: string,
  method: NovaApiCallMethod,
  payload: unknown,
  sessionId?: string,
) {
  return assertRuntimeMessage(
    gameApiCallMessageSchema.parse({
      version: PROTOCOL_VERSION,
      runtimeInstanceId,
      ...(sessionId !== undefined ? { sessionId } : {}),
      messageId: newMessageId(),
      sentAt: nowSentAt(),
      type: "game.apiCall",
      method,
      payload,
    }),
  );
}
