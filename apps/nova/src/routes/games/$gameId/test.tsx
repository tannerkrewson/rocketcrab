import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArenaPage } from "../../../components/arena/ArenaPage";
import { ErrorPanel } from "../../../components/ui/ErrorPanel";
import { LoadingState } from "../../../components/ui/LoadingState";
import { takeArenaSource } from "../../../lib/arena/draft-source";
import { useSavedGame } from "../../../lib/games/queries";

export const Route = createFileRoute("/games/$gameId/test")({
  component: TestGamePage,
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * The U6 multi-player test arena for one saved game. When the editor's
 * Test-multiplayer action handed us the current (possibly unsaved) editor
 * source, the arena tests that; otherwise it tests the saved source.
 */
function TestGamePage() {
  const { gameId } = Route.useParams();
  const gameQuery = useSavedGame(gameId);
  const overrideSource = useMemo(() => takeArenaSource(gameId), [gameId]);

  if (gameQuery.isPending) {
    return <LoadingState label="Loading game…" />;
  }
  if (gameQuery.isError) {
    return (
      <ErrorPanel
        title="Couldn't load this game"
        message={errorMessage(gameQuery.error)}
        onRetry={() => void gameQuery.refetch()}
      />
    );
  }
  return <ArenaPage game={gameQuery.data} overrideSource={overrideSource ?? undefined} />;
}
