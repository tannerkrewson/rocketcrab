import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Library, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { buttonStyles } from "../components/ui/Button";
import {
  BROWSE_CATEGORIES,
  BROWSE_GAMES,
  categoryCount,
  type BrowseCategory,
  type BrowseEntry,
} from "../lib/browse";

export const Route = createFileRoute("/browse")({
  component: BrowsePage,
});

/** Badge text/color per game kind (classic vs nova, 7.7.2). */
function KindBadge({ kind }: { kind: BrowseEntry["kind"] }) {
  if (kind === "classic") {
    return (
      <span
        className="badge badge-info badge-outline font-bold"
        title="External iframe game from classic Rocketcrab"
      >
        classic
      </span>
    );
  }
  return (
    <span
      className="badge badge-accent badge-outline font-bold"
      title="A game built on the Nova API"
    >
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
 * The prebuilt-game browser (7.7.2 / 7.23): classic external iframe games and
 * Nova's own example games live together, badged classic/nova, laid out like
 * classic rocketcrab's games page (heading, search, 2-column category grid,
 * card list with bold name + grey "by author" + arrow).
 */
export function BrowsePage() {
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
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black">Games</h1>
          <p className="text-base-content/70">
            Classic external iframe games and Nova's own games, side by side.
          </p>
        </div>
        <Link to="/library" className={buttonStyles("secondary")}>
          <Library className="h-4 w-4" aria-hidden="true" />
          Your games
        </Link>
      </header>

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
          games.map((game) => (
            <Link
              key={game.id}
              to="/game/$gameId"
              params={{ gameId: game.id }}
              className="group flex items-center justify-between gap-3 rounded-box border-2 border-base-300 bg-base-100 px-4 py-3 transition-colors hover:border-primary"
            >
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
              <ArrowRight
                className="h-5 w-5 shrink-0 text-base-content/40 transition-transform group-hover:translate-x-1 group-hover:text-primary"
                aria-hidden="true"
              />
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
