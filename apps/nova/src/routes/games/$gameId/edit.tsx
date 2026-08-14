import { createFileRoute } from "@tanstack/react-router";
import { EditorPage } from "../../../components/editor/EditorPage";
import { ErrorPanel } from "../../../components/ui/ErrorPanel";
import { LoadingState } from "../../../components/ui/LoadingState";
import { useSavedGame } from "../../../lib/games/queries";

export const Route = createFileRoute("/games/$gameId/edit")({
  component: EditGamePage,
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * The U4 editor for one saved game: load the stored source into the
 * CodeMirror editor, run/fix/save it, and never overwrite the saved version
 * with unsaved source.
 */
function EditGamePage() {
  const { gameId } = Route.useParams();
  const gameQuery = useSavedGame(gameId);

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
  return (
    <div className="flex flex-col gap-4">
      <EditorPage game={gameQuery.data} />
    </div>
  );
}
