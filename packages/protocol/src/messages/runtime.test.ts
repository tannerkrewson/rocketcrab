import { describe, expect, it } from "vitest";
import { parseRuntimeMessage } from "../errors";
import { htmlSourceBytes } from "../limits";
import {
  RUNTIME_MESSAGE_TYPES,
  endGameRequestMessageSchema,
  gameApiCallMessageSchema,
  gameApiEventMessageSchema,
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
      gameApiCallMessageSchema,
      gameApiEventMessageSchema,
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
      gameApiCallMessageSchema.parse(
        baseRuntime({
          type: "game.apiCall",
          method: "dispatch",
          payload: { action: { type: "playCard", payload: { card: 1 } } },
        }),
      ),
      gameApiEventMessageSchema.parse(
        baseRuntime({
          type: "game.apiEvent",
          event: { kind: "playerJoined", player: { id: "member-2", name: "Blair" } },
        }),
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
      baseRuntime({ type: "game.apiCall", method: "teleport", payload: {} }),
      baseRuntime({ type: "game.apiEvent", event: { kind: "teleport" } }),
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

  it("validates game.apiCall payloads and methods at the boundary", () => {
    // Valid forwarded calls parse (the runtime validated them already).
    const ready = parseRuntimeMessage(
      baseRuntime({ type: "game.apiCall", method: "ready", payload: {} }),
    );
    expect(ready.ok).toBe(true);
    const rawSend = parseRuntimeMessage(
      baseRuntime({
        type: "game.apiCall",
        method: "raw.send",
        payload: { name: "chat", payload: { text: "hi" } },
      }),
    );
    expect(rawSend.ok).toBe(true);
    // S2: the authority frame's stateResponse answer parses at the boundary.
    const stateResponse = parseRuntimeMessage(
      baseRuntime({
        type: "game.apiCall",
        method: "stateResponse",
        payload: {
          requestId: "state-1",
          result: { kind: "state", ok: true, state: {}, views: { "member-1": {} } },
        },
      }),
    );
    expect(stateResponse.ok).toBe(true);
    // A1: the authority frame's simulationResponse answer parses too.
    const simulationResponse = parseRuntimeMessage(
      baseRuntime({
        type: "game.apiCall",
        method: "simulationResponse",
        payload: { requestId: "sim-1", result: { kind: "state", ok: true, state: { x: 1 } } },
      }),
    );
    expect(simulationResponse.ok).toBe(true);
    // The protocol boundary treats call payloads as opaque (per-method
    // payload validation happens at the runtime/host boundaries); a
    // structurally bad payload still parses as a game.apiCall envelope.
    const badStateResponse = parseRuntimeMessage(
      baseRuntime({
        type: "game.apiCall",
        method: "stateResponse",
        payload: { requestId: "state-1", result: { kind: "error", ok: "maybe" } },
      }),
    );
    expect(badStateResponse.ok).toBe(true);

    // Unknown methods and malformed envelopes fail.
    const unknownMethod = parseRuntimeMessage(
      baseRuntime({ type: "game.apiCall", method: "launchMissiles", payload: {} }),
    );
    expect(unknownMethod.ok).toBe(false);
    const noPayload = parseRuntimeMessage(baseRuntime({ type: "game.apiCall", method: "ready" }));
    expect(noPayload.ok).toBe(false);
  });

  it("validates every game.apiEvent kind", () => {
    const events = [
      { kind: "identity", player: { id: "member-1", name: "Alex" } },
      { kind: "connection", status: "reconnecting" },
      { kind: "start" },
      { kind: "end", reason: "user_exit" },
      { kind: "state", state: { tick: 1 } },
      {
        kind: "rawMessage",
        channel: "chat",
        message: { from: { id: "member-2", name: "Blair" }, payload: "hi", binary: false },
      },
      {
        kind: "simulationInput",
        input: {
          type: "move",
          payload: { dx: 1 },
          tick: 3,
          sender: { id: "member-2", name: "Blair" },
        },
      },
      { kind: "simulationSnapshot", snapshot: { tick: 5, state: { x: 1 } } },
      { kind: "simulationTick", tick: 7 },
      { kind: "simulationAuthorityChange", term: 2 },
      { kind: "simulationRequest", requestId: "sim-1" },
      {
        kind: "error",
        code: "not_started",
        message: "nova.dispatch() is only available after start",
      },
      {
        kind: "stateRequest",
        requestId: "state-1",
        request: {
          kind: "createInitialState",
          context: { self: { id: "member-1", name: "Alex" }, players: [], revision: 0, now: 1 },
          viewers: [{ id: "member-1", name: "Alex" }],
        },
      },
      {
        kind: "stateRequest",
        requestId: "state-2",
        request: {
          kind: "applyAction",
          actionId: "action-1",
          actionType: "drawCard",
          payload: {},
          state: { deck: ["ace"] },
          context: { self: { id: "member-1", name: "Alex" }, players: [], revision: 1, now: 1 },
          viewers: [{ id: "member-1", name: "Alex" }],
        },
      },
      {
        kind: "stateRequest",
        requestId: "state-3",
        request: { kind: "computeView", state: {}, viewer: { id: "member-2", name: "Blair" } },
      },
      {
        kind: "actionAck",
        actionId: "action-1",
        status: "accepted",
        revision: 2,
      },
      {
        kind: "actionAck",
        actionId: "action-2",
        status: "rejected",
        errorCode: "stale_revision",
        errorMessage: "based on revision 1; current is 2",
      },
    ];
    for (const event of events) {
      const result = parseRuntimeMessage(baseRuntime({ type: "game.apiEvent", event }));
      expect(result.ok, JSON.stringify(event)).toBe(true);
    }
    // Unknown kinds and missing required fields fail.
    const bad = parseRuntimeMessage(
      baseRuntime({ type: "game.apiEvent", event: { kind: "rawMessage", channel: "x" } }),
    );
    expect(bad.ok).toBe(false);
    const badStatus = parseRuntimeMessage(
      baseRuntime({ type: "game.apiEvent", event: { kind: "connection", status: "flaky" } }),
    );
    expect(badStatus.ok).toBe(false);
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
