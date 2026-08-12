/**
 * React binding for the U6 arena engine: one engine per arena mount, a state
 * snapshot for the UI, stable control callbacks, and a container binder so
 * the UI's per-player divs become the runtime frames' hosts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameMode } from "@rocketcrab/protocol";
import { ArenaEngine, type ArenaEngineOptions, type ArenaSeams } from "./engine";
import type { ArenaRunOutcome, ArenaState } from "./types";
import type { InMemoryHubOptions } from "@rocketcrab/testing";

export interface UseArenaOptions {
  source: string;
  gameId: string;
  gameMode: GameMode;
  gameTitle?: string;
  runtimeOrigin: string;
  initialPlayers: Array<{ id: string; name: string; memberId: string }>;
  seams?: ArenaSeams;
  hubOptions?: InMemoryHubOptions;
  onRunSucceeded?: (outcome: ArenaRunOutcome) => void;
}

export function useArena(options: UseArenaOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const containerRefs = useRef(new Map<string, HTMLDivElement>());
  const engineRef = useRef<ArenaEngine | null>(null);
  const [state, setState] = useState<ArenaState | null>(null);

  const getContainer = useCallback(
    (playerId: string) => containerRefs.current.get(playerId) ?? null,
    [],
  );

  // One engine per arena mount; the engine owns restarts and source
  // replacement internally (they never remount this hook).
  useEffect(() => {
    const engine = new ArenaEngine({
      source: optionsRef.current.source,
      gameId: optionsRef.current.gameId,
      gameMode: optionsRef.current.gameMode,
      gameTitle: optionsRef.current.gameTitle,
      runtimeOrigin: optionsRef.current.runtimeOrigin,
      initialPlayers: optionsRef.current.initialPlayers,
      getContainer,
      seams: optionsRef.current.seams,
      hubOptions: optionsRef.current.hubOptions,
      onState: setState,
      onRunSucceeded: (outcome) => optionsRef.current.onRunSucceeded?.(outcome),
    });
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.stop();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getContainer]);

  /** Bind (or unbind) a player's frame container div. */
  const bindContainer = useCallback(
    (playerId: string) => (element: HTMLDivElement | null) => {
      if (element !== null) {
        containerRefs.current.set(playerId, element);
      } else {
        containerRefs.current.delete(playerId);
      }
      void engineRef.current?.loadPending();
    },
    [],
  );

  /** Stable control surface (all no-ops until the engine mounts). */
  const actions = useMemo(
    () => ({
      addPlayer: (name?: string) => void engineRef.current?.addPlayer(name),
      removePlayer: (id: string) => void engineRef.current?.removePlayer(id),
      renamePlayer: (id: string, name: string) => engineRef.current?.renamePlayer(id, name),
      disconnectPlayer: (id: string) => void engineRef.current?.disconnectPlayer(id),
      reconnectPlayer: (id: string) => void engineRef.current?.reconnectPlayer(id),
      suspendPlayer: (id: string) => void engineRef.current?.suspendPlayer(id),
      resumePlayer: (id: string) => void engineRef.current?.resumePlayer(id),
      triggerAuthorityLoss: () => void engineRef.current?.triggerAuthorityLoss(),
      setLatency: (latencyMs: number) => engineRef.current?.setLatency(latencyMs),
      setDropMessages: (enabled: boolean) => engineRef.current?.setDropMessages(enabled),
      clearLogs: () => engineRef.current?.clearLogs(),
      restartAll: () => engineRef.current?.restartAll(),
      replaceSource: (source: string) => engineRef.current?.replaceSource(source),
      stop: () => engineRef.current?.stop(),
    }),
    [],
  );

  return { state, actions, bindContainer };
}

export type ArenaActions = ReturnType<typeof useArena>["actions"];
