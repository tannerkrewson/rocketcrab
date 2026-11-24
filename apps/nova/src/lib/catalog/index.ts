/** The built-in game list: external games plus hosted Nova games. */
import { EXTERNAL_GAMES } from "./external-games";
import { NOVA_GAMES } from "./nova-games";
import type { CatalogGame, ExternalCatalogGame, GameListing } from "./types";
import { formatPlayerRange } from "../party/player-limits";

export type * from "./types";
export { joinRoomUrl, randomRoomId, rocketcrabUrl, roomField } from "./join-url";
export { EXTERNAL_GAMES } from "./external-games";
export { NOVA_GAMES } from "./nova-games";

export const CATALOG_GAMES: readonly CatalogGame[] = [...EXTERNAL_GAMES, ...NOVA_GAMES];

export function findCatalogGame(id: string): CatalogGame | undefined {
  return CATALOG_GAMES.find((game) => game.id === id);
}

export function findExternalGame(id: string): ExternalCatalogGame | undefined {
  return EXTERNAL_GAMES.find((game) => game.id === id);
}

/** Unique iframe origins across all external games (CSP frame-src allowlist). */
export const EXTERNAL_FRAME_ORIGINS: readonly string[] = [
  ...new Set(EXTERNAL_GAMES.flatMap((game) => game.play.frameOrigins)),
];

/**
 * Origins the main origin fetches for listed games (CSP connect-src):
 * external games' direct room creation and hosted Nova games' HTML.
 */
export const CATALOG_CONNECT_ORIGINS: readonly string[] = [
  ...new Set([
    ...EXTERNAL_GAMES.flatMap((game) => game.play.connectOrigins ?? []),
    ...NOVA_GAMES.flatMap((game) =>
      /^https:\/\//.test(game.play.url) ? [new URL(game.play.url).origin] : [],
    ),
  ]),
];

/** Unique origins of listed games' screenshots (CSP img-src allowlist). */
export const CATALOG_IMAGE_ORIGINS: readonly string[] = [
  ...new Set(
    CATALOG_GAMES.flatMap((game) => (game.pictures ?? []).map((url) => new URL(url).origin)),
  ),
];

/** The website link text: the host name without "www." */
export function displayUrlText(game: Pick<GameListing, "displayUrlHref">): string | undefined {
  if (game.displayUrlHref === undefined) return undefined;
  return new URL(game.displayUrlHref).hostname.replace(/^www\./, "");
}

/** The player count to show: the entry's own text, or its limits. */
export function playerCountText(game: GameListing): string | undefined {
  return game.players ?? formatPlayerRange(game);
}

/**
 * The external frame URL for one player, checked against the game's frame
 * origins so a malformed room can never point a frame somewhere else.
 */
export function externalFrameUrl(
  game: ExternalCatalogGame,
  room: Parameters<ExternalCatalogGame["play"]["joinUrl"]>[0],
  player: Parameters<ExternalCatalogGame["play"]["joinUrl"]>[1],
): string {
  const url = game.play.joinUrl(room, player);
  if (!game.play.frameOrigins.includes(new URL(url).origin)) {
    throw new Error(`${game.name}'s room points outside the game's site.`);
  }
  return url;
}

export interface BrowseCategory {
  id: string;
  label: string;
  emoji?: string;
  matches(game: GameListing): boolean;
}

/** Categories omit play-history-based groups because Nova keeps no play history. */
export const BROWSE_CATEGORIES: readonly BrowseCategory[] = [
  { id: "easy", label: "Very simple", emoji: "🟢", matches: (g) => g.difficulty === "easy" },
  {
    id: "medium",
    label: "Easy to explain",
    emoji: "🟡",
    matches: (g) => g.difficulty === "medium",
  },
  {
    id: "hard",
    label: "Know the rules first",
    emoji: "🛑",
    matches: (g) => g.difficulty === "hard",
  },
  { id: "drawing", label: "Drawing", emoji: "✏️", matches: (g) => g.genres.includes("drawing") },
  { id: "writing", label: "Writing", emoji: "✍️", matches: (g) => g.genres.includes("writing") },
  { id: "trivia", label: "Trivia", emoji: "❓", matches: (g) => g.genres.includes("trivia") },
];

export function categoryCount(category: BrowseCategory, games: readonly GameListing[]): number {
  return games.filter((game) => category.matches(game)).length;
}

/** The categories a game belongs to, as the browser shows them. */
export function categoriesOf(game: GameListing): BrowseCategory[] {
  return BROWSE_CATEGORIES.filter((category) => category.matches(game));
}
