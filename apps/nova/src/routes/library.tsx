import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "../lib/toast";
import { ArrowLeft, Gamepad2, PlusCircle, Search } from "lucide-react";
import { gameMatchesQuery, type SavedGame } from "@rocketcrab/core";
import { GameCard } from "../components/games/GameCard";
import { BrandHeader } from "../components/layout/BrandHeader";
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

/** Local game library backed by IndexedDB. */
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
        onError: (error) => toast.danger(errorMessage(error)),
      },
    );
  };

  const handleDelete = () => {
    if (!pendingDelete) return;
    const game = pendingDelete;
    setPendingDelete(null);
    deleteGame.mutate(game.id, {
      onSuccess: () => toast.success(`Deleted “${game.title}”.`),
      onError: (error) => toast.danger(errorMessage(error)),
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <BrandHeader />

      {/* Same header as the games browser: title, then back + search. */}
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-black">My games</h1>
        <Link to="/build" className={buttonStyles("primary", "md")}>
          <PlusCircle className="h-4 w-4" aria-hidden="true" />
          New game
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className={buttonStyles("default", "md", undefined, true)}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Link>
        <div className="relative min-w-0 flex-1 basis-56">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-foreground/40"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your games…"
            aria-label="Search your games"
            className="input input--primary w-full pl-10"
          />
        </div>
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
          />
        ) : (
          <EmptyState
            icon={<Search />}
            title="No games match"
            description={`Nothing in your library matches “${query}”.`}
          />
        )
      ) : (
        <ul className="flex flex-col gap-3">
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
            <div className="button-row self-end">
              <Button variant="default" soft onClick={() => setPendingDelete(null)}>
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
