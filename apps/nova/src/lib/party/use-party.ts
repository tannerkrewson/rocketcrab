/**
 * React binding for the party engine (P4): subscribes the component to the
 * engine's state snapshots and exposes the stable control surface plus the
 * runtime-frame container binder (the same container hosts the lobby preview
 * and the full-screen play shell).
 */
import { useCallback, useEffect, useState } from "react";
import { partyEngine, type PartyEngine, type PartyEngineState } from "./engine";

/** Subscribe to the party engine (defaults to the page singleton). */
export function usePartyEngine(engine: PartyEngine = partyEngine): {
  state: PartyEngineState;
  engine: PartyEngine;
  bindContainer: (element: HTMLElement | null) => void;
} {
  const [state, setState] = useState<PartyEngineState>(() => engine.getState());

  useEffect(() => engine.onState(setState), [engine]);

  const bindContainer = useCallback(
    (element: HTMLElement | null) => {
      engine.setContainer(element);
    },
    [engine],
  );

  return { state, engine, bindContainer };
}

export type PartyEngineActions = ReturnType<typeof usePartyEngine>;
