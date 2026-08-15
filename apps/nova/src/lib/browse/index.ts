/**
 * Shared prebuilt-game browser model (rocketcrab-9fv.7.7.2 / 7.23): the
 * classic external iframe games (lib/classic) live in one browse UI.
 * Nova's shipped example games were removed from the browser (5cl.10) —
 * Nova's own games are the user's saved games (My games → /library), so
 * every prebuilt entry here is a classic external iframe game.
 */

import { CLASSIC_GAMES, type ClassicGame } from "../classic";

/** One entry in the prebuilt-game browser, normalized for listing. */
export type BrowseEntry = {
  kind: "classic";
  id: string;
  name: string;
  author: string;
  description: string;
  category: string[];
  players?: string;
  pictures?: string[];
  guideUrl?: string;
  displayUrlHref?: string;
  displayUrlText?: string;
  donationUrlHref?: string;
  donationUrlText?: string;
  basedOnName?: string;
};

const classicEntries: BrowseEntry[] = CLASSIC_GAMES.map((game: ClassicGame) => ({
  kind: "classic",
  id: game.id,
  name: game.name,
  author: game.author,
  description: game.description,
  category: game.category,
  players: game.players,
  pictures: game.pictures,
  guideUrl: game.guideUrl,
  displayUrlHref: game.displayUrlHref,
  displayUrlText: game.displayUrlText,
  donationUrlHref: game.donationUrlHref,
  donationUrlText: game.donationUrlText,
  basedOnName: game.basedOn?.game,
}));

/** Every prebuilt game (all classic) for the browser. */
export const BROWSE_GAMES: readonly BrowseEntry[] = classicEntries;

/** Look up one prebuilt game by id; undefined when unknown. */
export function findBrowseGame(id: string): BrowseEntry | undefined {
  return BROWSE_GAMES.find((game) => game.id === id);
}

/** A classic-style category box in the browser (7.23). */
export interface BrowseCategory {
  id: string;
  label: string;
  /** Classic-style emoji icon for the box tile. */
  emoji?: string;
  /** Classic data category matched by the box. */
  match: string;
}

/**
 * Classic's category boxes (dev branch components/library): emoji + label,
 * 2-column grid, filtered list on selection. Nova has no play-history, so
 * classic's dynamic ✨ New / ⏱️ Recently played boxes are omitted.
 */
export const BROWSE_CATEGORIES: readonly BrowseCategory[] = [
  { id: "easy", label: "Very simple", emoji: "🟢", match: "easy" },
  { id: "medium", label: "Easy to explain", emoji: "🟡", match: "medium" },
  { id: "hard", label: "Know the rules first", emoji: "🛑", match: "hard" },
  { id: "drawing", label: "Drawing", emoji: "✏️", match: "drawing" },
  { id: "writing", label: "Writing", emoji: "✍️", match: "writing" },
  { id: "trivia", label: "Trivia", emoji: "❓", match: "trivia" },
  { id: "netgamesio", label: "netgames.io", emoji: "💎", match: "netgamesio" },
];

/** Count games per category box (used for the box subtitle). */
export function categoryCount(match: string, games: readonly BrowseEntry[]): number {
  return games.filter((game) => game.category.includes(match)).length;
}
