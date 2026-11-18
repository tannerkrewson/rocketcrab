/**
 * Bundled IIFE inlined before game code. Builds window.nova, forwards
 * diagnostics, and executes handlers that cannot leave the frame. Reports
 * through the same-origin parent's __novaRuntime hook; the runtime page
 * revalidates every report because game-frame input is untrusted.
 */
import { createNovaClient, type NovaSessionEvent } from "@rocketcrab/nova-api/client";
import { NovaError, toErrorCode } from "@rocketcrab/nova-api/errors";
import { LocalGameExecutor } from "@rocketcrab/nova-api/state-executor";
import type {
  NovaGameContext,
  NovaPlayer,
  NovaSimulationHandlers,
  NovaStateHandlers,
  NovaTickContext,
} from "@rocketcrab/nova-api";
import { NOVA_API_VERSION } from "@rocketcrab/nova-api/version";
import { PROTOCOL_VERSION } from "@rocketcrab/protocol";

declare global {
  interface Window {
    __novaBootstrap?: { player?: { memberId?: string; displayName?: string } };
    __novaGameBridge?: { version: number; receive(kind: string, payload: unknown): void };
    nova?: unknown;
  }
}

type Payload = Record<string, unknown> | undefined;

function report(kind: string, payload: unknown): void {
  try {
    const runtime = (
      window.parent as unknown as {
        __novaRuntime?: { report?: (kind: string, payload: unknown) => void };
      }
    ).__novaRuntime;
    runtime?.report?.(kind, payload);
  } catch {
    // The runtime page went away; nothing to report to.
  }
}

