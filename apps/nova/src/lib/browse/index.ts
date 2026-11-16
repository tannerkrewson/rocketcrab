/** Shared listing model for classic external iframe games. */

import { CLASSIC_GAMES, type ClassicGame } from "../classic";

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

export const BROWSE_GAMES: readonly BrowseEntry[] = classicEntries;

export function findBrowseGame(id: string): BrowseEntry | undefined {
  return BROWSE_GAMES.find((game) => game.id === id);
}

export interface BrowseCategory {
  id: string;
  label: string;
  emoji?: string;
  match: string;
}

/** Categories omit play-history-based groups because Nova keeps no play history. */
export const BROWSE_CATEGORIES: readonly BrowseCategory[] = [
  { id: "easy", label: "Very simple", emoji: "🟢", match: "easy" },
  { id: "medium", label: "Easy to explain", emoji: "🟡", match: "medium" },
  { id: "hard", label: "Know the rules first", emoji: "🛑", match: "hard" },
  { id: "drawing", label: "Drawing", emoji: "✏️", match: "drawing" },
  { id: "writing", label: "Writing", emoji: "✍️", match: "writing" },
  { id: "trivia", label: "Trivia", emoji: "❓", match: "trivia" },
  { id: "netgamesio", label: "netgames.io", emoji: "💎", match: "netgamesio" },
];

export function categoryCount(match: string, games: readonly BrowseEntry[]): number {
  return games.filter((game) => game.category.includes(match)).length;
}
