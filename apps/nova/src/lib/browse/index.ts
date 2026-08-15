/**
 * Shared prebuilt-game browser model (rocketcrab-9fv.7.7.2 / 7.23): classic
 * external iframe games (lib/classic) and Nova's own prebuilt games
 * (lib/browse/nova-games) live together in one browse UI, distinguished by
 * "classic" / "nova" badges.
 */

import { Sparkles, type LucideIcon } from "lucide-react";
import { CLASSIC_GAMES, type ClassicGame } from "../classic";
import { NOVA_PREBUILT_GAMES, type NovaPrebuiltGame } from "./nova-games";

/** One entry in the prebuilt-game browser, normalized for listing. */
export type BrowseEntry =
  | {
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
    }
  | {
      kind: "nova";
      id: string;
      name: string;
      author: string;
      description: string;
      category: string[];
      players?: string;
      pictures?: string[];
      guideUrl?: string;
      mode: NovaPrebuiltGame["mode"];
      load: NovaPrebuiltGame["load"];
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

const novaEntries: BrowseEntry[] = NOVA_PREBUILT_GAMES.map((game) => ({
  kind: "nova",
  id: game.id,
  name: game.title,
  author: "Rocketcrab Nova",
  description: game.description,
  category: ["nova"],
  mode: game.mode,
  load: game.load,
}));

/** Every prebuilt game (classic + nova) for the browser. */
export const BROWSE_GAMES: readonly BrowseEntry[] = [...classicEntries, ...novaEntries];

/** Look up one prebuilt game by id; undefined when unknown. */
export function findBrowseGame(id: string): BrowseEntry | undefined {
  return BROWSE_GAMES.find((game) => game.id === id);
}

/** A classic-style category box in the browser (7.23). */
export interface BrowseCategory {
  id: string;
  label: string;
  /** Classic-style emoji icon; the Nova box carries a lucide icon instead. */
  emoji?: string;
  /** Lucide icon for boxes that don't use an emoji (e.g. Nova's sparkle). */
  icon?: LucideIcon;
  /** Classic data category matched by the box (or "nova" for Nova games). */
  match: string;
}

/**
 * Classic's category boxes (dev branch components/library): emoji + label,
 * 2-column grid, filtered list on selection. Nova has no play-history, so
 * classic's dynamic ✨ New / ⏱️ Recently played boxes are omitted; a Nova
 * box with the real crab/rocket SVG mark keeps Nova's own games alongside
 * classic's boxes.
 */
export const BROWSE_CATEGORIES: readonly BrowseCategory[] = [
  { id: "easy", label: "Very simple", emoji: "🟢", match: "easy" },
  { id: "medium", label: "Easy to explain", emoji: "🟡", match: "medium" },
  { id: "hard", label: "Know the rules first", emoji: "🛑", match: "hard" },
  { id: "drawing", label: "Drawing", emoji: "✏️", match: "drawing" },
  { id: "writing", label: "Writing", emoji: "✍️", match: "writing" },
  { id: "trivia", label: "Trivia", emoji: "❓", match: "trivia" },
  { id: "netgamesio", label: "netgames.io", emoji: "💎", match: "netgamesio" },
  { id: "nova", label: "Nova", icon: Sparkles, match: "nova" },
];

/** Count games per category box (used for the box subtitle). */
export function categoryCount(match: string, games: readonly BrowseEntry[]): number {
  return games.filter((game) => game.category.includes(match)).length;
}
