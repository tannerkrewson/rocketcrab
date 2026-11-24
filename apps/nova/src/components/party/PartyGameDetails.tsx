import { Badge } from "../ui/Badge";
import { BookOpen, X } from "lucide-react";
import {
  categoriesOf,
  findCatalogGame,
  playerCountText,
  type CatalogGame,
} from "../../lib/catalog";
import { useSavedGame } from "../../lib/games/queries";
import { usePartyEngine } from "../../lib/party/use-party";
import { SaveSharedGame } from "./SaveSharedGame";
import { Button } from "../ui/Button";
import { LoadingState } from "../ui/LoadingState";

export interface PartyGameDetailsModalProps {
  /** The game currently selected for the party (saved or prebuilt). */
  readonly game: { gameId: string; title: string } | null;
  readonly onClose: () => void;
}

/**
 * In-game details overlay: "About this game" shows the selected game's
 * metadata — title, description, and any how-to-play guide — without
 * leaving the party. Saved games come from the IndexedDB repository;
 * listed games from the catalog.
 *
 * The overlay lives inside PartyPlayShell, so the running game stays mounted
 * underneath it and the emergency controls remain outside the game frame.
 */
export function PartyGameDetailsModal({ game, onClose }: PartyGameDetailsModalProps) {
  if (game === null) {
    return null;
  }
  const prebuilt = findCatalogGame(game.gameId);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`About ${game.title}`}
    >
      <div className="flex max-h-[80vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-2xl bg-overlay p-5 shadow-overlay">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-xl font-black">{game.title}</h2>
          <Button
            variant="default"
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

function PrebuiltDetails({ game }: { game: CatalogGame }) {
  const categories = categoriesOf(game);
  const players = playerCountText(game);
  return (
    <div className="flex flex-col gap-3">
      {categories.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {categories.map((category) => (
            <Badge key={category.id}>
              <span aria-hidden="true">{category.emoji}</span> {category.label}
            </Badge>
          ))}
        </div>
      ) : null}
      <p className="whitespace-pre-line text-sm text-foreground/80">{game.description}</p>
      {players !== undefined ? (
        <p className="text-sm font-semibold text-foreground/60">{players} players</p>
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
  const { state } = usePartyEngine();
  if (savedQuery.isLoading) {
    return <LoadingState label="Loading game details…" />;
  }
  const saved = savedQuery.data;
  if (savedQuery.isError || saved === undefined) {
    // Someone else's game: everyone in the party received it.
    const shared = state.sharedGames.find((game) => game.gameId === gameId);
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-foreground/80">
          {shared?.sharedBy ?? "A friend"} shared this game in the party. Save it to keep it in My
          games.
        </p>
        {shared !== undefined ? <SaveSharedGame game={shared} /> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <Badge className="theme-nova self-start" color="accent">
        Made with Nova
      </Badge>
      {saved.description ? (
        <p className="whitespace-pre-line text-sm text-foreground/80">{saved.description}</p>
      ) : null}
    </div>
  );
}
