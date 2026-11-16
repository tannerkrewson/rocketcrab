import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { NOVA_API_SURFACE } from "@rocketcrab/nova-api";
import {
  DEFAULT_GAME_TITLE,
  NOVA_API_CALL_METHODS,
  NOVA_BRIDGE_SCRIPT,
  gameDeclarationSchema,
  novaApiCallSchemas,
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

  it("exposes the full Nova API surface (S1 parity with @rocketcrab/nova-api)", () => {
    for (const member of NOVA_API_SURFACE) {
      expect(NOVA_BRIDGE_SCRIPT, `missing surface member ${member}`).toContain(member);
    }
  });

  it("carries no game-hosting, deployment, or transport vocabulary", () => {
    expect(NOVA_BRIDGE_SCRIPT).not.toMatch(/host\(/i);
    expect(NOVA_BRIDGE_SCRIPT).not.toMatch(/deploy/i);
    expect(NOVA_BRIDGE_SCRIPT).not.toMatch(/server/i);
    expect(NOVA_BRIDGE_SCRIPT).not.toMatch(/room/i);
  });

  it("embeds the current Nova API version and enforces it on defineGame", () => {
    expect(NOVA_BRIDGE_SCRIPT).toContain("API_VERSION = 1");
    expect(NOVA_BRIDGE_SCRIPT).toContain("unsupported_api_version");
    expect(NOVA_BRIDGE_SCRIPT).toContain("not_started");
    expect(NOVA_BRIDGE_SCRIPT).toContain("already_ready");
    expect(NOVA_BRIDGE_SCRIPT).toContain("already_registered");
    expect(NOVA_BRIDGE_SCRIPT).toContain("not_registered");
  });

  it("maps game-facing declaration keys to protocol keys before reporting", () => {
    expect(NOVA_BRIDGE_SCRIPT).toContain("out.gameMode = options.mode");
    expect(NOVA_BRIDGE_SCRIPT).toContain("out.gameVersion = options.version");
    expect(NOVA_BRIDGE_SCRIPT).toContain("report('defineGame'");
  });

  it("forwards every callable surface member to the runtime", () => {
    for (const method of NOVA_API_CALL_METHODS) {
      expect(NOVA_BRIDGE_SCRIPT).toContain(`report('${method}'`);
    }
  });

  it("receives host-pushed session events and keeps session state (U6 router)", () => {
    // The host session router pushes game.apiEvent payloads into the frame
    // through the same-origin hook; the bridge dispatches each kind to the
    // matching handler lists and updates the stateful reads.
    expect(NOVA_BRIDGE_SCRIPT).toContain(
      "window.__novaGameBridge = { version: 1, receive: receive }",
    );
    expect(NOVA_BRIDGE_SCRIPT).toContain("function receive(kind, payload)");
    for (const kind of [
      "'playerJoined'",
      "'playerLeft'",
      "'connection'",
      "'start'",
      "'end'",
      "'state'",
      "'rawMessage'",
      "'simulationInput'",
      "'simulationSnapshot'",
      "'simulationTick'",
      "'simulationAuthorityChange'",
      "'simulationRequest'",
      "'error'",
    ]) {
      expect(NOVA_BRIDGE_SCRIPT).toContain(`case ${kind}:`);
    }
    // Session state is now stateful (mirrors createNovaClient getters).
    expect(NOVA_BRIDGE_SCRIPT).toContain("get player()");
    expect(NOVA_BRIDGE_SCRIPT).toContain("get players()");
    expect(NOVA_BRIDGE_SCRIPT).toContain("get connectionStatus()");
    expect(NOVA_BRIDGE_SCRIPT).toContain("var selfPlayer = null;");
    expect(NOVA_BRIDGE_SCRIPT).toContain("var connectionStatus = 'disconnected';");
    // The bootstrap player identity is injected before the bridge runs.
    expect(NOVA_BRIDGE_SCRIPT).toContain("window.__novaBootstrap");
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
    // API versions start at 1 (S1 policy: NOVA_API_VERSION).
    expect(gameDeclarationSchema.safeParse({ apiVersion: 0 }).success).toBe(false);
    expect(gameDeclarationSchema.safeParse({ apiVersion: -1 }).success).toBe(false);
    expect(gameDeclarationSchema.safeParse({ apiVersion: 1.5 }).success).toBe(false);
    expect(gameDeclarationSchema.safeParse({ apiVersion: "1" }).success).toBe(false);
  });
});

