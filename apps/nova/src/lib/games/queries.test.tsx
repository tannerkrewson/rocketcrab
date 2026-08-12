import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { gameRepository } from "./instance";
import {
  useCreateGame,
  useDeleteGame,
  useDuplicateGame,
  useRecordTestResults,
  useSavedGame,
  useSavedGames,
  useUpdateGame,
} from "./queries";

/**
 * TanStack Query hook tests over the real repository backed by
 * fake-indexeddb (ADR-0013 stack). Live peer-to-peer game state is out of
 * scope here by design (plan engineering rule 8); these hooks only manage
 * saved-game resources.
 */

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, queryClient };
}

beforeEach(async () => {
  await gameRepository.clear();
});

describe("saved-game query hooks", () => {
  it("lists saved games", async () => {
    const game = await gameRepository.create({ title: "Rockets", html: "<p>hi</p>" });
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useSavedGames(), { wrapper });
    expect(result.current.isPending).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((g) => g.id)).toEqual([game.id]);
  });

  it("reads one saved game by id", async () => {
    const game = await gameRepository.create({ title: "Solo", html: "<p>x</p>" });
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useSavedGame(game.id), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.title).toBe("Solo");
  });

  it("creates a game and refreshes the list cache", async () => {
    const { wrapper } = makeWrapper();
    const list = renderHook(() => useSavedGames(), { wrapper });
    await waitFor(() => expect(list.result.current.data).toEqual([]));

    const create = renderHook(() => useCreateGame(), { wrapper });
    act(() => create.result.current.mutate({ title: "New", html: "<p>x</p>" }));
    await waitFor(() => expect(create.result.current.isSuccess).toBe(true));

    const created = create.result.current.data;
    expect(created?.title).toBe("New");
    await waitFor(() => expect(list.result.current.data?.map((g) => g.title)).toEqual(["New"]));
  });

  it("updates a game and refreshes the single-game cache", async () => {
    const game = await gameRepository.create({ title: "Old", html: "<p>x</p>" });
    const { wrapper } = makeWrapper();
    const single = renderHook(() => useSavedGame(game.id), { wrapper });
    await waitFor(() => expect(single.result.current.data?.title).toBe("Old"));

    const update = renderHook(() => useUpdateGame(), { wrapper });
    act(() => update.result.current.mutate({ id: game.id, input: { title: "New" } }));
    await waitFor(() => expect(update.result.current.isSuccess).toBe(true));

    await waitFor(() => expect(single.result.current.data?.title).toBe("New"));
  });

  it("surfaces repository errors on failed mutations", async () => {
    const { wrapper } = makeWrapper();
    const update = renderHook(() => useUpdateGame(), { wrapper });

    act(() => update.result.current.mutate({ id: "game_missing", input: { title: "x" } }));
    await waitFor(() => expect(update.result.current.isError).toBe(true));
    expect(update.result.current.error).toBeInstanceOf(Error);
  });

  it("deletes a game and drops it from the list cache", async () => {
    const game = await gameRepository.create({ title: "Doomed", html: "<p>x</p>" });
    const { wrapper } = makeWrapper();
    const list = renderHook(() => useSavedGames(), { wrapper });
    await waitFor(() => expect(list.result.current.data?.length).toBe(1));

    const remove = renderHook(() => useDeleteGame(), { wrapper });
    act(() => remove.result.current.mutate(game.id));
    await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));

    await waitFor(() => expect(list.result.current.data).toEqual([]));
  });

  it("duplicates a game and refreshes the list cache", async () => {
    const game = await gameRepository.create({ title: "Rockets", html: "<p>x</p>" });
    const { wrapper } = makeWrapper();
    const list = renderHook(() => useSavedGames(), { wrapper });
    await waitFor(() => expect(list.result.current.data?.length).toBe(1));

    const duplicate = renderHook(() => useDuplicateGame(), { wrapper });
    act(() => duplicate.result.current.mutate({ id: game.id }));
    await waitFor(() => expect(duplicate.result.current.isSuccess).toBe(true));

    expect(duplicate.result.current.data?.title).toBe("Rockets (copy)");
    await waitFor(() => expect(list.result.current.data?.length).toBe(2));
  });

  it("records test results and refreshes the single-game cache", async () => {
    const game = await gameRepository.create({ title: "T", html: "<p>x</p>" });
    const { wrapper } = makeWrapper();
    const single = renderHook(() => useSavedGame(game.id), { wrapper });
    await waitFor(() => expect(single.result.current.data?.lastTestedAt).toBeUndefined());

    const record = renderHook(() => useRecordTestResults(), { wrapper });
    act(() =>
      record.result.current.mutate({
        id: game.id,
        results: { lastTestedAt: 42, lastTestSucceeded: true },
      }),
    );
    await waitFor(() => expect(record.result.current.isSuccess).toBe(true));

    await waitFor(() => expect(single.result.current.data?.lastTestSucceeded).toBe(true));
    expect(single.result.current.data?.lastTestedAt).toBe(42);
  });
});
