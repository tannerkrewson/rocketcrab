import type { SavedGame } from "@rocketcrab/core";
import { Badge } from "../ui/Badge";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { usePartyEngine } from "../../lib/party/use-party";
import { Button, buttonStyles } from "../ui/Button";
import { ErrorPanel } from "../ui/ErrorPanel";
import { LoadingState } from "../ui/LoadingState";
import {
  BROWSE_CATEGORIES,
  BROWSE_GAMES,
  categoryCount,
  type BrowseCategory,
  type BrowseEntry,
} from "../../lib/browse";
import {
  clearBrowseContext,
  readBrowseContext,
  saveBrowseContext,
} from "../../lib/browse/back-context";
import { useSavedGames } from "../../lib/games/queries";

export interface GameBrowserProps {
  /**
   * Pick mode: prebuilt game cards become pick buttons calling this with
   * the entry instead of linking to the game detail page (used by the
   * in-game players panel).
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
  /**
   * The view to open on mount (5cl.7): the standalone /browse route passes
   * the restored ?view= search param so the game details page's back button
   * returns to the same category. Without it the browser restores the last
   * browse position from sessionStorage (the in-lobby case, where the URL
   * can't carry it).
   */
  initialView?: string | null;
  /** The search query to open with on mount (paired with ?q=). */
  initialQuery?: string;
  /**
   * True when the browser is rendered inside a live party (the lobby's and
   * the in-game pick panels). Links that leave the party flow entirely —
   * the empty-state "New game" action — then ask for a "Leave the party?"
   * confirmation first and leave the party before navigating
   * (rocketcrab-8z9), so no ghost party keeps running behind the builder.
   */
  inParty?: boolean;
}

/** Which view the browser is showing: the player's own saved games or a
 * prebuilt category box. There is no "all games" box (2t1.1) — the category
 * cards are the entry point. */
type BrowseView = "mine" | BrowseCategory["id"];

function isBrowseView(value: string | null | undefined): value is BrowseView {
  return value === null || value === "mine" || BROWSE_CATEGORIES.some((box) => box.id === value);
}

/** The classic badge — every prebuilt game in the browser is classic
 * (5cl.10: Nova's example games were removed; the Nova badge is gone). */
function KindBadge() {
  return (
    <Badge color="danger" variant="secondary" title="External iframe game from classic Rocketcrab">
      classic
    </Badge>
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
 * (the old "Select" badge is gone). `onOpen` records the browser's current
 * position right before navigating (5cl.7), so the details page's back
 * button can return to the same category.
 */
function GameCard({
  game,
  onPick,
  onOpen,
  detailOrigin,
}: {
  game: BrowseEntry;
  onPick?: (entry: BrowseEntry) => void;
  onOpen?: () => void;
  detailOrigin?: "party-browse";
}) {
  const body = (
    <>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-black">{game.name}</span>
          <KindBadge />
        </span>
        <span className="text-sm font-medium text-foreground/50">by {game.author}</span>
      </span>
      <ArrowRight
        className="h-5 w-5 shrink-0 text-foreground/40 transition-transform group-hover:translate-x-1 group-hover:text-primary"
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
        className="group flex w-full items-center justify-between gap-3 rounded-2xl border-2 border-border bg-surface px-4 py-3 text-left transition-colors hover:border-primary"
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
      search={detailOrigin === undefined ? undefined : { from: detailOrigin }}
      onClick={onOpen}
      className="group flex items-center justify-between gap-3 rounded-2xl border-2 border-border bg-surface px-4 py-3 transition-colors hover:border-primary"
    >
      {body}
    </Link>
  );
}

/** One saved-game row (10.9): links to the shared game detail page. */
function SavedGameRow({
  game,
  onPickSaved,
  onOpen,
  detailOrigin,
}: {
  game: SavedGame;
  onPickSaved?: (gameId: string) => void;
  onOpen?: () => void;
  detailOrigin?: "party-browse";
}) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-black">{game.title}</span>
          <Badge color="accent" variant="secondary">
            {game.mode ?? "state"}
          </Badge>
        </span>
      </span>
      <ArrowRight
        className="h-5 w-5 shrink-0 text-foreground/40 transition-transform group-hover:translate-x-1 group-hover:text-primary"
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
        className="group flex w-full items-center justify-between gap-3 rounded-2xl border-2 border-border bg-surface px-4 py-3 text-left transition-colors hover:border-primary"
      >
        {body}
      </button>
    );
  }
  return (
    <div
      key={game.id}
      className="group flex items-center justify-between gap-2 rounded-2xl border-2 border-border bg-surface px-4 py-3 transition-colors hover:border-primary"
    >
      <Link
        to="/game/$gameId"
        params={{ gameId: game.id }}
        search={detailOrigin === undefined ? undefined : { from: detailOrigin }}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center justify-between gap-3"
      >
        {body}
      </Link>
    </div>
  );
}

