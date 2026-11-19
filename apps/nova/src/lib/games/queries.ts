import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  isGameRepositoryError,
  type CreateSavedGameInput,
  type DuplicateSavedGameInput,
  type TestResultsInput,
  type UpdateSavedGameInput,
} from "@rocketcrab/core";
import { gameRepository } from "./instance";

/**
 * Browser-local saved-game queries (ADR-0005). Live peer state belongs to
 * the party engines and shell, never TanStack Query.
 *
 * Mutations invalidate the current tab's queries. Refetch-on-focus picks
 * up other tabs' IndexedDB edits without another subscription layer.
 */

export const gamesQueryKey = ["games"] as const;

export const gameQueryKey = (id: string) => ["games", id] as const;

/** All saved games, most recently updated first. */
export function useSavedGames() {
  return useQuery({
    queryKey: gamesQueryKey,
    queryFn: () => gameRepository.list(),
  });
}

export function useSavedGame(id: string) {
  return useQuery({
    queryKey: gameQueryKey(id),
    queryFn: () => gameRepository.read(id),
    enabled: id.length > 0,
    // A missing game (e.g. a friend's, shared in a party) won't appear by
    // retrying; answer at once so the page can fall back.
    retry: (failures, error) =>
      !(isGameRepositoryError(error) && error.code === "not_found") && failures < 3,
  });
}

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

/** Callers must confirm deletion before mutating the repository. */
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

/** Record the latest arena test-run outcome. */
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
