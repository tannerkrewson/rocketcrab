/**
 * Bundled IIFE inlined before game code. Builds window.nova, forwards
 * diagnostics, and executes handlers that cannot leave the frame. Reports
 * through the same-origin parent's __novaRuntime hook; the runtime page
 * revalidates every report because game-frame input is untrusted.
 */
import { createNovaClient, type NovaSessionEvent } from "@rocketcrab/nova-api/client";
import { NovaError, toErrorCode } from "@rocketcrab/nova-api/errors";
import { LocalGameExecutor, MEMBERSHIP_ACTION_TYPES } from "@rocketcrab/nova-api/state-executor";
import type {
  NovaGameContext,
  NovaPlayer,
  NovaStateHandlers,
  NovaStateStateResult,
  NovaTickContext,
} from "@rocketcrab/nova-api";
import { NOVA_API_VERSION } from "@rocketcrab/nova-api/version";
import {
  PROTOCOL_VERSION,
  gameFileTimeoutMs,
  type FileResult,
  type GameApiEvent,
} from "@rocketcrab/protocol";

declare global {
  interface Window {
    __novaBootstrap?: {
      player?: { memberId?: string; displayName?: string };
      sharedFiles?: true;
    };
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
  const fileRequests = new Map<string, (result: FileResult) => void>();
  let executor = new LocalGameExecutor(null);

  const emit = (event: NovaSessionEvent) => {
    for (const listener of listeners) listener(event);
  };

  function requestFile(
    method: "files.put" | "files.get",
    payload: Record<string, unknown>,
  ): Promise<FileResult> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        fileRequests.delete(requestId);
        reject(
          new NovaError(
            "file_unavailable",
            "Shared files did not respond. Check your connection and reload Nova to update.",
          ),
        );
      }, gameFileTimeoutMs + 2000);
      fileRequests.set(requestId, (result) => {
        clearTimeout(timer);
        fileRequests.delete(requestId);
        if (result.status === "error")
          reject(new NovaError(toErrorCode(result.code), result.message));
        else resolve(result);
      });
      report(method, { requestId, ...payload });
    });
  }

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
          ...(declaration.version !== undefined ? { gameVersion: declaration.version } : {}),
          ...(declaration.apiVersion !== undefined ? { apiVersion: declaration.apiVersion } : {}),
          ...(declaration.tickRate !== undefined ? { tickRate: declaration.tickRate } : {}),
          ...(declaration.minPlayers !== undefined ? { minPlayers: declaration.minPlayers } : {}),
          ...(declaration.maxPlayers !== undefined ? { maxPlayers: declaration.maxPlayers } : {}),
        },
      });
    },
    ready: () => report("ready", {}),
    dispatch: async (action, actionId) => report("dispatch", { action, actionId }),
    setControls: (controls) => report("controls.set", { controls }),
    ...(window.__novaBootstrap?.sharedFiles === true
      ? {
          files: {
            async put(file) {
              const result = await requestFile("files.put", { file });
              if (result.status === "stored") return result.ref;
              throw new NovaError(
                "file_unavailable",
                "The shared file upload received an invalid reply.",
              );
            },
            async get(ref) {
              const result = await requestFile("files.get", { ref });
              if (result.status === "received") return result.file;
              throw new NovaError(
                "file_unavailable",
                "The shared file download received an invalid reply.",
              );
            },
          },
        }
      : {}),
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  async function answerStateRequest(requestId: string, request: Record<string, unknown>) {
    const respond = (result: unknown) => report("stateResponse", { requestId, result });
    const respondState = (result: NovaStateStateResult) =>
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
    const context = request.context as NovaGameContext;
    const viewers = (request.viewers ?? []) as NovaPlayer[];
    if (request.kind === "computeView") {
      const result = await executor.computeView({
        state: request.state,
        viewer: request.viewer as NovaPlayer,
        context,
      });
      respond(
        result.ok
          ? { ok: true, kind: "view", view: result.view }
          : { ok: false, kind: "error", code: result.code, message: result.message },
      );
      return;
    }
    // A membership change arrives as an applyAction the engine marked (see MEMBERSHIP_ACTION_TYPES).
    const { membership, ...gameContext } = context as NovaGameContext & { membership?: unknown };
    if (
      request.kind === "applyAction" &&
      (membership === "joined" || membership === "left") &&
      request.actionType === MEMBERSHIP_ACTION_TYPES[membership]
    ) {
      respondState(
        await executor.applyMembership({
          kind: membership,
          player: request.payload as NovaPlayer,
          state: request.state,
          context: gameContext,
          viewers,
        }),
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
    respondState(result);
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
      case "fileResult": {
        const { requestId, result } = raw as Extract<GameApiEvent, { kind: "fileResult" }>;
        fileRequests.get(requestId)?.(result);
        return;
      }
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
      case "leader":
      case "start":
      case "end":
      case "state":
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
