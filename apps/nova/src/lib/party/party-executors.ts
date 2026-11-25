import {
  LocalGameExecutor,
  type NovaGameContext,
  type NovaPlayer,
  type NovaStateExecutor,
  type NovaStateStateResult,
  type NovaStateViewResult,
  type NovaTickContext,
} from "@rocketcrab/nova-api";
import type { RuntimeHostClient } from "../runtime-host";
import {
  createFrameStateExecutor,
  type FrameStateExecutor,
  type FrameStateResponsePayload,
} from "../arena/state-executor";

/**
 * The party's state executor: the NovaSession runs the game's state handlers
 * IN the runtime frame. The engine forwards `stateRequest` apiEvents into the
 * frame and correlates the `stateResponse` apiCalls back. When no runtime frame
 * exists (external games, whose iframe the UI embeds directly, or a frame that
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

  tick(input: {
    state: unknown;
    context: NovaTickContext;
    steps: number;
    viewers: readonly NovaPlayer[];
  }): Promise<NovaStateStateResult> {
    return this.runtime() !== null ? this.frame.tick(input) : this.local.tick(input);
  }

  computeView(input: {
    state: unknown;
    viewer: NovaPlayer;
    context: NovaGameContext;
  }): Promise<NovaStateViewResult> {
    return this.runtime() !== null ? this.frame.computeView(input) : this.local.computeView(input);
  }

  handleResponse(payload: FrameStateResponsePayload): void {
    this.frame.handleResponse(payload);
  }

  dispose(): void {
    this.frame.dispose();
  }
}