describe("novaApiCallSchemas", () => {
  it("accepts valid forwarded calls", () => {
    expect(novaApiCallSchemas.ready.safeParse({}).success).toBe(true);
    expect(
      novaApiCallSchemas.dispatch.safeParse({
        action: { type: "playCard", payload: { c: 1 } },
        actionId: "action-frame-1",
      }).success,
    ).toBe(true);
    expect(
      novaApiCallSchemas.stateResponse.safeParse({
        requestId: "state-1",
        result: { kind: "view", ok: true, view: { hand: "ace" } },
      }).success,
    ).toBe(true);
    expect(
      novaApiCallSchemas.stateResponse.safeParse({
        requestId: "state-1",
        result: { kind: "error", ok: false, code: "handler_error", message: "boom" },
      }).success,
    ).toBe(true);
    expect(
      novaApiCallSchemas["raw.createChannel"].safeParse({
        spec: { name: "chat", binary: true },
      }).success,
    ).toBe(true);
    expect(
      novaApiCallSchemas["raw.send"].safeParse({
        name: "chat",
        payload: { text: "hi" },
        options: { to: "member-2" },
      }).success,
    ).toBe(true);
    expect(novaApiCallSchemas["raw.close"].safeParse({ name: "chat" }).success).toBe(true);
    expect(
      novaApiCallSchemas["simulation.sendInput"].safeParse({
        input: { type: "move", tick: 3 },
      }).success,
    ).toBe(true);
    expect(
      novaApiCallSchemas.simulationResponse.safeParse({
        requestId: "sim-1",
        result: { kind: "state", ok: true, state: { puck: { x: 1 } } },
      }).success,
    ).toBe(true);
  });

  it("rejects malformed forwarded calls", () => {
    expect(novaApiCallSchemas.ready.safeParse({ extra: 1 }).success).toBe(false);
    expect(novaApiCallSchemas.dispatch.safeParse({ action: { type: "" } }).success).toBe(false);
    expect(novaApiCallSchemas.dispatch.safeParse({ action: { type: "x" } }).success).toBe(false);
    expect(
      novaApiCallSchemas.stateResponse.safeParse({
        requestId: "state-1",
        result: { kind: "state", ok: true, state: {} },
      }).success,
    ).toBe(false);
    expect(
      novaApiCallSchemas["raw.createChannel"].safeParse({ spec: { name: "x".repeat(65) } }).success,
    ).toBe(false);
    expect(novaApiCallSchemas["raw.send"].safeParse({ name: "chat" }).success).toBe(false);
    expect(novaApiCallSchemas["raw.close"].safeParse({ name: "x".repeat(65) }).success).toBe(false);
    expect(
      novaApiCallSchemas["simulation.sendInput"].safeParse({ input: { type: "move", tick: -1 } })
        .success,
    ).toBe(false);
    expect(
      novaApiCallSchemas.simulationResponse.safeParse({
        requestId: "sim-1",
        result: { kind: "view", ok: true, view: {} },
      }).success,
    ).toBe(false);
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

/** The slice of `window.nova` and the bridge hook these tests drive. */
interface ExecutedBridge {
  nova: {
    defineGame(options: Record<string, unknown>): void;
    onStart(fn: () => void): () => void;
    raw: { onMessage(name: string, fn: (message: unknown) => void): () => void };
  };
  __novaGameBridge: { receive(kind: string, payload: unknown): void };
}

interface ExecutedFrame {
  bridge: ExecutedBridge;
  reports: Array<{ kind: string; payload: unknown }>;
}

/**
 * Run the real bridge script in a fresh context, the way the game frame does,
 * with `window.parent` pointing back at the frame's own hook so reports are
 * captured. The script is executed (not string-matched) so the object shapes
 * it builds are exercised.
 */
function runBridge(): ExecutedFrame {
  const reports: ExecutedFrame["reports"] = [];
  const win: Record<string, unknown> = {
    addEventListener: () => {},
    __novaRuntime: {
      report: (kind: string, payload: unknown) => reports.push({ kind, payload }),
    },
  };
  win.parent = win;
  const silentConsole = { debug() {}, log() {}, info() {}, warn() {}, error() {} };
  vm.runInNewContext(NOVA_BRIDGE_SCRIPT, {
    window: win,
    document: {},
    console: silentConsole,
    setTimeout,
    clearTimeout,
    structuredClone,
  });
  return { bridge: win as unknown as ExecutedBridge, reports };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("NOVA_BRIDGE_SCRIPT executed in a frame-like context", () => {
  it("delivers raw messages on channels named like Object.prototype keys", () => {
    const { bridge } = runBridge();
    const seen: unknown[] = [];
    expect(() => bridge.nova.raw.onMessage("constructor", (m) => seen.push(m))).not.toThrow();
    bridge.__novaGameBridge.receive("rawMessage", { channel: "constructor", message: 42 });
    expect(seen).toEqual([42]);
  });

  it("runs onStart handlers once even when the host delivers start twice", () => {
    const { bridge } = runBridge();
    let starts = 0;
    bridge.nova.onStart(() => {
      starts += 1;
    });
    bridge.__novaGameBridge.receive("start", {});
    bridge.__novaGameBridge.receive("start", {});
    expect(starts).toBe(1);
  });

  it("drops only the viewers whose selectView fails, and reports each one by member", async () => {
    const { bridge, reports } = runBridge();
    bridge.nova.defineGame({
      createInitialState: () => ({ n: 1 }),
      selectView: async (state: { n: number }, viewer: { id: string }) => {
        if (viewer.id === "b") throw new Error("no view for b");
        if (viewer.id === "c") throw new Error("sync failure for c");
        return { n: state.n, for: viewer.id };
      },
    });
    bridge.__novaGameBridge.receive("stateRequest", {
      requestId: "r1",
      request: {
        kind: "createInitialState",
        context: {},
        viewers: [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
          { id: "c", name: "C" },
        ],
      },
    });
    await settle();
    const response = reports.find((r) => r.kind === "stateResponse");
    const result = (
      response?.payload as { result: { ok: boolean; views?: Record<string, unknown> } }
    ).result;
    expect(result.ok).toBe(true);
    expect(Object.keys(result.views ?? {})).toEqual(["a"]);
    const viewErrors = reports
      .filter((r) => r.kind === "viewError")
      .map((r) => (r.payload as { memberId: string }).memberId);
    expect(viewErrors.sort()).toEqual(["b", "c"]);
  });
});
