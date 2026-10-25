/**
 * React binding for the party engine (P4): subscribes the component to the
 * engine's state snapshots and exposes the stable control surface plus the
 * runtime-frame container binder (the same container hosts the lobby preview
 * and the full-screen play shell).
 */
import { useCallback, useRef, useSyncExternalStore } from "react";
import { partyEngine, type PartyEngine, type PartyEngineState } from "./engine";

/** Subscribe to the party engine (defaults to the page singleton). */
export function usePartyEngine(engine: PartyEngine = partyEngine): {
  state: PartyEngineState;
  engine: PartyEngine;
  bindContainer: (element: HTMLElement | null) => void;
} {
  // useSyncExternalStore needs a stable subscribe identity and a snapshot
  // reference that only changes when the engine emits. The engine calls each
  // subscriber with a fresh snapshot; keep the latest so repeated
  // getSnapshot() calls return the same object.
  const snapshot = useRef<PartyEngineState>(engine.getState());
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      engine.onState((next) => {
        snapshot.current = next;
        onStoreChange();
      }),
    [engine],
  );
  const getSnapshot = useCallback(() => snapshot.current, []);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const bindContainer = useCallback(
    (element: HTMLElement | null) => {
      engine.setContainer(element);
    },
    [engine],
  );

  return { state, engine, bindContainer };
}

export type PartyEngineActions = ReturnType<typeof usePartyEngine>;
