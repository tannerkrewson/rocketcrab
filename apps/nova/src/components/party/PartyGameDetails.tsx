import type { GameMode } from "@rocketcrab/protocol";
import { BookOpen, X } from "lucide-react";
import { findBrowseGame } from "../../lib/browse";
import { NOVA_MODE_LABELS } from "../../lib/browse/nova-games";
import { useSavedGame } from "../../lib/games/queries";
import { Button } from "../ui/Button";
import { LoadingState } from "../ui/LoadingState";

export interface PartyGameDetailsModalProps {
  /** The game currently selected for the party (saved or prebuilt). */
  readonly game: { gameId: string; title: string; mode: GameMode } | null;
  readonly onClose: () => void;
}

/**
 * In-lobby game-details overlay (10.6): "What is GameName?" shows the
 * selected game's metadata — title, description, mode, and any how-to-play
 * guide — without leaving the party. Saved games come from the IndexedDB
 * repository; prebuilt games from the shared browse model (BrowseEntry).
 *
 * The overlay lives inside PartyLobby, so when the game starts the phase
 * flips to playing, the lobby unmounts, and the overlay closes with it —
 * it can never block the start transition.
 */
export function PartyGameDetailsModal({ game, onClose }: PartyGameDetailsModalProps) {
  if (game === null) {
    return null;
  }
  const prebuilt = findBrowseGame(game.gameId);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`About ${game.title}`}
    >
      <div className="flex max-h-[80vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-box border-2 border-base-300 bg-base-100 p-5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-xl font-black">{game.title}</h2>
          <Button
            variant="neutral"
            soft
            size="md"
            onClick={onClose}
            aria-label="Close game details"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        {prebuilt !== undefined ? (
          <PrebuiltDetails game={prebuilt} />
        ) : (
          <SavedGameDetails gameId={game.gameId} />
        )}
      </div>
    </div>
  );
}

function PrebuiltDetails({ game }: { game: NonNullable<ReturnType<typeof findBrowseGame>> }) {
  return (
    <div className="flex flex-col gap-3">
      {game.category.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {game.category.map((category) => (
            <span key={category} className="badge badge-ghost badge-sm font-bold">
              {category}
            </span>
          ))}
        </div>
      ) : null}
      <p className="whitespace-pre-line text-sm text-base-content/80">{game.description}</p>
      {game.players !== undefined ? (
        <p className="text-sm font-semibold text-base-content/60">{game.players} players</p>
      ) : null}
      {game.guideUrl !== undefined ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-black">How to play</p>
          <a
            href={game.guideUrl}
            target="_blank"
            rel="noreferrer"
            className="link inline-flex items-center gap-1 text-sm"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            Read the official guide
          </a>
        </div>
      ) : null}
    </div>
  );
}

function SavedGameDetails({ gameId }: { gameId: string }) {
  const savedQuery = useSavedGame(gameId);
  if (savedQuery.isLoading) {
    return <LoadingState label="Loading game details…" />;
  }
  const saved = savedQuery.data;
  if (savedQuery.isError || saved === undefined) {
    return (
      <p className="text-sm text-base-content/70">
        Couldn't load this game's details from this browser's saved games.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-base-content/60">
        {NOVA_MODE_LABELS[saved.mode ?? "state"]}
      </p>
      <p className="whitespace-pre-line text-sm text-base-content/80">
        {saved.description ?? "No description yet — open it in the editor to learn more."}
      </p>
    </div>
  );
}
