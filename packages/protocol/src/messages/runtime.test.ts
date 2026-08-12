import { describe, expect, it } from "vitest";
import { parseRuntimeMessage } from "../errors";
import { htmlSourceBytes } from "../limits";
import {
  RUNTIME_MESSAGE_TYPES,
  endGameRequestMessageSchema,
  gameLifecycleEventMessageSchema,
  gameMetadataMessageSchema,
  gameRegistrationMessageSchema,
  runtimeBootstrapMessageSchema,
  runtimeConsoleMessageSchema,
  runtimeErrorMessageSchema,
  runtimeMessagesSchema,
  runtimePingMessageSchema,
  runtimePongMessageSchema,
  runtimeReadinessMessageSchema,
  runtimeReloadMessageSchema,
} from "./runtime";

function baseRuntime(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    runtimeInstanceId: "runtime-1",
    sessionId: "session-1",
    messageId: "message-1",
    sentAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("runtime message schemas", () => {
  it("defines every runtime message family with a Zod schema", () => {
    const schemas = [
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
    ];
    expect(schemas).toHaveLength(RUNTIME_MESSAGE_TYPES.length);
    for (const schema of schemas) {
      expect(schema).toBeDefined();
    }
  });

  it("parses a valid example of every runtime message", () => {
    const validExamples = [
      runtimeBootstrapMessageSchema.parse(
        baseRuntime({
          type: "runtime.bootstrap",
          gameId: "game-1",
          gameMode: "state",
          gameSource: "<html><script>window.nova.register({})</script></html>",
          player: { memberId: "member-1", displayName: "Alex" },
        }),
      ),
      runtimeReadinessMessageSchema.parse(baseRuntime({ type: "runtime.ready", status: "ready" })),
      gameRegistrationMessageSchema.parse(
        baseRuntime({
          type: "game.registration",
          gameId: "game-1",
          title: "Card Game",
          gameMode: "state",
        }),
      ),
      gameMetadataMessageSchema.parse(
        baseRuntime({
          type: "game.metadata",
          game: {
            gameId: "game-1",
            title: "Card Game",
            createdAtMs: 1_700_000_000_000,
            updatedAtMs: 1_700_000_000_000,
            sourceSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            sourceSizeBytes: 2048,
          },
        }),
      ),
      runtimeErrorMessageSchema.parse(
        baseRuntime({
          type: "runtime.error",
          category: "syntax",
          message: "Unexpected token",
        }),
      ),
      gameLifecycleEventMessageSchema.parse(
        baseRuntime({ type: "game.lifecycle", event: "created" }),
      ),
      endGameRequestMessageSchema.parse(baseRuntime({ type: "game.end", reason: "user_exit" })),
      runtimePingMessageSchema.parse(baseRuntime({ type: "runtime.ping" })),
      runtimePongMessageSchema.parse(baseRuntime({ type: "runtime.pong" })),
      runtimeReloadMessageSchema.parse(baseRuntime({ type: "runtime.reload" })),
      runtimeConsoleMessageSchema.parse(
        baseRuntime({ type: "runtime.console", level: "warn", message: "flaky", dropped: 3 }),
      ),
    ];
    expect(validExamples).toHaveLength(RUNTIME_MESSAGE_TYPES.length);
  });

  it("rejects an invalid example of every runtime message", () => {
    const invalidExamples: unknown[] = [
      baseRuntime({ type: "runtime.bootstrap", gameId: "game-1", gameMode: "state" }),
      baseRuntime({ type: "runtime.ready", status: "not-ready" }),
      baseRuntime({ type: "game.registration", gameId: "game-1", gameMode: "state" }),
      baseRuntime({ type: "game.metadata", game: { gameId: "game-1" } }),
      baseRuntime({ type: "runtime.error", category: "syntax" }),
      baseRuntime({ type: "game.lifecycle", event: "exploded" }),
      baseRuntime({ type: "game.end", reason: "banana" }),
      baseRuntime({ type: "runtime.ping", status: "extra" }),
      baseRuntime({ type: "runtime.pong", status: "extra" }),
      baseRuntime({ type: "runtime.reload", source: "<html></html>" }),
      baseRuntime({ type: "runtime.console", level: "trace", message: "x" }),
    ];
    expect(invalidExamples).toHaveLength(RUNTIME_MESSAGE_TYPES.length);
    for (const example of invalidExamples) {
      const result = runtimeMessagesSchema.safeParse(example);
      expect(result.success).toBe(false);
      const boundary = parseRuntimeMessage(example);
      expect(boundary.ok).toBe(false);
    }
  });

  it("rejects oversized game source in bootstrap", () => {
    const result = parseRuntimeMessage(
      baseRuntime({
        type: "runtime.bootstrap",
        gameId: "game-1",
        gameMode: "state",
        gameSource: "x".repeat(htmlSourceBytes + 1),
        player: { memberId: "member-1", displayName: "Alex" },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_message");
    }
  });

  it("rejects unknown runtime message types with a useful error", () => {
    const result = parseRuntimeMessage(baseRuntime({ type: "runtime.teleport" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unknown_message_type");
      expect(result.error.message).toContain("runtime.teleport");
      expect(result.error.message).toContain("runtime.bootstrap");
    }
  });
});
