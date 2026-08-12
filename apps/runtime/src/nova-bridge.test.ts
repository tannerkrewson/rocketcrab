import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_TITLE,
  NOVA_BRIDGE_SCRIPT,
  gameDeclarationSchema,
  registrationFields,
  serializeConsoleArgs,
} from "./nova-bridge";

describe("NOVA_BRIDGE_SCRIPT", () => {
  it("defines nova.defineGame, error capture, and console wrapping", () => {
    expect(NOVA_BRIDGE_SCRIPT).toContain("window.nova");
    expect(NOVA_BRIDGE_SCRIPT).toContain("defineGame");
    expect(NOVA_BRIDGE_SCRIPT).toContain("addEventListener('error'");
    expect(NOVA_BRIDGE_SCRIPT).toContain("unhandledrejection");
    expect(NOVA_BRIDGE_SCRIPT).toContain("__novaGameBridge");
  });

  it("is valid JavaScript", () => {
    // Syntax-only check: the script must parse (it runs inside the game
    // frame, so we never execute it here).
    expect(() => new Function(NOVA_BRIDGE_SCRIPT)).not.toThrow();
  });

  it("contains no host secrets, Trystero access, or main-origin touches", () => {
    expect(NOVA_BRIDGE_SCRIPT).not.toMatch(/trystero/i);
    expect(NOVA_BRIDGE_SCRIPT).not.toMatch(/localStorage/);
    expect(NOVA_BRIDGE_SCRIPT).not.toMatch(/sessionSecret|partySecret|apiKey/);
    expect(NOVA_BRIDGE_SCRIPT).not.toMatch(/\.top\b/);
  });
});

describe("gameDeclarationSchema", () => {
  it("accepts a minimal valid declaration", () => {
    expect(gameDeclarationSchema.safeParse({}).success).toBe(true);
    expect(
      gameDeclarationSchema.safeParse({
        title: "Card Game",
        gameMode: "simulation",
        gameVersion: "1.2.3",
      }).success,
    ).toBe(true);
  });

  it("rejects oversized or malformed metadata", () => {
    expect(gameDeclarationSchema.safeParse({ title: "x".repeat(65) }).success).toBe(false);
    expect(gameDeclarationSchema.safeParse({ gameMode: "quantum" }).success).toBe(false);
    expect(gameDeclarationSchema.safeParse({ gameVersion: "" }).success).toBe(false);
  });

  it("accepts and bounds the declared Nova API version", () => {
    expect(gameDeclarationSchema.safeParse({ apiVersion: 1 }).success).toBe(true);
    expect(gameDeclarationSchema.safeParse({ apiVersion: 0 }).success).toBe(true);
    expect(gameDeclarationSchema.safeParse({ apiVersion: -1 }).success).toBe(false);
    expect(gameDeclarationSchema.safeParse({ apiVersion: 1.5 }).success).toBe(false);
    expect(gameDeclarationSchema.safeParse({ apiVersion: "1" }).success).toBe(false);
  });
});

describe("serializeConsoleArgs", () => {
  it("formats primitives and the first argument as the message", () => {
    expect(serializeConsoleArgs(["hello"])).toEqual({ message: "hello", details: "" });
    expect(serializeConsoleArgs([42, "more"])).toEqual({ message: "42", details: "more" });
    expect(serializeConsoleArgs([null, undefined])).toEqual({
      message: "null",
      details: "undefined",
    });
  });

  it("serializes objects and errors", () => {
    expect(serializeConsoleArgs([{ code: 42 }])).toEqual({
      message: '{"code":42}',
      details: "",
    });
    expect(serializeConsoleArgs([new Error("boom")]).message).toContain("Error: boom");
  });

  it("handles circular values and empty entries without throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(serializeConsoleArgs([circular]).message.length).toBeGreaterThan(0);
    expect(serializeConsoleArgs([]).message).toBe("(empty console entry)");
  });

  it("truncates oversized messages and details", () => {
    const long = "x".repeat(5000);
    const { message, details } = serializeConsoleArgs([long, long]);
    expect(message.length).toBeLessThanOrEqual(1024);
    expect(details.length).toBeLessThanOrEqual(4096);
    expect(message).toContain("…");
  });
});

describe("registrationFields", () => {
  const base = {
    bootstrapGameId: "game-1",
    bootstrapGameMode: "state" as const,
  };

  it("prefers the validated game declaration", () => {
    expect(
      registrationFields({
        ...base,
        bootstrapTitle: "Host Title",
        declaration: { title: "Game Title", gameMode: "raw", gameVersion: "2.0" },
      }),
    ).toEqual({ gameId: "game-1", title: "Game Title", gameMode: "raw", gameVersion: "2.0" });
  });

  it("falls back to host metadata then the default title", () => {
    expect(registrationFields({ ...base, bootstrapTitle: "Host Title" })).toEqual({
      gameId: "game-1",
      title: "Host Title",
      gameMode: "state",
    });
    expect(registrationFields(base)).toEqual({
      gameId: "game-1",
      title: DEFAULT_GAME_TITLE,
      gameMode: "state",
    });
  });

  it("keeps the host-declared gameId", () => {
    const fields = registrationFields({
      ...base,
      declaration: { title: "Sneaky", gameMode: "state" },
    });
    expect(fields.gameId).toBe("game-1");
  });
});
