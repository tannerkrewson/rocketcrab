import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { NOVA_API_SURFACE } from "@rocketcrab/nova-api";
import {
  DEFAULT_GAME_TITLE,
  NOVA_BRIDGE_SCRIPT,
  gameDeclarationSchema,
  novaApiCallSchemas,
  registrationFields,
  serializeConsoleArgs,
} from "./nova-bridge";

describe("NOVA_BRIDGE_SCRIPT", () => {
  it("is valid JavaScript and holds no secrets, Trystero, or top-window access", () => {
    expect(() => new Function(NOVA_BRIDGE_SCRIPT)).not.toThrow();
    expect(NOVA_BRIDGE_SCRIPT).not.toMatch(/trystero/i);
    expect(NOVA_BRIDGE_SCRIPT).not.toMatch(/sessionSecret|partySecret|apiKey/);
    expect(NOVA_BRIDGE_SCRIPT).not.toMatch(/<\/script/i);
  });
});

describe("gameDeclarationSchema", () => {
  it("accepts a minimal valid declaration", () => {
    expect(gameDeclarationSchema.safeParse({}).success).toBe(true);
    expect(
      gameDeclarationSchema.safeParse({
        title: "Card Game",
        gameVersion: "1.2.3",
      }).success,
    ).toBe(true);
  });

  it("rejects oversized or malformed metadata", () => {
    expect(gameDeclarationSchema.safeParse({ title: "x".repeat(65) }).success).toBe(false);
    expect(gameDeclarationSchema.safeParse({ tickRate: 0 }).success).toBe(false);
    expect(gameDeclarationSchema.safeParse({ gameVersion: "" }).success).toBe(false);
  });

  it("accepts and bounds the declared Nova API version", () => {
    expect(gameDeclarationSchema.safeParse({ apiVersion: 1 }).success).toBe(true);
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
    expect(novaApiCallSchemas["controls.set"].safeParse({ controls: { left: true } }).success).toBe(
      true,
    );
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
    expect(novaApiCallSchemas["controls.set"].safeParse({ controls: null }).success).toBe(true);
    expect(novaApiCallSchemas["controls.set"].safeParse({ controls: 1, extra: 1 }).success).toBe(
      false,
    );
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
  };

  it("prefers the validated game declaration", () => {
    expect(
      registrationFields({
        ...base,
        bootstrapTitle: "Host Title",
        declaration: { title: "Game Title", gameVersion: "2.0" },
      }),
    ).toEqual({ gameId: "game-1", title: "Game Title", gameVersion: "2.0" });
  });

  it("forwards declared player limits", () => {
    expect(
      registrationFields({ ...base, declaration: { title: "T", minPlayers: 2, maxPlayers: 8 } }),
    ).toEqual({ gameId: "game-1", title: "T", minPlayers: 2, maxPlayers: 8 });
    expect(gameDeclarationSchema.safeParse({ minPlayers: 3, maxPlayers: 2 }).success).toBe(false);
  });

  it("falls back to host metadata then the default title", () => {
    expect(registrationFields({ ...base, bootstrapTitle: "Host Title" })).toEqual({
      gameId: "game-1",
      title: "Host Title",
    });
    expect(registrationFields(base)).toEqual({
      gameId: "game-1",
      title: DEFAULT_GAME_TITLE,
    });
  });

  it("keeps the host-declared gameId", () => {
    const fields = registrationFields({
      ...base,
      declaration: { title: "Sneaky" },
    });
    expect(fields.gameId).toBe("game-1");
  });
});

/** The slice of `window.nova` and the bridge hook these tests drive. */
interface ExecutedBridge {
  // oxlint-disable-next-line no-explicit-any -- drives the real window.nova
  nova: any;
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
    TextEncoder,
    crypto,
    Uint8Array,
    ArrayBuffer,
  });
  return { bridge: win as unknown as ExecutedBridge, reports };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("NOVA_BRIDGE_SCRIPT executed in a frame-like context", () => {
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
      response!.payload as { result: { ok: boolean; views?: Record<string, unknown> } }
    ).result;
    expect(result.ok).toBe(true);
    expect(Object.keys(result.views ?? {})).toEqual(["a"]);
    const viewErrors = reports
      .filter((r) => r.kind === "viewError")
      .map((r) => (r.payload as { memberId: string }).memberId);
    expect(viewErrors.sort()).toEqual(["b", "c"]);
  });

  it("exposes the whole API surface", () => {
    const { bridge } = runBridge();
    for (const member of NOVA_API_SURFACE) expect(member in bridge.nova, member).toBe(true);
  });

  it("enforces the lifecycle and the API version", () => {
    const { bridge } = runBridge();
    expect(() => bridge.nova.ready()).toThrow(expect.objectContaining({ code: "not_registered" }));
    expect(() => bridge.nova.defineGame({ apiVersion: 99 })).toThrow(
      expect.objectContaining({ code: "unsupported_api_version" }),
    );
    bridge.nova.defineGame({ title: "T" });
    expect(() => bridge.nova.defineGame({})).toThrow(
      expect.objectContaining({ code: "already_registered" }),
    );
    expect(() => bridge.nova.dispatch({ type: "x" })).toThrow(
      expect.objectContaining({ code: "not_started" }),
    );
  });

  it("reports every call in a shape the runtime's schemas accept", async () => {
    const { bridge, reports } = runBridge();
    bridge.nova.defineGame({ title: "T", version: "1.0", apiVersion: 1 });
    bridge.nova.ready();
    bridge.__novaGameBridge.receive("start", {});
    void bridge.nova.dispatch({ type: "move", payload: { x: 1 } }).catch(() => {});
    bridge.nova.controls.set({ jump: true });
    await settle();
    const calls = reports.filter((r) => r.kind in novaApiCallSchemas);
    expect(calls.map((r) => r.kind).sort()).toEqual(["dispatch", "ready", "controls.set"].sort());
    for (const call of calls) {
      const schema = novaApiCallSchemas[call.kind as keyof typeof novaApiCallSchemas];
      expect(schema.safeParse(call.payload).success, call.kind).toBe(true);
    }
    const declaration = reports.find((r) => r.kind === "defineGame")?.payload as {
      options: unknown;
    };
    expect(gameDeclarationSchema.parse(declaration.options)).toEqual({
      title: "T",
      gameVersion: "1.0",
      apiVersion: 1,
    });
  });

  it("keeps players, status and state from host events, and settles dispatch on its ack", async () => {
    const { bridge, reports } = runBridge();
    bridge.nova.defineGame({});
    const views: unknown[] = [];
    bridge.nova.state.onChange((view: unknown) => views.push(view));
    const receive = bridge.__novaGameBridge.receive;
    receive("start", {});
    receive("playerJoined", { player: { id: "p2", name: "Bo" } });
    receive("connection", { status: "connected" });
    receive("state", { state: { n: 1 } });
    expect(bridge.nova.players.map((p: { id: string }) => p.id)).toContain("p2");
    expect(bridge.nova.connectionStatus).toBe("connected");
    expect(views).toEqual([{ n: 1 }]);

    const applied = bridge.nova.dispatch({ type: "go" });
    await settle();
    const { actionId } = reports.find((r) => r.kind === "dispatch")!.payload as {
      actionId: string;
    };
    receive("actionAck", { actionId, status: "rejected", errorCode: "stale_revision" });
    await expect(applied).rejects.toMatchObject({ code: "stale_revision" });
  });
});
