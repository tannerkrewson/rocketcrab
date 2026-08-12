/**
 * The arena's frame state executor (S2): the host-side half of the
 * authority-runtime seam.
 *
 * State-mode games register handler functions in their runtime frame; Nova
 * shells retain the canonical state, so the authority's host session must
 * ask the authority's frame to run them (ADR-0006: the current authority's
 * runtime executes action handlers through Immer). This executor forwards
 * the engine's requests into the frame as `stateRequest` apiEvents
 * (host → runtime → bridge) and correlates the frame's answers, which come
 * back as `stateResponse` apiCalls (bridge → runtime → host) routed here by
 * the arena engine.
 *
 * Every request carries a request id; a late answer to an already-settled
 * request is dropped (rule 22: no orphaned listeners), and a request that
 * outlives the action timeout settles as `execution_timeout` so the state
 * engine can reject the action without ever adopting a partial state.
 */
import {
  actionTimeoutMs,
  type GameApiEvent,
  type SimulationResponse,
  type StateRequest,
  type StateResponse,
} from "@rocketcrab/protocol";
import type {
  NovaGameContext,
  NovaPlayer,
  NovaSimulationExecutor,
  NovaStateExecutor,
  NovaStateStateResult,
  NovaStateViewResult,
} from "@rocketcrab/nova-api";

interface PendingRequest {
  settle: (result: StateResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** A pending simulation serialization request (A1; distinct response shape). */
interface SimulationPendingRequest {
  settle: (result: SimulationResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** A valid `stateResponse` payload as the arena boundary validated it. */
export interface FrameStateResponsePayload {
  requestId: string;
  result: StateResponse;
}

function newRequestId(): string {
  return `state-${crypto.randomUUID()}`;
}

/** Create a frame executor for one player's runtime frame. */
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

  computeView(input: { state: unknown; viewer: NovaPlayer }): Promise<NovaStateViewResult> {
    return this.request<NovaStateViewResult>({
      kind: "computeView",
      state: input.state,
      viewer: input.viewer,
    });
  }

  /** Route a validated `stateResponse` apiCall back to its request. */
  handleResponse(payload: FrameStateResponsePayload): void {
    if (this.disposed) return;
    const request = this.pending.get(payload.requestId);
    if (request === undefined) {
      return; // late answer to a settled/timed-out request: drop (rule 22)
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
              resolve({ ok: true, state: response.state, views: response.views } as T);
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

/** A valid `simulationResponse` payload as the arena boundary validated it. */
export interface FrameSimulationResponsePayload {
  requestId: string;
  result: SimulationResponse;
}

/** Create a frame simulation executor for one player's runtime frame. */
export function createFrameSimulationExecutor(
  pushEvent: (event: GameApiEvent) => void,
  timeoutMs: number = actionTimeoutMs,
): FrameSimulationExecutor {
  return new FrameSimulationExecutor(pushEvent, timeoutMs);
}

/**
 * The arena's frame simulation executor (A1): the host-side half of the
 * authority-runtime seam for simulation-mode snapshots. The host asks the
 * authority's game frame to serialize its simulation state (the game's
 * `serializeState` callback) by pushing a `simulationRequest` apiEvent and
 * correlating the `simulationResponse` apiCall the bridge answers with.
 * A late answer to a settled request is dropped and a request that outlives
 * the timeout settles as `execution_timeout` (rule 22: no orphaned
 * listeners; the simulation engine skips the snapshot and keeps running).
 */
export class FrameSimulationExecutor implements NovaSimulationExecutor {
  private readonly pending = new Map<string, SimulationPendingRequest>();
  private disposed = false;

  constructor(
    private readonly pushEvent: (event: GameApiEvent) => void,
    private readonly timeoutMs: number = actionTimeoutMs,
  ) {}

  serializeState(): Promise<
    | { readonly ok: true; readonly state: unknown }
    | { readonly ok: false; readonly code: string; readonly message: string }
  > {
    const requestId = newRequestId().replace(/^state-/u, "simulation-");
    const result = new Promise<
      | { readonly ok: true; readonly state: unknown }
      | { readonly ok: false; readonly code: string; readonly message: string }
    >((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({
          ok: false,
          code: "execution_timeout",
          message: "The authority frame did not answer the simulation request in time.",
        });
      }, this.timeoutMs);
      this.pending.set(requestId, {
        settle: (response: SimulationResponse) => {
          if (response.ok) {
            resolve({ ok: true, state: response.state });
          } else {
            resolve({ ok: false, code: response.code, message: response.message });
          }
        },
        timer,
      });
      this.pushEvent({ kind: "simulationRequest", requestId });
    });
    return result;
  }

  /** Route a validated `simulationResponse` apiCall back to its request. */
  handleResponse(payload: FrameSimulationResponsePayload): void {
    if (this.disposed) return;
    const request = this.pending.get(payload.requestId);
    if (request === undefined) {
      return; // late answer to a settled/timed-out request: drop (rule 22)
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
}
