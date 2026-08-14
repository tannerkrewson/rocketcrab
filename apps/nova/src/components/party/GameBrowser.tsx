import type { SavedGame } from "@rocketcrab/core";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { BrandLogo } from "../layout/BrandLogo";
import { buttonStyles } from "../ui/Button";
import { ErrorPanel } from "../ui/ErrorPanel";
import { LoadingState } from "../ui/LoadingState";
import {
  BROWSE_CATEGORIES,
  BROWSE_GAMES,
  categoryCount,
  type BrowseCategory,
  type BrowseEntry,
} from "../../lib/browse";
import { useSavedGames } from "../../lib/games/queries";

export interface GameBrowserProps {
  /**
   * Pick mode: prebuilt game cards (classic + nova) become pick buttons
   * calling this with the entry instead of linking to the game detail page
   * (used by the in-game players panel).
   */
  onPick?: (entry: BrowseEntry) => void;
  /**
   * Pick mode: clicking a saved game in the "My games" category calls this
   * with the game id instead of linking to the game detail page.
   */
  onPickSaved?: (gameId: string) => void;
  /** Tighter vertical rhythm for embedded use (lobby / in-game panels). */
  compact?: boolean;
}

/**
 * Which view the browser is showing: a category (prebuilt "all" or a
 * specific box), the player's own saved games ("mine"), or no list at all.
 */
type BrowseView = "all" | "mine" | BrowseCategory["id"];

/** Badge text/color per game kind (7.42): classic = red, nova = blue. */
function KindBadge({ kind }: { kind: BrowseEntry["kind"] }) {
  if (kind === "classic") {
    return (
      <span
        className="badge badge-error badge-outline font-bold"
        title="External iframe game from classic Rocketcrab"
      >
        classic
      </span>
    );
  }
  return (
    <span className="badge badge-info badge-outline font-bold" title="A game built on the Nova API">
      nova
    </span>
  );
}

