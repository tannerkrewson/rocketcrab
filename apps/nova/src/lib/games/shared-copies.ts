import type { SavedGame } from "@rocketcrab/core";
import type { SharedPartyGame, SharedPartyGameSource } from "../party/engine";
import { gameRepository } from "./instance";

/**
 * How a game shared in a party relates to this player's saved games.
 *
 * - `own`: it is one of their games (same id).
 * - `saved`: they already have exactly this version (same source hash).
 * - `update`: they saved an older version and never edited it; it can be
 *   replaced in place.
 * - `edited`: they saved an older version and changed it; theirs is never
 *   overwritten, so the new version is saved as another copy.
 * - `new`: they don't have it.
 */
export type SharedGameStatus =
  | { kind: "own"; game: SavedGame }
  | { kind: "saved"; game: SavedGame }
  | { kind: "update"; game: SavedGame }
  | { kind: "edited"; game: SavedGame }
  | { kind: "new" };

export function sharedGameStatus(
  games: readonly SavedGame[],
  shared: Pick<SharedPartyGame, "gameId" | "sourceSha256">,
): SharedGameStatus {
  const own = games.find((game) => game.id === shared.gameId);
  if (own !== undefined) return { kind: "own", game: own };
  const same = games.find((game) => game.sourceHash === shared.sourceSha256);
  if (same !== undefined) return { kind: "saved", game: same };
  const copies = games.filter((game) => game.copiedFrom?.gameId === shared.gameId);
  const unedited = copies.find((game) => game.sourceHash === game.copiedFrom?.sourceHash);
  if (unedited !== undefined) return { kind: "update", game: unedited };
  const edited = copies[0];
  if (edited !== undefined) return { kind: "edited", game: edited };
  return { kind: "new" };
}

/**
 * Save a shared game for this player: update an unedited older copy in
 * place, otherwise create a new game (never overwriting their edits).
 */
export async function saveSharedGame(
  shared: SharedPartyGameSource,
  status: SharedGameStatus,
): Promise<SavedGame> {
  const copiedFrom = {
    gameId: shared.gameId,
    sourceHash: shared.sourceSha256,
    ...(shared.sharedBy !== null ? { sharedBy: shared.sharedBy } : {}),
  };
  const fields = {
    title: shared.title,
    html: shared.source,
    ...(shared.apiVersion !== undefined ? { apiVersion: shared.apiVersion } : {}),
    copiedFrom,
  };
  if (status.kind === "update") {
    return gameRepository.update(status.game.id, fields);
  }
  return gameRepository.create(fields);
}
