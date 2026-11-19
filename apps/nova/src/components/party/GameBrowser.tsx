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
import { sharedGameStatus } from "../../lib/games/shared-copies";
import type { SharedPartyGame } from "../../lib/party/engine";

export interface GameBrowserProps {
  /** Pick mode selects directly instead of opening details; used by the in-game browse panel. */
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
  /** Initial category from route search; otherwise restore sessionStorage for the lobby browser. */
  initialView?: string | null;
  /** The search query to open with on mount (paired with ?q=). */
  initialQuery?: string;
  /** Confirm and leave before navigating out of the party flow. */
  inParty?: boolean;
}

type BrowseView = "mine" | "friends" | BrowseCategory["id"];

function isBrowseView(value: string | null | undefined): value is BrowseView {
  return (
    value === null ||
    value === "mine" ||
    value === "friends" ||
    BROWSE_CATEGORIES.some((box) => box.id === value)
  );
}

function matchesQuery(game: BrowseEntry, query: string): boolean {
  if (query === "") return true;
  const haystack = `${game.name} ${game.author} ${game.description}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

/** onOpen records the category before details navigation so Back can restore it. */
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
        <span className="font-black">{game.name}</span>
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
        className="group flex w-full items-center justify-between gap-3 glass rounded-2xl px-4 py-3 text-left transition-colors hover:bg-surface-tertiary"
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
      className="group flex items-center justify-between gap-3 glass rounded-2xl px-4 py-3 transition-colors hover:bg-surface-tertiary"
    >
      {body}
    </Link>
  );
}

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
        <span className="truncate font-black">{game.title}</span>
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
        className="group flex w-full items-center justify-between gap-3 glass rounded-2xl px-4 py-3 text-left transition-colors hover:bg-surface-tertiary"
      >
        {body}
      </button>
    );
  }
  return (
    <div
      key={game.id}
      className="group flex items-center justify-between gap-2 glass rounded-2xl px-4 py-3 transition-colors hover:bg-surface-tertiary"
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

/** My games links to the library standalone, but opens an inline list inside a party. */
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
    "group flex items-center gap-3 glass rounded-2xl p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-surface-tertiary";
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
 * Shared classic and saved-game browser. Browse mode opens details; pick
 * mode selects directly. Persist category/query before details navigation
 * so Back restores the same list even when the lobby browser remounts.
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
  const { engine, state: partyState } = usePartyEngine();
  // Explicit route search takes precedence over the stored in-lobby position.
  const stored = readBrowseContext();
  const [query, setQuery] = useState(initialQuery ?? stored?.query ?? "");
  const [view, setView] = useState<BrowseView | null>(() => {
    if (isBrowseView(initialView)) return initialView;
    if (stored !== null && isBrowseView(stored.view)) return stored.view;
    return null;
  });
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

  // Friends' Nova games shared in this party (lobby browsing only).
  const browsingLobby = inParty && compact && onPick === undefined && onPickSaved === undefined;
  const friendsGames = useMemo(() => {
    if (!browsingLobby) return [];
    const needle = query.toLowerCase();
    return partyState.sharedGames.filter(
      (game) =>
        !game.sharedBySelf &&
        !savedGames.some((saved) => saved.id === game.gameId) &&
        game.title.toLowerCase().includes(needle),
    );
  }, [browsingLobby, partyState.sharedGames, savedGames, query]);

  const showingList = view !== null || query !== "";
  const savedCount = savedGamesQuery.isLoading ? null : savedGames.length;

  const backToCategories = () => {
    setView(null);
    setQuery("");
    // Explicitly returning to categories makes the next browse start at the top level.
    clearBrowseContext();
  };

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

  const recordPosition = () => saveBrowseContext(view, query);

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
        <Button
          variant="default"
          soft
          className="self-start"
          onClick={handleBack}
          title={compact ? "Back to lobby" : "Back to home"}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          back
        </Button>
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

      {view === null && query === "" ? (
        <section aria-label="Categories" className="grid grid-cols-2 gap-3">
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
          {friendsGames.length > 0 ? (
            <CategoryCard
              emoji="🤝"
              label="Friends' games"
              count={friendsGames.length}
              onClick={() => setView("friends")}
            />
          ) : null}
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
          {view === "friends" ? (
            <FriendsGamesList
              games={friendsGames}
              savedGames={savedGames}
              onOpen={recordPosition}
            />
          ) : view === "mine" ? (
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
            <p className="glass rounded-2xl p-6 text-center text-foreground/70">
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

      {pendingExit ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Leave the party?"
        >
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-overlay p-5 shadow-overlay">
            <p className="font-black">Leave the party?</p>
            <p className="text-sm text-foreground/70">
              To open the game builder, you&apos;ll leave this party first. You can always start or
              join another one later.
            </p>
            <div className="button-row self-end">
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
      <div className="flex flex-col items-center gap-3 glass rounded-2xl p-6 text-center">
        <p className="text-sm text-foreground/70">
          {query !== ""
            ? `No saved games match “${query}”.`
            : "No saved games yet — create one in the editor first."}
        </p>
        {inParty && onExitRequest !== undefined ? (
          <Button variant="primary" onClick={() => onExitRequest()}>
            New game
          </Button>
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

/** Games friends shared in this party; each opens its details to save it. */
function FriendsGamesList({
  games,
  savedGames,
  onOpen,
}: {
  games: readonly SharedPartyGame[];
  savedGames: readonly SavedGame[];
  onOpen: () => void;
}) {
  if (games.length === 0) {
    return (
      <p className="glass rounded-2xl p-6 text-center text-foreground/70">
        No friends&apos; games match.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {games.map((game) => {
        const status = sharedGameStatus(savedGames, game).kind;
        return (
          <li key={game.gameId}>
            <Link
              to="/game/$gameId"
              params={{ gameId: game.gameId }}
              search={{ from: "party-browse" }}
              onClick={onOpen}
              className="group flex items-center justify-between gap-3 glass rounded-2xl px-4 py-3 transition-colors hover:bg-surface-tertiary"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate font-black">{game.title}</span>
                <span className="text-sm font-medium text-foreground/50">
                  {game.sharedBy !== null ? `shared by ${game.sharedBy}` : "Shared in this party"}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {status === "saved" ? <Badge>Saved</Badge> : null}
                {status === "update" ? <Badge color="accent">Update</Badge> : null}
                <ArrowRight
                  className="h-5 w-5 text-foreground/40 transition-transform group-hover:translate-x-1 group-hover:text-primary"
                  aria-hidden="true"
                />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
