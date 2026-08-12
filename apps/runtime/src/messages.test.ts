import { describe, expect, it } from "vitest";
import { parseRuntimeMessage } from "@rocketcrab/protocol";
import {
  buildConsoleMessage,
  buildErrorMessage,
  buildLifecycleMessage,
  buildPongMessage,
  buildReadyMessage,
  buildRegistrationMessage,
  newMessageId,
} from "./messages";

describe("runtime message builders", () => {
  it("produces messages that pass the protocol boundary parser", () => {
    const messages = [
      buildReadyMessage("runtime-1"),
      buildPongMessage("runtime-1", "session-1"),
      buildLifecycleMessage("runtime-1", "created"),
      buildLifecycleMessage("runtime-1", "destroyed", "user_exit", "session-1"),
      buildRegistrationMessage("runtime-1", {
        gameId: "game-1",
        title: "Card Game",
        gameMode: "state",
        gameVersion: "1.0.0",
      }),
      buildErrorMessage("runtime-1", "syntax", "Unexpected token"),
      buildErrorMessage("runtime-1", "remote_load", "cdn down", {
        details: { resource: "IMG" },
      }),
      buildConsoleMessage("runtime-1", "warn", "flaky", { details: "42", dropped: 3 }),
    ];
    for (const message of messages) {
      expect(parseRuntimeMessage(message).ok).toBe(true);
    }
  });

  it("carries the envelope fields on every message", () => {
    const ready = buildReadyMessage("runtime-1", "session-9");
    expect(ready.version).toBe(1);
    expect(ready.runtimeInstanceId).toBe("runtime-1");
    expect(ready.sessionId).toBe("session-9");
    expect(ready.type).toBe("runtime.ready");
    expect(ready.messageId.length).toBeGreaterThan(0);
    expect(ready.sentAt).toBeGreaterThan(0);
  });

  it("generates unique message ids", () => {
    const ids = new Set([newMessageId(), newMessageId(), newMessageId()]);
    expect(ids.size).toBe(3);
  });

  it("omits optional fields when not provided", () => {
    const consoleMessage = buildConsoleMessage("runtime-1", "log", "hi");
    expect(consoleMessage).not.toHaveProperty("details");
    expect(consoleMessage).not.toHaveProperty("dropped");
    const ready = buildReadyMessage("runtime-1");
    expect(ready).not.toHaveProperty("sessionId");
  });
});