function captureErrorsAndConsole(): void {
  window.addEventListener(
    "error",
    (event) => {
      const target = event.target as { tagName?: string } | null;
      const isResource = target !== null && target !== (window as unknown) && target !== document;
      report("error", {
        message: String(
          (event.error as Error | undefined)?.message ?? event.message ?? "Script error",
        ),
        filename: event.filename ?? "",
        lineno: event.lineno ?? 0,
        colno: event.colno ?? 0,
        tag: isResource ? String(target.tagName ?? "") : "",
      });
    },
    true,
  );
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { message?: unknown } | undefined;
    report("unhandledrejection", {
      message: reason?.message !== undefined ? String(reason.message) : String(event.reason),
    });
  });
  for (const level of ["debug", "log", "info", "warn", "error"] as const) {
    const original = console[level];
    if (typeof original !== "function") continue;
    console[level] = (...args: unknown[]) => {
      try {
        original.apply(console, args);
      } catch {
        // A broken console must not break the game.
      }
      report("console", { level, args });
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function install(): void {
  if (window.__novaGameBridge) return;
  captureErrorsAndConsole();

  const bootstrap = window.__novaBootstrap?.player;
  let self: NovaPlayer | null =
    bootstrap?.memberId !== undefined
      ? {
          id: String(bootstrap.memberId),
          name: String(bootstrap.displayName ?? bootstrap.memberId),
        }
      : null;
  const listeners = new Set<(event: NovaSessionEvent) => void>();
  let executor = new LocalGameExecutor(null);
  let simulation: NovaSimulationHandlers | null = null;

  const emit = (event: NovaSessionEvent) => {
    for (const listener of listeners) listener(event);
  };

  const client = createNovaClient({
    apiVersion: NOVA_API_VERSION,
    get self() {
      return self;
    },
    register(declaration, handlers?: NovaStateHandlers) {
      executor = new LocalGameExecutor(handlers ?? null, (memberId, message) =>
        report("viewError", { memberId, message: message.slice(0, 256) }),
      );
      report("defineGame", {
        options: {
          ...(declaration.title !== undefined ? { title: declaration.title } : {}),
          ...(declaration.mode !== undefined ? { gameMode: declaration.mode } : {}),
          ...(declaration.version !== undefined ? { gameVersion: declaration.version } : {}),
          ...(declaration.apiVersion !== undefined ? { apiVersion: declaration.apiVersion } : {}),
          ...(declaration.tickRate !== undefined ? { tickRate: declaration.tickRate } : {}),
        },
      });
    },
    ready: () => report("ready", {}),
    dispatch: async (action, actionId) => report("dispatch", { action, actionId }),
    createRawChannel: (spec) => report("raw.createChannel", { spec: { name: spec.name } }),
    closeRawChannel: (name) => report("raw.close", { name }),
    sendRaw: (name, payload, options) =>
      report("raw.send", {
        name,
        payload,
        options: options?.to !== undefined ? { to: options.to } : {},
      }),
    registerSimulation(handlers) {
      simulation = handlers ?? null;
      report("simulation.register", {});
    },
    sendSimulationInput: (input) => report("simulation.sendInput", { input }),
    setControls: (controls) => report("controls.set", { controls }),
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  async function answerStateRequest(requestId: string, request: Record<string, unknown>) {
    const respond = (result: unknown) => report("stateResponse", { requestId, result });
    const context = request.context as NovaGameContext;
    const viewers = (request.viewers ?? []) as NovaPlayer[];
    if (request.kind === "computeView") {
      const result = await executor.computeView({
        state: request.state,
        viewer: request.viewer as NovaPlayer,
      });
      respond(
        result.ok
          ? { ok: true, kind: "view", view: result.view }
          : { ok: false, kind: "error", code: result.code, message: result.message },
      );
      return;
    }
    const result =
      request.kind === "createInitialState"
        ? await executor.createInitialState({ context, viewers })
        : request.kind === "applyAction"
          ? await executor.applyAction({
              actionId: String(request.actionId),
              type: String(request.actionType),
              payload: request.payload,
              state: request.state,
              context,
              viewers,
            })
          : request.kind === "tick"
            ? await executor.tick({
                state: request.state,
                context: context as NovaTickContext,
                steps: Number(request.steps),
                viewers,
              })
            : { ok: false as const, code: "invalid_request", message: "Unknown state request." };
    respond(
      result.ok
        ? {
            ok: true,
            kind: "state",
            state: result.state,
            views: result.views,
            ...(result.viewIsState === true ? { viewIsState: true } : {}),
          }
        : { ok: false, kind: "error", code: result.code, message: result.message },
    );
  }

  async function answerSimulationRequest(requestId: string) {
    const respond = (result: unknown) => report("simulationResponse", { requestId, result });
    const fail = (code: string, message: string) =>
      respond({ ok: false, kind: "error", code, message: message.slice(0, 256) });
    if (simulation?.serializeState === undefined) {
      fail("no_snapshot_handler", "The game did not register a serializeState handler.");
      return;
    }
    try {
      const state = await simulation.serializeState();
      if (state === undefined) fail("no_snapshot_handler", "serializeState returned nothing.");
      else respond({ ok: true, kind: "state", state });
    } catch (error) {
      fail("snapshot_error", errorMessage(error));
    }
  }

  function receive(kind: string, raw: unknown): void {
    const p = (raw ?? {}) as Payload & Record<string, unknown>;
    switch (kind) {
      case "identity":
        self = p.player as NovaPlayer;
        return;
      case "stateRequest":
        void answerStateRequest(String(p.requestId), p.request as Record<string, unknown>);
        return;
      case "simulationRequest":
        void answerSimulationRequest(String(p.requestId));
        return;
      case "actionAck":
        emit({
          type: "actionAck",
          ack: {
            actionId: String(p.actionId),
            status: p.status as "accepted" | "rejected" | "superseded",
            ...(p.revision !== undefined ? { revision: p.revision as number } : {}),
            ...(p.errorCode !== undefined ? { errorCode: String(p.errorCode) } : {}),
            ...(p.errorMessage !== undefined ? { errorMessage: String(p.errorMessage) } : {}),
          },
        });
        return;
      case "error":
        emit({
          type: "error",
          error: new NovaError(toErrorCode(String(p.code)), String(p.message)),
        });
        return;
      case "playerJoined":
      case "playerLeft":
      case "connection":
      case "start":
      case "end":
      case "state":
      case "rawMessage":
      case "simulationInput":
      case "simulationSnapshot":
      case "simulationTick":
        // These host events have the same fields as the client's events.
        emit({ ...p, type: kind } as NovaSessionEvent);
        return;
    }
  }

  // `dispose` is for in-process hosts; a game has no use for it.
  Reflect.deleteProperty(client, "dispose");
  window.nova = client;
  window.__novaGameBridge = { version: PROTOCOL_VERSION, receive };
}

install();
