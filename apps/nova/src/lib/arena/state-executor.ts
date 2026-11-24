/**
 * Authority handlers execute in the runtime frame, while the host retains
 * canonical state. Forward stateRequest events into the frame
 * and correlate stateResponse calls with pending engine requests.
 *
 * Drop late responses and fail timed-out requests with execution_timeout
 * so the engine never adopts partial state.
 */
import {
  actionTimeoutMs,
  type GameApiEvent,
  type StateRequest,
  type StateResponse,
} from "@rocketcrab/protocol";
import type {
  NovaGameContext,
  NovaPlayer,
  NovaStateExecutor,
  NovaStateStateResult,
  NovaStateViewResult,
  NovaTickContext,
} from "@rocketcrab/nova-api";

interface PendingRequest {
  settle: (result: StateResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface FrameStateResponsePayload {
  requestId: string;
  result: StateResponse;
}

function newRequestId(): string {
  return `state-${crypto.randomUUID()}`;
}

export function createFrameStateExecutor(
  pushEvent: (event: GameApiEvent) => void,
  timeoutMs: number = actionTimeoutMs,
): FrameStateExecutor {
  return new FrameStateExecutor(pushEvent, timeoutMs);
}

export class FrameStateExecutor implements NovaStateExecutor {
  private readonly pending = new Map<string, PendingRequest>();
  private disposed = false;

  constructor(
    private readonly pushEvent: (event: GameApiEvent) => void,
    private readonly timeoutMs: number = actionTimeoutMs,
  ) {}

  createInitialState(input: {
    context: NovaGameContext;
    viewers: readonly NovaPlayer[];
  }): Promise<NovaStateStateResult> {
    return this.request<NovaStateStateResult>({
      kind: "createInitialState",
      context: input.context,
      viewers: [...input.viewers],
    });
  }

  applyAction(input: {
    actionId: string;
    type: string;
    payload: unknown;
    state: unknown;
    context: NovaGameContext;
    viewers: readonly NovaPlayer[];
  }): Promise<NovaStateStateResult> {
    return this.request<NovaStateStateResult>({
      kind: "applyAction",
      actionId: input.actionId,
      actionType: input.type,
      payload: input.payload,
      state: input.state,
      context: input.context,
      viewers: [...input.viewers],
    });
  }

  tick(input: {
    state: unknown;
    context: NovaTickContext;
    steps: number;
    viewers: readonly NovaPlayer[];
  }): Promise<NovaStateStateResult> {
    return this.request<NovaStateStateResult>({
      kind: "tick",
      state: input.state,
      context: input.context,
      steps: input.steps,
      viewers: [...input.viewers],
    });
  }

  computeView(input: {
    state: unknown;
    viewer: NovaPlayer;
    context: NovaGameContext;
  }): Promise<NovaStateViewResult> {
    return this.request<NovaStateViewResult>({
      kind: "computeView",
      state: input.state,
      viewer: input.viewer,
      context: input.context,
    });
  }

  handleResponse(payload: FrameStateResponsePayload): void {
    if (this.disposed) return;
    const request = this.pending.get(payload.requestId);
    if (request === undefined) {
      return; // Ignore responses to settled or timed-out requests.
    }
    this.pending.delete(payload.requestId);
    clearTimeout(request.timer);
    request.settle(payload.result);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.settle({
        kind: "error",
        ok: false,
        code: "execution_failed",
        message: "The frame executor was disposed.",
      });
    }
    this.pending.clear();
  }

  /**
   * Send one state request into the frame and resolve with the answer.
   * The schema-validated StateResponse is structurally compatible with the
   * executor result types (ok + state/views | view | code/message), so the
   * cast is safe at the validated boundary.
   */
  private request<T extends NovaStateStateResult | NovaStateViewResult>(
    request: StateRequest,
  ): Promise<T> {
    const requestId = newRequestId();
    const result = new Promise<T>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({
          ok: false,
          code: "execution_timeout",
          message: "The authority frame did not answer the state request in time.",
        } as T);
      }, this.timeoutMs);
      this.pending.set(requestId, {
        settle: (response: StateResponse) => {
          // Map the protocol shape onto the executor result contract (the
          // protocol's `kind` discriminator is internal).
          if (response.ok) {
            if (response.kind === "state") {
              resolve({
                ok: true,
                state: response.state,
                views: response.views,
                ...(response.viewIsState === true ? { viewIsState: true } : {}),
              } as T);
            } else {
              resolve({ ok: true, view: response.view } as T);
            }
          } else {
            resolve({ ok: false, code: response.code, message: response.message } as T);
          }
        },
        timer,
      });
      this.pushEvent({ kind: "stateRequest", requestId, request });
    });
    return result;
  }
}
