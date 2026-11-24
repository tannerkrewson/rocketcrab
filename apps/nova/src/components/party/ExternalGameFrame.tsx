import { useState } from "react";
import { externalFrameUrl, findExternalGame, type ExternalRoom } from "../../lib/catalog";

export interface ExternalGameFrameProps {
  readonly gameId: string;
  readonly title: string;
  readonly room: ExternalRoom;
  readonly displayName: string;
  /** True for the member who created the room. */
  readonly isHost: boolean;
}

/**
 * One external game's iframe. The URL is built once, when the frame
 * mounts: the parent remounts it (by key) for a new room or a reload, so
 * renaming yourself mid-game never reloads the game.
 */
export function ExternalGameFrame({
  gameId,
  title,
  room,
  displayName,
  isHost,
}: ExternalGameFrameProps) {
  const [frame] = useState(() => {
    const game = findExternalGame(gameId);
    if (game === undefined) return { error: "This game isn't available in this version." };
    try {
      return { src: externalFrameUrl(game, room, { name: displayName, isHost }) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "The game room is invalid." };
    }
  });
  if ("error" in frame) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm font-semibold text-foreground/60">
        {frame.error}
      </div>
    );
  }
  return (
    <iframe
      title={title}
      src={frame.src}
      className="h-full w-full border-0"
      referrerPolicy="no-referrer"
    />
  );
}
