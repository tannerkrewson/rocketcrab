import { Link } from "@tanstack/react-router";
import { ArrowRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
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
   * Pick mode: prebuilt game cards (classic + nova) become "Select" buttons
   * calling this with the entry instead of linking to the game detail page.
   */
  onPick?: (entry: BrowseEntry) => void;
  /**
   * Pick mode: the player's saved games are listed above the prebuilt grid
   * and call this with the game id when selected.
   */
  onPickSaved?: (gameId: string) => void;
  /** Tighter vertical rhythm for embedded use (lobby / in-game panels). */
  compact?: boolean;
}

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
 * One browser card: a detail-page link in browse mode, or a pick button in
 * pick mode (7.43) with a "Select" affordance on the right.
 */
function GameCard({ game, onPick }: { game: BrowseEntry; onPick?: (entry: BrowseEntry) => void }) {
  const body = (
    <>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-black">{game.name}</span>
          <KindBadge kind={game.kind} />
          {game.connectBlocked ? (
            <span
              className="badge badge-warning badge-outline font-bold"
              title="The game's server blocks room creation from the browser (no CORS headers), so it may not start from Nova yet."
            >
              room creation blocked
            </span>
          ) : null}
        </span>
        <span className="text-sm font-medium text-base-content/50">by {game.author}</span>
      </span>
      {onPick !== undefined ? (
        <span className="badge badge-primary badge-lg shrink-0 font-black">Select</span>
      ) : (
        <ArrowRight
          className="h-5 w-5 shrink-0 text-base-content/40 transition-transform group-hover:translate-x-1 group-hover:text-primary"
          aria-hidden="true"
        />
      )}
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

/** The player's own saved Nova games, listed first in pick mode (7.43). */
function SavedGamesSection({ onPickSaved }: { onPickSaved: (gameId: string) => void }) {
  const gamesQuery = useSavedGames();
  return (
    <section aria-label="My games" className="flex flex-col gap-2">
      <p className="text-sm font-black uppercase tracking-widest text-base-content/60">My games</p>
      {gamesQuery.isLoading ? (
        <LoadingState label="Loading your games…" />
      ) : gamesQuery.isError ? (
        <ErrorPanel
          title="Couldn't load your games"
          message={
            gamesQuery.error instanceof Error ? gamesQuery.error.message : "Something went wrong."
          }
        />
      ) : (gamesQuery.data ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-box border-2 border-dashed border-base-300 bg-base-100 p-6 text-center">
          <p className="text-sm text-base-content/70">
            No saved games yet — create one in the editor first.
          </p>
          <Link to="/build" className={buttonStyles("primary", "md")}>
            Build a game
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {(gamesQuery.data ?? []).map((game) => (
            <li key={game.id}>
              <button
                type="button"
                onClick={() => onPickSaved(game.id)}
                className="flex w-full items-center justify-between gap-2 rounded-box border border-base-300 bg-base-100 px-3 py-2 text-left hover:border-primary"
              >
                <span className="min-w-0 flex-1 truncate font-bold">{game.title}</span>
                <span className="badge badge-info badge-outline font-bold">
                  {game.mode ?? "state"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The shared prebuilt-game browser (7.7.2 / 7.23): classic external iframe
 * games and Nova's own games live together, badged classic/nova, laid out
 * like classic rocketcrab's games page (search, 2-column category grid,
 * card list with bold name + grey "by author"). The /browse route renders
 * it as a page; the party lobby and the in-game players page render it in
 * pick mode (7.43) — cards become "Select" buttons, and the player's own
 * saved games are listed above the grid.
 */
export function GameBrowser({ onPick, onPickSaved, compact = false }: GameBrowserProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<BrowseCategory | null>(null);

  const games = useMemo(() => {
    const inCategory =
      category === null
        ? BROWSE_GAMES
        : BROWSE_GAMES.filter((game) => game.category.includes(category.match));
    return inCategory.filter((game) => matchesQuery(game, query));
  }, [category, query]);

  return (
    <div className={cn("flex flex-col", compact ? "gap-4" : "gap-6")}>
      {onPickSaved !== undefined ? <SavedGamesSection onPickSaved={onPickSaved} /> : null}

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

      <section aria-label="Categories" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => setCategory(null)}
          aria-pressed={category === null}
          className={`flex flex-col gap-1 rounded-box border-2 bg-base-100 p-3 text-left ${
            category === null ? "border-primary" : "border-base-300 hover:border-primary/60"
          }`}
        >
          <span className="text-2xl" aria-hidden="true">
            🎲
          </span>
          <span className="font-black">All games</span>
          <span className="text-xs font-semibold text-base-content/50">{BROWSE_GAMES.length}</span>
        </button>
        {BROWSE_CATEGORIES.map((box) => (
          <button
            key={box.id}
            type="button"
            onClick={() => setCategory(category?.id === box.id ? null : box)}
            aria-pressed={category?.id === box.id}
            className={`flex flex-col gap-1 rounded-box border-2 bg-base-100 p-3 text-left ${
              category?.id === box.id ? "border-primary" : "border-base-300 hover:border-primary/60"
            }`}
          >
            <span className="text-2xl" aria-hidden="true">
              {box.emoji}
            </span>
            <span className="font-black">{box.label}</span>
            <span className="text-xs font-semibold text-base-content/50">
              {categoryCount(box.match, BROWSE_GAMES)}
            </span>
          </button>
        ))}
      </section>

      <section aria-label="Games" className="flex flex-col gap-3">
        {games.length === 0 ? (
          <p className="rounded-box border-2 border-base-300 bg-base-100 p-6 text-center text-base-content/70">
            No games match {category !== null ? `“${category.label}”` : ""}
            {query !== "" ? ` and “${query}”` : ""}.
          </p>
        ) : (
          games.map((game) => <GameCard key={game.id} game={game} onPick={onPick} />)
        )}
      </section>
    </div>
  );
}
