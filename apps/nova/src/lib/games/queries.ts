import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateSavedGameInput,
  DuplicateSavedGameInput,
  TestResultsInput,
  UpdateSavedGameInput,
} from "@rocketcrab/core";
import { gameRepository } from "./instance";

/**
 * TanStack Query hooks around the browser-local game repository (ADR-0005).
 * Query state here covers saved-game resources only; live peer-to-peer game
 * state must never live in TanStack Query (plan engineering rule 8) — it is
 * owned by the party engines (packages/core) and the shell.
 */

/** Query key for the full saved-game list. */
export const gamesQueryKey = ["games"] as const;

/** Query key for one saved game. */
export const gameQueryKey = (id: string) => ["games", id] as const;

/** All saved games, most recently updated first. */
export function useSavedGames() {
  return useQuery({
    queryKey: gamesQueryKey,
    queryFn: () => gameRepository.list(),
  });
}

/** One saved game by id (U4 editor, U6 test arena, P3 distribution). */
export function useSavedGame(id: string) {
  return useQuery({
    queryKey: gameQueryKey(id),
    queryFn: () => gameRepository.read(id),
    enabled: id.length > 0,
  });
}

/** Create a game and refresh the list cache. */
export function useCreateGame() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSavedGameInput) => gameRepository.create(input),
    onSuccess: (game) => {
      queryClient.setQueryData(gameQueryKey(game.id), game);
      void queryClient.invalidateQueries({ queryKey: gamesQueryKey });
    },
  });
}

/** Update a game (partial) and refresh the list + single-game caches. */
export function useUpdateGame() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSavedGameInput }) =>
      gameRepository.update(id, input),
    onSuccess: (game) => {
      queryClient.setQueryData(gameQueryKey(game.id), game);
      void queryClient.invalidateQueries({ queryKey: gamesQueryKey });
    },
  });
}

/** Delete a game (callers confirm first — U2 acceptance) and drop its cache. */
export function useDeleteGame() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => gameRepository.delete(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: gameQueryKey(id) });
      void queryClient.invalidateQueries({ queryKey: gamesQueryKey });
    },
  });
}

/** Duplicate a game; the copy shares the source (and hash) with a fresh id. */
export function useDuplicateGame() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input?: DuplicateSavedGameInput }) =>
      gameRepository.duplicate(id, input),
    onSuccess: (game) => {
      queryClient.setQueryData(gameQueryKey(game.id), game);
      void queryClient.invalidateQueries({ queryKey: gamesQueryKey });
    },
  });
}

/** Record the outcome of the latest test run (U6 test arena). */
export function useRecordTestResults() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, results }: { id: string; results: TestResultsInput }) =>
      gameRepository.recordTestResults(id, results),
    onSuccess: (game) => {
      queryClient.setQueryData(gameQueryKey(game.id), game);
      void queryClient.invalidateQueries({ queryKey: gamesQueryKey });
    },
  });
}
