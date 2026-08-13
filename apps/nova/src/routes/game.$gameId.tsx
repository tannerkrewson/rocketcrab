import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, BookOpen, Code2, ExternalLink, Play } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../components/ui/Button";
import { ErrorPanel } from "../components/ui/ErrorPanel";
import { ScreenshotCarousel } from "../components/games/ScreenshotCarousel";
import { findBrowseGame } from "../lib/browse";
import { NOVA_MODE_LABELS } from "../lib/browse/nova-games";
import { storeDraftSource } from "../lib/editor/draft-handoff";
import { cn } from "../lib/cn";

export const Route = createFileRoute("/game/$gameId")({
  component: BrowseGamePage,
});

function CategoryBadge({ label }: { label: string }) {
  return <span className="badge badge-ghost badge-sm font-bold">{label}</span>;
}

/**
 * Prebuilt-game detail (7.23): classic-style Info | Guide tabs (big name,
 * author, players, screenshots, category badges, description; a Guide tab
 * when the game has one). Classic games launch via the /classic/:gameId play
 * route; Nova games open in the editor as a new draft.
 */
export function BrowseGamePage() {
  const { gameId } = Route.useParams();
  const navigate = useNavigate();
  const game = findBrowseGame(gameId);
  const [tab, setTab] = useState<"info" | "guide">("info");
  const [opening, setOpening] = useState(false);

  if (game === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-6">
        <ErrorPanel title="Unknown game" message={`No prebuilt game with the id "${gameId}".`} />
        <Link to="/browse" className="btn btn-ghost btn-sm self-start font-bold">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to games
        </Link>
      </div>
    );
  }

  const handleOpenNova = async () => {
    if (game.kind !== "nova" || opening) return;
    setOpening(true);
    try {
      const source = (await game.load()).default;
      storeDraftSource(source);
      await navigate({ to: "/editor" });
    } catch {
      toast.error("Couldn't load this game.");
      setOpening(false);
    }
  };

  // Classic games get a red badge, Nova games a blue one (7.42).
  const badge =
    game.kind === "classic" ? (
      <span className="badge badge-error badge-outline font-bold">classic</span>
    ) : (
      <span className="badge badge-info badge-outline font-bold">
        nova · {NOVA_MODE_LABELS[game.mode]}
      </span>
    );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <Link to="/browse" className="btn btn-ghost btn-sm self-start font-bold">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to games
      </Link>

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-black">{game.name}</h1>
          {badge}
          {game.connectBlocked ? (
            <span
              className="badge badge-warning badge-outline font-bold"
              title="The game's server blocks room creation from the browser (no CORS headers)."
            >
              room creation blocked
            </span>
          ) : null}
        </div>
        <p className="font-semibold text-base-content/50">by {game.author}</p>
        {game.players ? (
          <p className="text-sm font-semibold text-base-content/60">{game.players} players</p>
        ) : null}
      </header>

      <div role="tablist" aria-label="Game details" className="tabs tabs-box w-fit">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "info"}
          onClick={() => setTab("info")}
          className={cn("tab font-bold", tab === "info" && "tab-active")}
        >
          Info
        </button>
        {game.guideUrl ? (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "guide"}
            onClick={() => setTab("guide")}
            className={cn("tab font-bold", tab === "guide" && "tab-active")}
          >
            Guide
          </button>
        ) : null}
      </div>

      {tab === "info" ? (
        <section aria-label="Info" className="flex flex-col gap-4">
          {game.pictures && game.pictures.length > 0 ? (
            <ScreenshotCarousel images={game.pictures} gameName={game.name} />
          ) : null}

          <div className="flex flex-wrap gap-1.5">
            {game.category.map((category) => (
              <CategoryBadge key={category} label={category} />
            ))}
          </div>

          <p className="whitespace-pre-line text-base-content/80">{game.description}</p>

          {game.kind === "classic" ? (
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold text-base-content/60">
              {game.displayUrlHref ? (
                <a
                  href={game.displayUrlHref}
                  target="_blank"
                  rel="noreferrer"
                  className="link inline-flex items-center gap-1"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  {game.displayUrlText ?? game.displayUrlHref}
                </a>
              ) : null}
              {game.donationUrlHref ? (
                <a
                  href={game.donationUrlHref}
                  target="_blank"
                  rel="noreferrer"
                  className="link inline-flex items-center gap-1"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  {game.donationUrlText ?? "Support the author"}
                </a>
              ) : null}
            </div>
          ) : null}

          {game.connectBlocked ? (
            <p className="rounded-box border border-warning/40 bg-warning/10 p-3 text-sm text-base-content/80">
              This game's server doesn't allow room creation from a browser (no CORS headers), so it
              may not start from Nova yet. Play it on{" "}
              {game.kind === "classic" && game.displayUrlHref ? (
                <a
                  href={game.displayUrlHref}
                  target="_blank"
                  rel="noreferrer"
                  className="link font-bold"
                >
                  {game.displayUrlText ?? "the game's site"}
                </a>
              ) : (
                "the game's site"
              )}{" "}
              directly, or come back when Nova's scoped relay lands.
            </p>
          ) : null}
        </section>
      ) : (
        <section aria-label="Guide" className="flex flex-col gap-3">
          <p className="text-base-content/70">
            {game.name} is hosted by its author. The official rules are linked below.
          </p>
          <a
            href={game.guideUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-outline self-start font-bold"
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            Read the guide
          </a>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {game.kind === "classic" ? (
          <Link
            to="/classic/$gameId"
            params={{ gameId: game.id }}
            className="btn btn-primary w-full font-bold sm:w-fit"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            Play game
          </Link>
        ) : (
          <Button
            variant="primary"
            className="w-full sm:w-fit"
            onClick={() => void handleOpenNova()}
            disabled={opening}
          >
            <Code2 className="h-4 w-4" aria-hidden="true" />
            {opening ? "Opening…" : "Open in the editor"}
          </Button>
        )}
      </div>
    </div>
  );
}
