import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, BookOpen, Code2, ExternalLink, PartyPopper, Play } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PROTOCOL_VERSION } from "@rocketcrab/protocol";
import { Button } from "../components/ui/Button";
import { ErrorPanel } from "../components/ui/ErrorPanel";
import { LoadingState } from "../components/ui/LoadingState";
import { ScreenshotCarousel } from "../components/games/ScreenshotCarousel";
import { findBrowseGame } from "../lib/browse";
import { NOVA_MODE_LABELS } from "../lib/browse/nova-games";
import { storeDraftSource } from "../lib/editor/draft-handoff";
import { useSavedGame } from "../lib/games/queries";
import { usePartyEngine } from "../lib/party/use-party";
import { cn } from "../lib/cn";

export const Route = createFileRoute("/game/$gameId")({
  component: BrowseGamePage,
});

function CategoryBadge({ label }: { label: string }) {
  return <span className="badge badge-ghost badge-sm font-bold">{label}</span>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * Game detail page (7.23 / 10.9): classic-style Info | Guide tabs for
 * prebuilt games, and metadata (title, description, mode) for the player's
 * own saved games loaded from the IndexedDB repository.
 *
 * When a party is waiting in its lobby and the viewer is the creator, a
 * "Select for party" action appears: it hands the game to the party engine
 * (saved / nova games via selectGame, classic games via selectClassicGame)
 * and returns to /party — the party session never left the page (the
 * engine is a module singleton), so the lobby shows the selected game.
 */
export function BrowseGamePage() {
  const { gameId } = Route.useParams();
  const navigate = useNavigate();
  const prebuilt = findBrowseGame(gameId);
  const savedQuery = useSavedGame(prebuilt === undefined ? gameId : "");
  const { state, engine } = usePartyEngine();
  const [tab, setTab] = useState<"info" | "guide">("info");
  const [opening, setOpening] = useState(false);
  const [selecting, setSelecting] = useState(false);

  const inPartyLobby =
    (state.phase === "lobby" || state.phase === "starting") && state.role === "creator";
  const backTarget = inPartyLobby ? "/party" : "/browse";
  const backLabel = inPartyLobby ? "Back to party" : "Back to games";

  const backLink = (
    <Link to={backTarget} className="btn btn-link btn-sm self-start font-bold">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {backLabel}
    </Link>
  );

  /** Select the game for the active party, then return to the lobby. */
  const pickForParty = async (pick: () => Promise<void>) => {
    if (selecting) return;
    setSelecting(true);
    try {
      await pick();
      // The /party route declares search params (EditorPage sets them);
      // an empty search is the plain "start a party" landing, which the
      // engine routes back to the active party's lobby.
      await navigate({
        to: "/party",
        search: { gameId: undefined, mode: undefined, title: undefined },
      });
    } catch (error) {
      toast.error(`Couldn't select that game: ${errorMessage(error)}`);
      setSelecting(false);
    }
  };

  /** The host-only party-pick button (absent when no party is waiting). */
  const selectForParty = (pick: () => Promise<void>) =>
    inPartyLobby ? (
      <Button
        variant="primary"
        size="lg"
        onClick={() => void pickForParty(pick)}
        disabled={selecting}
      >
        <PartyPopper className="h-4 w-4" aria-hidden="true" />
        {selecting ? "Selecting…" : "Select for party"}
      </Button>
    ) : null;

  if (prebuilt === undefined) {
    if (savedQuery.isLoading) {
      return (
        <div className="mx-auto w-full max-w-xl py-6">
          <LoadingState label="Loading game…" />
        </div>
      );
    }
    const saved = savedQuery.data;
    if (savedQuery.isError || saved === undefined) {
      return (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-6">
          <ErrorPanel title="Unknown game" message={`No game with the id "${gameId}".`} />
          {backLink}
        </div>
      );
    }
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        {backLink}
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-black">{saved.title}</h1>
            <span className="badge badge-info badge-outline font-bold">
              {NOVA_MODE_LABELS[saved.mode ?? "state"]} · saved
            </span>
          </div>
        </header>
        <p className="whitespace-pre-line text-base-content/80">
          {saved.description ?? "No description yet — open it in the editor to learn more."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {selectForParty(async () => {
            await engine.selectGame({
              gameId: saved.id,
              title: saved.title,
              mode: saved.mode ?? "state",
              source: saved.html,
              apiVersion: saved.apiVersion ?? PROTOCOL_VERSION,
            });
          })}
        </div>
      </div>
    );
  }

  const handleOpenNova = async () => {
    if (prebuilt.kind !== "nova" || opening) return;
    setOpening(true);
    try {
      const source = (await prebuilt.load()).default;
      storeDraftSource(source);
      await navigate({ to: "/editor" });
    } catch {
      toast.error("Couldn't load this game.");
      setOpening(false);
    }
  };

  // Classic games get a red badge, Nova games a blue one (7.42).
  const badge =
    prebuilt.kind === "classic" ? (
      <span className="badge badge-error badge-outline font-bold">classic</span>
    ) : (
      <span className="badge badge-info badge-outline font-bold">
        nova · {NOVA_MODE_LABELS[prebuilt.mode]}
      </span>
    );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      {backLink}

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-black">{prebuilt.name}</h1>
          {badge}
        </div>
        <p className="font-semibold text-base-content/50">by {prebuilt.author}</p>
        {prebuilt.players ? (
          <p className="text-sm font-semibold text-base-content/60">{prebuilt.players} players</p>
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
        {prebuilt.guideUrl ? (
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
          {prebuilt.pictures && prebuilt.pictures.length > 0 ? (
            <ScreenshotCarousel images={prebuilt.pictures} gameName={prebuilt.name} />
          ) : null}

          <div className="flex flex-wrap gap-1.5">
            {prebuilt.category.map((category) => (
              <CategoryBadge key={category} label={category} />
            ))}
          </div>

          <p className="whitespace-pre-line text-base-content/80">{prebuilt.description}</p>

          {prebuilt.kind === "classic" ? (
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold text-base-content/60">
              {prebuilt.displayUrlHref ? (
                <a
                  href={prebuilt.displayUrlHref}
                  target="_blank"
                  rel="noreferrer"
                  className="link inline-flex items-center gap-1"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  {prebuilt.displayUrlText ?? prebuilt.displayUrlHref}
                </a>
              ) : null}
              {prebuilt.donationUrlHref ? (
                <a
                  href={prebuilt.donationUrlHref}
                  target="_blank"
                  rel="noreferrer"
                  className="link inline-flex items-center gap-1"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  {prebuilt.donationUrlText ?? "Support the author"}
                </a>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : (
        <section aria-label="Guide" className="flex flex-col gap-3">
          <p className="text-base-content/70">
            {prebuilt.name} is hosted by its author. The official rules are linked below.
          </p>
          <a
            href={prebuilt.guideUrl}
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
        {prebuilt.kind === "classic"
          ? selectForParty(async () => {
              await engine.selectClassicGame(prebuilt.id);
            })
          : selectForParty(async () => {
              const { default: source } = await prebuilt.load();
              await engine.selectGame({
                gameId: prebuilt.id,
                title: prebuilt.name,
                mode: prebuilt.mode,
                source,
                apiVersion: PROTOCOL_VERSION,
              });
            })}
        {prebuilt.kind === "classic" ? (
          <Link
            to="/classic/$gameId"
            params={{ gameId: prebuilt.id }}
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
