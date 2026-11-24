import { Badge } from "../ui/Badge";
import { useState } from "react";
import { BookOpen, Gamepad2 } from "lucide-react";
import {
  categoriesOf,
  findCatalogGame,
  playerCountText,
  type CatalogGame,
} from "../../lib/catalog";
import { useSavedGame } from "../../lib/games/queries";
import { usePartyEngine } from "../../lib/party/use-party";
import { ScreenshotCarousel } from "../games/ScreenshotCarousel";
import { SaveSharedGame } from "./SaveSharedGame";
import { Button } from "../ui/Button";
import { LoadingState } from "../ui/LoadingState";
import { Dialog } from "../ui/Dialog";
import { toast } from "../../lib/toast";
import { errorMessage } from "../../lib/party/engine-utils";

export interface PartyGameDetailsModalProps {
  /** The game currently selected for the party (saved or prebuilt). */
  readonly game: { gameId: string; title: string } | null;
  readonly onClose: () => void;
  readonly onSwitch?: () => Promise<void>;
}

/** Game info stays over the play shell so browsing never unmounts the frame. */
export function PartyGameDetailsModal({ game, onClose, onSwitch }: PartyGameDetailsModalProps) {
  const [confirming, setConfirming] = useState(false);
  const [switching, setSwitching] = useState(false);
  if (game === null) return null;
  const prebuilt = findCatalogGame(game.gameId);

  const confirmSwitch = async () => {
    if (onSwitch === undefined || switching) return;
    setSwitching(true);
    try {
      await onSwitch();
    } catch (error) {
      toast.danger(`Couldn't switch games: ${errorMessage(error)}`);
      setSwitching(false);
    }
  };

  return (
    <Dialog
      open
      title={confirming ? `Switch to ${game.title}?` : `About ${game.title}`}
      onClose={() => {
        if (switching) return;
        if (confirming) setConfirming(false);
        else onClose();
      }}
      className="sm:max-w-lg"
    >
      {confirming ? (
        <div className="flex flex-col gap-4">
          <p>This ends the current game for everyone and starts {game.title}.</p>
          <div className="button-row self-end">
            <Button variant="tertiary" disabled={switching} onPress={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={switching} onPress={() => void confirmSwitch()}>
              {switching ? "Switching games…" : "Switch game"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {prebuilt !== undefined ? (
            <PrebuiltDetails game={prebuilt} />
          ) : (
            <SavedGameDetails gameId={game.gameId} />
          )}
          {onSwitch !== undefined ? (
            <Button variant="primary" className="self-end" onPress={() => setConfirming(true)}>
              <Gamepad2 className="size-4" aria-hidden="true" />
              Switch game
            </Button>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

function PrebuiltDetails({ game }: { game: CatalogGame }) {
  const categories = categoriesOf(game);
  const players = playerCountText(game);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground/60">by {game.author}</p>
      {categories.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {categories.map((category) => (
            <Badge key={category.id}>
              <span aria-hidden="true">{category.emoji}</span> {category.label}
            </Badge>
          ))}
        </div>
      ) : null}
      {game.pictures && game.pictures.length > 0 ? (
        <ScreenshotCarousel images={game.pictures} gameName={game.name} />
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
