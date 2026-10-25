import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PartyEngine, PartyEngineState } from "./engine";
import { usePartyEngine } from "./use-party";

/** useSyncExternalStore binding: one stable subscription, cached snapshots. */
describe("usePartyEngine", () => {
  it("subscribes once and renders each emitted snapshot", () => {
    const handlers = new Set<(next: PartyEngineState) => void>();
    let snapshot = { phase: "idle" } as PartyEngineState;
    const engine = {
      getState: () => snapshot,
      onState: (handler: (next: PartyEngineState) => void) => {
        handlers.add(handler);
        handler(snapshot);
        return () => handlers.delete(handler);
      },
      setContainer: vi.fn(),
    } as unknown as PartyEngine;

    const { result, rerender, unmount } = renderHook(() => usePartyEngine(engine));
    expect(result.current.state.phase).toBe("idle");
    rerender();
    // A re-render must not rebuild the snapshot.
    expect(result.current.state).toBe(snapshot);

    const next = { phase: "lobby" } as PartyEngineState;
    act(() => {
      snapshot = next;
      for (const handler of handlers) handler(next);
    });
    expect(result.current.state).toBe(next);

    unmount();
    expect(handlers.size).toBe(0);
  });

  it("binds the runtime container through the stable callback", () => {
    const setContainer = vi.fn();
    const snapshot = { phase: "idle" } as PartyEngineState;
    const engine = {
      getState: () => snapshot,
      onState: () => () => undefined,
      setContainer,
    } as unknown as PartyEngine;
    const { result } = renderHook(() => usePartyEngine(engine));
    const element = document.createElement("div");
    result.current.bindContainer(element);
    expect(setContainer).toHaveBeenCalledWith(element);
  });
});
