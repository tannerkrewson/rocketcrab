/**
 * The state-mode executor seam (S2): the single place the state engine
 * asks a game to run its functions.
 *
 * State-mode games register handler functions (`createInitialState`,
 * `actions`, `selectView`) that never cross a frame boundary — Nova shells
 * retain the canonical state, and the current authority's runtime executes
 * action handlers through Immer (ADR-0006). The engine therefore never
 * calls game functions directly; it calls an executor:
 *
 * - {@link LocalGameExecutor} runs handlers that were registered in-process
 *   (the arena client in tests / the contract suite) with the real immer
 *   package;
 * - the arena host injects a frame executor (apps/nova) that forwards the
 *   same requests into the authority's game frame over the runtime bridge,
 *   where an Immer-compatible produce runs them in the game's own context.
 *
 * Both executors return plain, validated results; the engine treats a
 * failed result exactly like a rejected action and never adopts a partial
 * state (authority-runtime failure cannot corrupt the last committed
 * state).
 */
import { produce } from "immer";
import { assertStructuredCloneSafe } from "./validation";
import type { NovaGameContext, NovaPlayer, NovaStateHandlers } from "./types";

/** The players a view is computed for (member id -> view). */
export type NovaStateViews = Record<string, unknown>;

/** Result of creating the initial state (or of applying one action). */
export type NovaStateStateResult =
  | { readonly ok: true; readonly state: unknown; readonly views: NovaStateViews }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** Result of computing one player's view. */
export type NovaStateViewResult =
  | { readonly ok: true; readonly view: unknown }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** One request to run game state functions (the engine -> executor seam). */
export interface NovaStateExecutor {
  /** Build the initial canonical state and every player's initial view. */
  createInitialState(input: {
    context: NovaGameContext;
    viewers: readonly NovaPlayer[];
  }): Promise<NovaStateStateResult>;

  /** Apply one action to `state` and compute every player's new view. */
  applyAction(input: {
    actionId: string;
    type: string;
    payload: unknown;
    state: unknown;
    context: NovaGameContext;
    viewers: readonly NovaPlayer[];
  }): Promise<NovaStateStateResult>;

  /** Compute one player's view of `state` (late joiners). */
  computeView(input: { state: unknown; viewer: NovaPlayer }): Promise<NovaStateViewResult>;
}

/** Wrap a throwing handler call into a rejected result with a stable code. */
function failure(code: string, error: unknown): { ok: false; code: string; message: string } {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  return { ok: false, code, message: message.slice(0, 256) };
}

/**
 * The in-process executor: runs handlers registered through the arena
 * client with the real immer package (`immer@11.1.15`, ADR-0006). Used by
 * the contract suite and any host that keeps handlers in-process; the
 * arena's real games run their handlers in the frame through the frame
 * executor instead.
 */
export class LocalGameExecutor implements NovaStateExecutor {
  constructor(private readonly handlers: NovaStateHandlers | null) {}

  async createInitialState(input: {
    context: NovaGameContext;
    viewers: readonly NovaPlayer[];
  }): Promise<NovaStateStateResult> {
    try {
      const state =
        this.handlers?.createInitialState === undefined
          ? {}
          : await this.handlers.createInitialState(input.context);
      assertStructuredCloneSafe(state, "createInitialState result");
      const views = await this.computeViews(state, input.viewers);
      return { ok: true, state, views };
    } catch (error) {
      return failure("initial_state_error", error);
    }
  }

  async applyAction(input: {
    actionId: string;
    type: string;
    payload: unknown;
    state: unknown;
    context: NovaGameContext;
    viewers: readonly NovaPlayer[];
  }): Promise<NovaStateStateResult> {
    const handler = this.handlers?.actions?.[input.type];
    if (typeof handler !== "function") {
      return {
        ok: false,
        code: "unknown_action",
        message: `No action handler named "${input.type}" was registered.`,
      };
    }
    try {
      const next = await produce(input.state, (draft: unknown) =>
        handler(draft, input.context, input.payload),
      );
      assertStructuredCloneSafe(next, "action result state");
      const views = await this.computeViews(next, input.viewers);
      return { ok: true, state: next, views };
    } catch (error) {
      return failure("handler_error", error);
    }
  }

  async computeView(input: { state: unknown; viewer: NovaPlayer }): Promise<NovaStateViewResult> {
    try {
      const view =
        this.handlers?.selectView === undefined
          ? input.state
          : await this.handlers.selectView(input.state, input.viewer);
      assertStructuredCloneSafe(view, "selectView result");
      return { ok: true, view };
    } catch (error) {
      return failure("view_error", error);
    }
  }

  private async computeViews(
    state: unknown,
    viewers: readonly NovaPlayer[],
  ): Promise<NovaStateViews> {
    const views: NovaStateViews = {};
    for (const viewer of viewers) {
      // A view failure for one player never fails the action: that player
      // simply keeps its previous view and the host surfaces an error.
      const result = await this.computeView({ state, viewer });
      if (result.ok) {
        views[viewer.id] = result.view;
      }
    }
    return views;
  }
}
