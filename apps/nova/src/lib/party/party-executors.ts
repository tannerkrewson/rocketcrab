import {
  LocalGameExecutor,
  LocalSimulationExecutor,
  type NovaGameContext,
  type NovaPlayer,
  type NovaSimulationExecutor,
  type NovaStateExecutor,
  type NovaStateStateResult,
  type NovaStateViewResult,
} from "@rocketcrab/nova-api";
import type { RuntimeHostClient } from "../runtime-host";
import {
  createFrameSimulationExecutor,
  createFrameStateExecutor,
  type FrameSimulationExecutor,
  type FrameSimulationResponsePayload,
  type FrameStateExecutor,
  type FrameStateResponsePayload,
} from "../arena/state-executor";

/**
 * The party's state executor: the NovaSession runs the game's state handlers
 * IN the runtime frame. The engine forwards `stateRequest` apiEvents into the
 * frame and correlates the `stateResponse` apiCalls back. When no runtime frame
 * exists (classic games, whose iframe the UI embeds directly, or a frame that
 * failed to boot), requests fall back to no-op semantics (empty `{}` state, no
 * views) so the start flow still completes instead of timing out on the frame
 * executor. `runtime()` is read at call time so a rebooted frame is always the
 * target.
 */
export class PartyStateExecutor implements NovaStateExecutor {
  private readonly frame: FrameStateExecutor;
  private readonly local = new LocalGameExecutor(null);
  private readonly runtime: () => RuntimeHostClient | null;

  constructor(runtime: () => RuntimeHostClient | null) {
    this.runtime = runtime;
    this.frame = createFrameStateExecutor((event) => runtime()?.pushApiEvent(event));
  }

  createInitialState(input: {
    context: NovaGameContext;
    viewers: readonly NovaPlayer[];
  }): Promise<NovaStateStateResult> {
    return this.runtime() !== null
      ? this.frame.createInitialState(input)
      : this.local.createInitialState(input);
  }

  applyAction(input: {
    actionId: string;
    type: string;
    payload: unknown;
    state: unknown;
    context: NovaGameContext;
    viewers: readonly NovaPlayer[];
  }): Promise<NovaStateStateResult> {
    return this.runtime() !== null ? this.frame.applyAction(input) : this.local.applyAction(input);
  }

  computeView(input: { state: unknown; viewer: NovaPlayer }): Promise<NovaStateViewResult> {
    return this.runtime() !== null ? this.frame.computeView(input) : this.local.computeView(input);
  }

  /** Route a frame `stateResponse` apiCall back to its pending request. */
  handleResponse(payload: FrameStateResponsePayload): void {
    this.frame.handleResponse(payload);
  }

  dispose(): void {
    this.frame.dispose();
  }
}

/**
 * The party's simulation executor: forwards `simulationRequest` apiEvents to
 * the frame (the game's `serializeState` snapshot callback) and correlates
 * `simulationResponse`s. Falls back to the no-handler local executor when no
 * runtime frame exists (classic games, or a boot failure).
 */
export class PartySimulationExecutor implements NovaSimulationExecutor {
  private readonly frame: FrameSimulationExecutor;
  private readonly local = new LocalSimulationExecutor(null);
  private readonly runtime: () => RuntimeHostClient | null;

  constructor(runtime: () => RuntimeHostClient | null) {
    this.runtime = runtime;
    this.frame = createFrameSimulationExecutor((event) => runtime()?.pushApiEvent(event));
  }

  serializeState(): Promise<
    | { readonly ok: true; readonly state: unknown }
    | { readonly ok: false; readonly code: string; readonly message: string }
  > {
    return this.runtime() !== null ? this.frame.serializeState() : this.local.serializeState();
  }

  /** Route a frame `simulationResponse` apiCall back to its request. */
  handleResponse(payload: FrameSimulationResponsePayload): void {
    this.frame.handleResponse(payload);
  }

  dispose(): void {
    this.frame.dispose();
  }
}
