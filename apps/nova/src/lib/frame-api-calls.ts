import {
  novaApiCallSchemas,
  type FileResult,
  type GameApiCallMessage,
  type GameApiEvent,
} from "@rocketcrab/protocol";
import type { NovaSession } from "@rocketcrab/nova-api";
import type { FrameStateResponsePayload } from "./arena/state-executor";

interface FrameApiCallHandlers {
  formatError?(error: unknown): string;
  onInvalid?(method: GameApiCallMessage["method"]): void;
  onFailure?(
    method: "dispatch" | "controls.set" | "files.put" | "files.get",
    message: string,
  ): void;
  onStateResponse(payload: FrameStateResponsePayload): void;
  pushApiEvent(event: GameApiEvent, targetRuntimeInstanceId?: string): void;
}

function describeFailure(
  error: unknown,
  formatError?: (error: unknown) => string,
): { code: string; message: string } {
  return {
    code: error instanceof Error && "code" in error ? String(error.code) : "invalid_options",
    message: formatError?.(error) ?? (error instanceof Error ? error.message : String(error)),
  };
}

/** Revalidate forwarded calls before they reach the host's session. */
export function routeFrameApiCall(
  { method, payload, runtimeInstanceId }: GameApiCallMessage,
  session: Pick<NovaSession, "ready" | "dispatch" | "setControls" | "files">,
  handlers: FrameApiCallHandlers,
): void {
  function replyToFile(
    method: "files.put" | "files.get",
    requestId: string,
    run: () => Promise<FileResult>,
  ): void {
    const reply = (result: FileResult) =>
      handlers.pushApiEvent({ kind: "fileResult", requestId, result }, runtimeInstanceId);
    void run().then(reply, (error: unknown) => {
      const { code, message } = describeFailure(error, handlers.formatError);
      handlers.onFailure?.(method, message);
      reply({ status: "error", code, message: message.slice(0, 512) });
    });
  }
  switch (method) {
    case "ready": {
      if (!novaApiCallSchemas.ready.safeParse(payload).success) {
        handlers.onInvalid?.(method);
        return;
      }
      session.ready();
      break;
    }
    case "dispatch": {
      const parsed = novaApiCallSchemas.dispatch.safeParse(payload);
      if (!parsed.success) {
        handlers.onInvalid?.(method);
        return;
      }
      const { action, actionId } = parsed.data;
      void session.dispatch(action, actionId).catch((error: unknown) => {
        const { code, message } = describeFailure(error, handlers.formatError);
        handlers.onFailure?.(method, message);
        handlers.pushApiEvent({
          kind: "actionAck",
          actionId,
          status: "rejected",
          errorCode: code,
          errorMessage: message,
        });
      });
      break;
    }
    case "controls.set": {
      const parsed = novaApiCallSchemas["controls.set"].safeParse(payload);
      if (!parsed.success) return;
      try {
        session.setControls(parsed.data.controls);
      } catch (error) {
        const { code, message } = describeFailure(error, handlers.formatError);
        handlers.onFailure?.(method, message);
        handlers.pushApiEvent({ kind: "error", code, message });
      }
      break;
    }
    case "files.put": {
      const parsed = novaApiCallSchemas[method].safeParse(payload);
      if (!parsed.success) {
        handlers.onInvalid?.(method);
        return;
      }
      const { requestId, file } = parsed.data;
      replyToFile(method, requestId, async () => ({
        status: "stored",
        ref: await session.files.put(file),
      }));
      break;
    }
    case "files.get": {
      const parsed = novaApiCallSchemas[method].safeParse(payload);
      if (!parsed.success) {
        handlers.onInvalid?.(method);
        return;
      }
      const { requestId, ref } = parsed.data;
      replyToFile(method, requestId, async () => ({
        status: "received",
        file: await session.files.get(ref),
      }));
      break;
    }
    case "stateResponse": {
      const parsed = novaApiCallSchemas.stateResponse.safeParse(payload);
      if (!parsed.success) {
        handlers.onInvalid?.(method);
        return;
      }
      handlers.onStateResponse(parsed.data);
      break;
    }
  }
}
