import type { SavedGame } from "@rocketcrab/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Search, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { BrandHeader } from "../layout/BrandHeader";
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
  /**
   * Custom "back" navigation at the browser's top level (category cards).
   * Parents that render the browser as a panel (party lobby / play shell)
   * pass this to close their panel; without it, compact browsers navigate
   * to /party and standalone ones to the homepage.
   */
  onBack?: () => void;
}

/** Which view the browser is showing: the player's own saved games or a
 * prebuilt category box. There is no "all games" box (2t1.1) — the category
 * cards are the entry point. */
type BrowseView = "mine" | BrowseCategory["id"];

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

/** One category card (2t1.1 redesign): a large icon tile + bold label + game
 * count, with a soft lift + primary glow on hover. Classic boxes keep their
 * emoji; the Nova box uses a lucide icon (the crab/rocket mark stays in the
 * brand header, not on a category tile). */
function CategoryCard({
  emoji,
  icon: Icon,
  label,
  count,
  onClick,
}: {
  emoji?: string;
  icon?: LucideIcon;
  label: string;
  count: number | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-start gap-3 rounded-box border-2 border-base-300 bg-base-100 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lg hover:shadow-primary/10 sm:p-5"
    >
      <span
        className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-base-300 bg-base-200 text-2xl transition-colors group-hover:border-primary/40 group-hover:bg-primary/5"
        aria-hidden="true"
      >
        {Icon !== undefined ? <Icon className="h-6 w-6 text-base-content" /> : <span>{emoji}</span>}
      </span>
      <span className="flex w-full flex-col gap-0.5">
        <span className="text-base font-black leading-tight sm:text-lg">{label}</span>
        <span className="text-xs font-semibold text-base-content/50">
          {count === null ? "…" : `${count} ${count === 1 ? "game" : "games"}`}
        </span>
      </span>
    </button>
  );
}

/**
 * The shared prebuilt-game browser (7.7.2 / 7.23 / 10.9 / 2t1.1): classic
 * external iframe games and Nova's own games live together, badged
 * classic/nova. "My games" (the player's own saved games) is a category
 * card like the other boxes, not a separate section.
 *
 * The game list is NOT shown by default: only the category cards render.
 * Opening a category (or searching) swaps to just the list — the category
 * buttons hide while it's open. The ONE unified "back" button (2t1.1)
 * returns to the category cards while a list is open, and leaves the
 * browser (lobby in a party, home otherwise) at the top level. Selecting a
 * game never sets it directly: in browse mode it ALWAYS opens the game's
 * details page (/game/$gameId — saved games included), where the party pick
 * happens (10.9).
 */
export function GameBrowser({ onPick, onPickSaved, compact = false, onBack }: GameBrowserProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<BrowseView | null>(null);
  const savedGamesQuery = useSavedGames();
  const savedGames = savedGamesQuery.data ?? [];

  const prebuiltGames = useMemo(() => {
    const inCategory =
      view === null || view === "mine"
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

  /** The one unified back button (2t1.1): while a list is open it returns
   * to the category cards; at the top level it leaves the browser. */
  const handleBack = () => {
    if (view !== null || query !== "") {
      backToCategories();
      return;
    }
    if (onBack !== undefined) {
      onBack();
      return;
    }
    void navigate({ to: compact ? "/party" : "/" });
  };

  return (
    <div className={cn("flex flex-col", compact ? "gap-4" : "gap-6")}>
      {/* 2t1.1: in a party the brand stays visible but small + faded so the
          game browser is the focus (the party shell header handles the
          full-size lobby chrome). Non-link: tapping it must not leave the
          party. */}
      {compact ? <BrandHeader size={20} dimmed noLink /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleBack}
          className={buttonStyles("outline", "md", "self-start")}
          title={compact ? "Back to lobby" : "Back to home"}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          back
        </button>
        <div className="relative min-w-0 flex-1 basis-56">
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
      </div>

      {/* Category cards: hidden while a category is open or the user is
          searching — the list takes over (10.9). */}
      {view === null && query === "" ? (
        <section
          aria-label="Categories"
          className={cn(
            "grid grid-cols-2 gap-3",
            compact ? "sm:grid-cols-4" : "sm:grid-cols-3 lg:grid-cols-4",
          )}
        >
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
              No games match{query !== "" ? ` “${query}”` : ""}.
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
          New game
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