/** One category card (2t1.1 redesign, tightened 1nm): the emoji sits
 * directly LEFT of the label + game count in a horizontal row — the large
 * icon box tile is gone, and the grid is always two columns. A soft lift +
 * primary glow on hover. Classic boxes keep their emoji. The standalone
 * "My games" box is a LINK to /library (5cl.12 — the library is the one
 * full-featured my-games page); in the lobby it stays a button that opens
 * the in-place saved list (leaving the party is wrong mid-party). */
function CategoryCard({
  emoji,
  label,
  count,
  onClick,
  href,
}: {
  emoji?: string;
  label: string;
  count: number | null;
  onClick?: () => void;
  /** When set, renders the card as a router link instead of a button. */
  href?: string;
}) {
  const classes =
    "group flex items-center gap-3 rounded-2xl border-2 border-border bg-surface p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lg hover:shadow-primary/10";
  const body = (
    <>
      <span className="shrink-0 text-2xl" aria-hidden="true">
        {emoji}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-base font-black leading-tight sm:text-lg">{label}</span>
        <span className="text-xs font-semibold text-foreground/50">
          {count === null ? "…" : `${count} ${count === 1 ? "game" : "games"}`}
        </span>
      </span>
    </>
  );
  if (href !== undefined) {
    return (
      <Link to={href} className={classes}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={classes}>
      {body}
    </button>
  );
}

/**
 * The shared prebuilt-game browser (7.7.2 / 7.23 / 10.9 / 2t1.1): classic
 * external iframe games, badged classic. "My games" (the player's own saved
 * games) is a category card: on the standalone /browse page it links to the
 * full-featured library page (5cl.12), and inside a party (compact) it
 * opens an in-place saved list — the host can't leave the party, so the
 * list keeps the shared details links.
 *
 * The game list is NOT shown by default: only the category cards render.
 * Opening a category (or searching) swaps to just the list — the category
 * buttons hide while it's open. The ONE unified "back" button (2t1.1)
 * returns to the category cards while a list is open, and leaves the
 * browser (lobby in a party, home otherwise) at the top level. Selecting a
 * game never sets it directly: in browse mode it ALWAYS opens the game's
 * details page (/game/$gameId — saved games included), where the party pick
 * happens (10.9). The browser records its position before that navigation
 * (5cl.7) and restores it on mount, so the details page's back button
 * returns to the same category — including when the lobby browser remounts.
 */
export function GameBrowser({
  onPick,
  onPickSaved,
  compact = false,
  onBack,
  initialView,
  initialQuery,
  inParty = false,
}: GameBrowserProps) {
  const navigate = useNavigate();
  // 8z9: used to leave the party when an exit link is confirmed.
  const { engine } = usePartyEngine();
  // 5cl.7: restore the last browse position — the standalone route's
  // ?view=/?q= search params win; otherwise the sessionStorage context (the
  // in-lobby case) is used.
  const stored = readBrowseContext();
  const [query, setQuery] = useState(initialQuery ?? stored?.query ?? "");
  const [view, setView] = useState<BrowseView | null>(() => {
    if (isBrowseView(initialView)) return initialView;
    if (stored !== null && isBrowseView(stored.view)) return stored.view;
    return null;
  });
  // 8z9: the builder action awaiting a "Leave the party?" confirmation.
  const [pendingExit, setPendingExit] = useState(false);
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
    // 5cl.7: the user explicitly returned to the category cards — a fresh
    // browse starts at the top level next time.
    clearBrowseContext();
  };

  /** The one unified back button (2t1.1): while a list is open it returns
   * to the category cards; at the top level it leaves the browser. */
  const handleBack = () => {
    if (view !== null || query !== "") {
      backToCategories();
      return;
    }
    clearBrowseContext();
    if (onBack !== undefined) {
      onBack();
      return;
    }
    void navigate({ to: compact ? "/party" : "/" });
  };

  /** 5cl.7: record the browser position right before a details navigation
   * so the details page's back button returns to this category/search. */
  const recordPosition = () => saveBrowseContext(view, query);

  /** 8z9: the builder link leaves the party only after confirmation. */
  const requestExit = () => {
    if (!inParty) {
      void navigate({ to: "/build" });
      return;
    }
    setPendingExit(true);
  };

  /** Leave the party before opening the builder, so no ghost party keeps
   * running behind it. */
  const confirmExit = async () => {
    if (!pendingExit) return;
    setPendingExit(false);
    await engine.leaveParty();
    void navigate({ to: "/build" });
  };

  return (
    <div className={cn("flex flex-col", compact ? "gap-4" : "gap-6")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleBack}
          className={buttonStyles("default", "md", "self-start", true)}
          title={compact ? "Back to lobby" : "Back to home"}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          back
        </button>
        <div className="relative min-w-0 flex-1 basis-56">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-foreground/40"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search games…"
            aria-label="Search games"
            className="input input--primary w-full pl-10"
          />
        </div>
      </div>

      {/* Category cards: hidden while a category is open or the user is
          searching — the list takes over (10.9). */}
      {view === null && query === "" ? (
        <section aria-label="Categories" className="grid grid-cols-2 gap-3">
          {/* 5cl.12: the standalone my-games box links to the full library
              page (search, start / duplicate / delete / edit); inside a
              party it opens the in-place saved list instead. */}
          {compact ? (
            <CategoryCard
              emoji="📦"
              label="My games"
              count={savedCount}
              onClick={() => setView("mine")}
            />
          ) : (
            <CategoryCard emoji="📦" label="My games" count={savedCount} href="/library" />
          )}
          {BROWSE_CATEGORIES.map((box) => (
            <CategoryCard
              key={box.id}
              emoji={box.emoji}
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
              onOpen={recordPosition}
              inParty={inParty}
              onExitRequest={requestExit}
              detailOrigin={compact ? "party-browse" : undefined}
            />
          ) : prebuiltGames.length === 0 ? (
            <p className="rounded-2xl border-2 border-border bg-surface p-6 text-center text-foreground/70">
              No games match{query !== "" ? ` “${query}”` : ""}.
            </p>
          ) : (
            prebuiltGames.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                onPick={onPick}
                onOpen={recordPosition}
                detailOrigin={compact ? "party-browse" : undefined}
              />
            ))
          )}
        </section>
      ) : null}

      {/* 8z9: the "Leave the party?" confirmation for the builder link in party
           mode — mirrors the PlayShell's confirm dialogs (plain controlled
           overlay; the shared Dialog can't be reused from party panels). */}
      {pendingExit ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Leave the party?"
        >
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border-2 border-border bg-surface p-5">
            <p className="font-black">Leave the party?</p>
            <p className="text-sm text-foreground/70">
              To open the game builder, you&apos;ll leave this party first. You can always start or
              join another one later.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="default" soft onClick={() => setPendingExit(false)}>
                Stay in party
              </Button>
              <Button variant="danger" onClick={() => void confirmExit()}>
                Leave party
              </Button>
            </div>
          </div>
        </div>
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
  onOpen,
  inParty,
  onExitRequest,
  detailOrigin,
}: {
  query: string;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string;
  games: readonly SavedGame[];
  onPickSaved?: (gameId: string) => void;
  onOpen: () => void;
  inParty?: boolean;
  onExitRequest?: () => void;
  detailOrigin?: "party-browse";
}) {
  if (isLoading) {
    return <LoadingState label="Loading your games…" />;
  }
  if (isError) {
    return <ErrorPanel title="Couldn't load your games" message={errorMessage} />;
  }
  if (games.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border bg-surface p-6 text-center">
        <p className="text-sm text-foreground/70">
          {query !== ""
            ? `No saved games match “${query}”.`
            : "No saved games yet — create one in the editor first."}
        </p>
        {/* 8z9: in a party the New-game action asks first. */}
        {inParty && onExitRequest !== undefined ? (
          <button
            type="button"
            onClick={() => onExitRequest()}
            className={buttonStyles("primary", "md")}
          >
            New game
          </button>
        ) : (
          <Link to="/build" className={buttonStyles("primary", "md")}>
            New game
          </Link>
        )}
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {games.map((game) => (
        <li key={game.id}>
          <SavedGameRow
            game={game}
            onPickSaved={onPickSaved}
            onOpen={onOpen}
            detailOrigin={detailOrigin}
          />
        </li>
      ))}
    </ul>
  );
}
