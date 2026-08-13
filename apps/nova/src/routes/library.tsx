import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Gamepad2, PlusCircle, Search } from "lucide-react";
import { gameMatchesQuery, type SavedGame } from "@rocketcrab/core";
import { GameCard } from "../components/games/GameCard";
import { Button, buttonStyles } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorPanel } from "../components/ui/ErrorPanel";
import { LoadingState } from "../components/ui/LoadingState";
import { useDeleteGame, useDuplicateGame, useSavedGames } from "../lib/games/queries";

export const Route = createFileRoute("/library")({
  component: LibraryPage,
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * The local game library (ADR-0005): saved games are listed straight from
 * the browser's IndexedDB, searchable, and editable/tested/duplicated from
 * here. Deleting always asks for confirmation first.
 */
export function LibraryPage() {
  const gamesQuery = useSavedGames();
  const deleteGame = useDeleteGame();
  const duplicateGame = useDuplicateGame();
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<SavedGame | null>(null);

  const games = useMemo(
    () => (gamesQuery.data ?? []).filter((game) => gameMatchesQuery(game, query)),
    [gamesQuery.data, query],
  );

  const handleDuplicate = (id: string) => {
    duplicateGame.mutate(
      { id },
      {
        onSuccess: (game) => toast.success(`Duplicated as “${game.title}”.`),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  const handleDelete = () => {
    if (!pendingDelete) return;
    const game = pendingDelete;
    setPendingDelete(null);
    deleteGame.mutate(game.id, {
      onSuccess: () => toast.success(`Deleted “${game.title}”.`),
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black">My games</h1>
          <p className="text-base-content/70">
            Games are saved right in this browser. Nothing is uploaded.
          </p>
        </div>
        <Link to="/build" className={buttonStyles("primary", "lg")}>
          Build a game
        </Link>
      </header>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-base-content/40"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your games…"
          aria-label="Search your games"
          className="input input-bordered w-full pl-10"
        />
      </div>

      {gamesQuery.isPending ? (
        <LoadingState label="Loading your games…" />
      ) : gamesQuery.isError ? (
        <ErrorPanel
          title="Couldn't load your games"
          message={errorMessage(gamesQuery.error)}
          onRetry={() => void gamesQuery.refetch()}
        />
      ) : games.length === 0 ? (
        gamesQuery.data.length === 0 ? (
          <EmptyState
            icon={<Gamepad2 />}
            title="No saved games yet"
            description="Once you build or paste a game it will be listed here for testing, editing, and playing."
            action={
              <Link to="/build" className={buttonStyles("primary", "lg")}>
                <PlusCircle className="h-5 w-5" aria-hidden="true" />
                Build a game
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<Search />}
            title="No games match"
            description={`Nothing in your library matches “${query}”.`}
          />
        )
      ) : (
        <ul className="flex flex-col gap-4">
          {games.map((game) => (
            <li key={game.id}>
              <GameCard
                game={game}
                busy={deleteGame.isPending || duplicateGame.isPending}
                onDuplicate={() => handleDuplicate(game.id)}
                onDelete={() => setPendingDelete(game)}
              />
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this game?"
      >
        {pendingDelete ? (
          <div className="flex flex-col gap-4">
            <p>
              “{pendingDelete.title}” and its source will be removed from this browser. This can't
              be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPendingDelete(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleDelete} disabled={deleteGame.isPending}>
                {deleteGame.isPending ? "Deleting…" : "Delete game"}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