function matchesQuery(game: BrowseEntry, query: string): boolean {
  if (query === "") return true;
  const haystack = `${game.name} ${game.author} ${game.description}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

/**
 * One prebuilt-game card (10.9): a detail-page link in browse mode, or a
 * pick button in pick mode — always with an arrow affordance on the right
 * (the old "Select" badge is gone).
 */
function GameCard({ game, onPick }: { game: BrowseEntry; onPick?: (entry: BrowseEntry) => void }) {
  const body = (
    <>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-black">{game.name}</span>
          <KindBadge kind={game.kind} />
        </span>
        <span className="text-sm font-medium text-base-content/50">by {game.author}</span>
      </span>
      <ArrowRight
        className="h-5 w-5 shrink-0 text-base-content/40 transition-transform group-hover:translate-x-1 group-hover:text-primary"
        aria-hidden="true"
      />
    </>
  );

  if (onPick !== undefined) {
    return (
      <button
        key={game.id}
        type="button"
        onClick={() => onPick(game)}
        className="group flex w-full items-center justify-between gap-3 rounded-box border-2 border-base-300 bg-base-100 px-4 py-3 text-left transition-colors hover:border-primary"
      >
        {body}
      </button>
    );
  }
  return (
    <Link
      key={game.id}
      to="/game/$gameId"
      params={{ gameId: game.id }}
      className="group flex items-center justify-between gap-3 rounded-box border-2 border-base-300 bg-base-100 px-4 py-3 transition-colors hover:border-primary"
    >
      {body}
    </Link>
  );
}

/** One saved-game row (10.9): links to the game detail page in browse mode. */
function SavedGameRow({
  game,
  onPickSaved,
}: {
  game: SavedGame;
  onPickSaved?: (gameId: string) => void;
}) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-black">{game.title}</span>
          <span className="badge badge-info badge-outline font-bold">{game.mode ?? "state"}</span>
        </span>
      </span>
      <ArrowRight
        className="h-5 w-5 shrink-0 text-base-content/40 transition-transform group-hover:translate-x-1 group-hover:text-primary"
        aria-hidden="true"
      />
    </>
  );

  if (onPickSaved !== undefined) {
    return (
      <button
        key={game.id}
        type="button"
        onClick={() => onPickSaved(game.id)}
        className="group flex w-full items-center justify-between gap-3 rounded-box border-2 border-base-300 bg-base-100 px-4 py-3 text-left transition-colors hover:border-primary"
      >
        {body}
      </button>
    );
  }
  return (
    <Link
      key={game.id}
      to="/game/$gameId"
      params={{ gameId: game.id }}
      className="group flex items-center justify-between gap-3 rounded-box border-2 border-base-300 bg-base-100 px-4 py-3 transition-colors hover:border-primary"
    >
      {body}
    </Link>
  );
}

/** One category card (10.9): emoji + label + count, like the classic boxes.
 * The Nova box swaps the emoji for the real crab/rocket SVG mark (11.2). */
function CategoryCard({
  emoji,
  icon,
  label,
  count,
  onClick,
}: {
  emoji?: string;
  icon?: "brand";
  label: string;
  count: number | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-1 rounded-box border-2 border-base-300 bg-base-100 p-3 text-left transition-colors hover:border-primary"
    >
      {icon === "brand" ? (
        <BrandLogo size={22} />
      ) : (
        <span className="text-2xl" aria-hidden="true">
          {emoji}
        </span>
      )}
      <span className="font-black">{label}</span>
      <span className="text-xs font-semibold text-base-content/50">{count ?? "…"}</span>
    </button>
  );
}

/**
 * The shared prebuilt-game browser (7.7.2 / 7.23 / 10.9): classic external
 * iframe games and Nova's own games live together, badged classic/nova,
 * laid out like classic rocketcrab's games page. "My games" (the player's
 * own saved games) is a button category card like the other boxes, not a
 * separate section.
 *
 * The game list is NOT shown by default: only the category cards render.
 * Opening a category (or searching) swaps to just the list — the category
 * buttons hide while it's open, and a small "All categories" back button
 * returns. Selecting a game never sets it directly: in browse mode it
 * ALWAYS opens the game's details page (/game/$gameId — saved games
 * included), where the party pick happens (10.9).
 */
export function GameBrowser({ onPick, onPickSaved, compact = false }: GameBrowserProps) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<BrowseView | null>(null);
  const savedGamesQuery = useSavedGames();
  const savedGames = savedGamesQuery.data ?? [];

  const prebuiltGames = useMemo(() => {
    const inCategory =
      view === null || view === "all" || view === "mine"
        ? BROWSE_GAMES
        : BROWSE_GAMES.filter((game) => game.category.includes(view));
    return inCategory.filter((game) => matchesQuery(game, query));
  }, [view, query]);

  const savedMatches = useMemo(() => {
    if (query === "") return savedGames;
    const needle = query.toLowerCase();
    return savedGames.filter((game) => game.title.toLowerCase().includes(needle));
  }, [savedGames, query]);

  const showingList = view !== null || query !== "";
  const savedCount = savedGamesQuery.isLoading ? null : savedGames.length;

  const backToCategories = () => {
    setView(null);
    setQuery("");
  };

  return (
    <div className={cn("flex flex-col", compact ? "gap-4" : "gap-6")}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-base-content/40"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search games…"
          aria-label="Search games"
          className="input input-bordered w-full pl-10"
        />
      </div>

      {/* Category cards: hidden while a category is open or the user is
          searching — the list takes over (10.9). */}
      {view === null && query === "" ? (
        <section aria-label="Categories" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <CategoryCard
            emoji="🎲"
            label="All games"
            count={BROWSE_GAMES.length}
            onClick={() => setView("all")}
          />
          <CategoryCard
            emoji="📦"
            label="My games"
            count={savedCount}
            onClick={() => setView("mine")}
          />
          {BROWSE_CATEGORIES.map((box) => (
            <CategoryCard
              key={box.id}
              emoji={box.emoji}
              icon={box.icon}
              label={box.label}
              count={categoryCount(box.match, BROWSE_GAMES)}
              onClick={() => setView(box.id)}
            />
          ))}
        </section>
      ) : null}

      {showingList ? (
        <section aria-label="Games" className="flex flex-col gap-3">
          {view !== null ? (
            <button
              type="button"
              className="btn btn-outline btn-sm w-fit"
              onClick={backToCategories}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              All categories
            </button>
          ) : null}
          {view === "mine" ? (
            <SavedGamesList
              query={query}
              isLoading={savedGamesQuery.isLoading}
              isError={savedGamesQuery.isError}
              errorMessage={
                savedGamesQuery.error instanceof Error
                  ? savedGamesQuery.error.message
                  : "Something went wrong."
              }
              games={savedMatches}
              onPickSaved={onPickSaved}
            />
          ) : prebuiltGames.length === 0 ? (
            <p className="rounded-box border-2 border-base-300 bg-base-100 p-6 text-center text-base-content/70">
              No games match {view !== null && view !== "all" ? "this category" : ""}
              {query !== "" ? ` “${query}”` : ""}.
            </p>
          ) : (
            prebuiltGames.map((game) => <GameCard key={game.id} game={game} onPick={onPick} />)
          )}
        </section>
      ) : null}
    </div>
  );
}

function SavedGamesList({
  query,
  isLoading,
  isError,
  errorMessage,
  games,
  onPickSaved,
}: {
  query: string;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string;
  games: readonly SavedGame[];
  onPickSaved?: (gameId: string) => void;
}) {
  if (isLoading) {
    return <LoadingState label="Loading your games…" />;
  }
  if (isError) {
    return <ErrorPanel title="Couldn't load your games" message={errorMessage} />;
  }
  if (games.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-box border-2 border-dashed border-base-300 bg-base-100 p-6 text-center">
        <p className="text-sm text-base-content/70">
          {query !== ""
            ? `No saved games match “${query}”.`
            : "No saved games yet — create one in the editor first."}
        </p>
        <Link to="/build" className={buttonStyles("primary", "md")}>
          Build a game
        </Link>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {games.map((game) => (
        <li key={game.id}>
          <SavedGameRow game={game} onPickSaved={onPickSaved} />
        </li>
      ))}
    </ul>
  );
}
