import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { SharedPartyGame } from "../../lib/party/engine";
import { usePartyEngine } from "../../lib/party/use-party";
import { gamesQueryKey, useSavedGames } from "../../lib/games/queries";
import { saveSharedGame, sharedGameStatus } from "../../lib/games/shared-copies";
import { toast } from "../../lib/toast";
import { Button, buttonStyles } from "../ui/Button";

/**
 * Save a friend's game to My games, or update an older saved copy.
 * Renders nothing for the player's own game.
 *
 * `size` matches the surrounding buttons; `showHint` adds one line under
 * the button explaining updates.
 */
export function SaveSharedGame({
  game,
  size = "md",
  showHint = true,
}: {
  game: SharedPartyGame;
  size?: "md" | "lg";
  showHint?: boolean;
}) {
  const { engine } = usePartyEngine();
  const queryClient = useQueryClient();
  const gamesQuery = useSavedGames();
  const [saving, setSaving] = useState(false);
  // The owner can choose not to let players keep copies.
  if (gamesQuery.data === undefined || game.sharedBySelf || !game.saveable) return null;
  const status = sharedGameStatus(gamesQuery.data, game);
  if (status.kind === "own") return null;

  if (status.kind === "saved") {
    return (
      <Link
        to="/game/$gameId"
        params={{ gameId: status.game.id }}
        className={buttonStyles("default", size, undefined, true)}
        title="Open your saved copy"
      >
        <Check className="h-4 w-4 text-success" aria-hidden="true" />
        In My games
      </Link>
    );
  }

  const save = async () => {
    const source = engine.sharedGameSource(game.gameId);
    if (source === undefined || source.sourceSha256 !== game.sourceSha256) {
      toast.danger("This game isn't on your device yet. Wait for it to arrive, then try again.");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveSharedGame(source, status);
      await queryClient.invalidateQueries({ queryKey: gamesQueryKey });
      toast.success(
        status.kind === "update"
          ? `Updated “${saved.title}” in My games.`
          : `Saved “${saved.title}” to My games.`,
      );
    } catch {
      toast.danger("Couldn't save the game. Your browser storage may be full.");
    } finally {
      setSaving(false);
    }
  };

  const from = game.sharedBy ?? "the host";
  let label = "Save to My games";
  let hint: string | null = null;
  if (status.kind === "update") {
    label = "Update my copy";
    hint = `${from} changed this game since you saved it.`;
  } else if (status.kind === "edited") {
    label = "Save their version";
    hint = `You changed your copy, so this saves ${from}'s version separately.`;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        variant="default"
        soft
        size={size}
        className="w-full"
        onClick={() => void save()}
        disabled={saving}
      >
        {status.kind === "update" ? (
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4" aria-hidden="true" />
        )}
        {saving ? "Saving…" : label}
      </Button>
      {showHint && hint !== null ? (
        <p className="max-w-xs text-center text-xs text-foreground/60">{hint}</p>
      ) : null}
    </div>
  );
}
