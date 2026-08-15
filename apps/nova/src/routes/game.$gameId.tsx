import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, BookOpen, Code2, ExternalLink, PartyPopper } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PROTOCOL_VERSION } from "@rocketcrab/protocol";
import { Button, buttonStyles } from "../components/ui/Button";
import { ErrorPanel } from "../components/ui/ErrorPanel";
import { LoadingState } from "../components/ui/LoadingState";
import { ScreenshotCarousel } from "../components/games/ScreenshotCarousel";
import { BrandHeader } from "../components/layout/BrandHeader";
import { findBrowseGame } from "../lib/browse";
import { NOVA_MODE_LABELS } from "../lib/browse/nova-games";
import { storeDraftSource } from "../lib/editor/draft-handoff";
import { storePartySource } from "../lib/party/source-handoff";
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
 * Game detail page (7.23 / 10.9 / 2t1.10): classic-style Info | Guide tabs
 * for prebuilt games, and metadata (title, description, mode) for the
 * player's own saved games loaded from the IndexedDB repository. The brand
 * row (rocketcrab.com) stays visible (2t1.1).
 *
 * The call to action is contextual — there is NO standalone "play game"
 * view (2t1.10): when a party is waiting in its lobby and the viewer is the
 * creator, "Select game" hands the game to the party engine (saved / nova
 * games via selectGame, classic games via selectClassicGame) and returns to
 * /party; when the viewer is not in a party, "Start party" creates one with
 * the game preselected (saved / nova via /party search params + source
 * handoff; classic games can't be preselected over the URL, so the party
 * starts and the lobby's pick-a-game browser shows the classic boxes).
 * Guests in a party get no CTA — the host picks.
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
  const notInParty = state.phase === "idle";
  const backTarget = inPartyLobby ? "/party" : "/browse";
  const backLabel = inPartyLobby ? "Back to party" : "Back to games";

  const backLink = (
    <Link to={backTarget} className={buttonStyles("outline", "md", "self-start")} title={backLabel}>
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

  /** The host-only "Select game" action (absent when no party is waiting). */
  const selectForParty = (pick: () => Promise<void>) =>
    inPartyLobby ? (
      <Button
        variant="primary"
        size="lg"
        onClick={() => void pickForParty(pick)}
        disabled={selecting}
      >
        <PartyPopper className="h-4 w-4" aria-hidden="true" />
        {selecting ? "Selecting…" : "Select game"}
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
        <BrandHeader />
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
        <div className="flex flex-wrap items-center justify-center gap-3">
          {notInParty ? (
            <Link
              to="/party"
              search={{ gameId: saved.id, mode: saved.mode ?? "state", title: saved.title }}
              className={buttonStyles("primary", "lg")}
              title="Create a party from this game and play it with friends"
            >
              <PartyPopper className="h-4 w-4" aria-hidden="true" />
              Start party
            </Link>
          ) : null}
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

  /** Not in a party: start one with a Nova prebuilt game preselected. The
   * source goes through the party source handoff so /party can load it. */
  const handleStartPartyFromNova = async () => {
    if (prebuilt.kind !== "nova" || opening) return;
    setOpening(true);
    try {
      const source = (await prebuilt.load()).default;
      storePartySource({ gameId: prebuilt.id, source });
      await navigate({
        to: "/party",
        search: { gameId: prebuilt.id, mode: prebuilt.mode, title: prebuilt.name },
      });
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
      <BrandHeader />
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

      <div className="flex flex-wrap items-center justify-center gap-3">
        {notInParty ? (
          prebuilt.kind === "classic" ? (
            // Classic games can't be preselected over the URL (the engine
            // creates their room in the lobby), so the party starts plain
            // and the lobby's pick-a-game browser shows the classic boxes.
            <Link
              to="/party"
              search={{ gameId: undefined, mode: undefined, title: undefined }}
              className={buttonStyles("primary", "lg")}
              title="Start a party and pick this game in the lobby"
            >
              <PartyPopper className="h-4 w-4" aria-hidden="true" />
              Start party
            </Link>
          ) : (
            <Button
              variant="primary"
              size="lg"
              onClick={() => void handleStartPartyFromNova()}
              disabled={opening}
            >
              <PartyPopper className="h-4 w-4" aria-hidden="true" />
              {opening ? "Starting…" : "Start party"}
            </Button>
          )
        ) : null}
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
        {prebuilt.kind === "nova" ? (
          <Button
            variant="primary"
            size="lg"
            onClick={() => void handleOpenNova()}
            disabled={opening}
          >
            <Code2 className="h-4 w-4" aria-hidden="true" />
            {opening ? "Opening…" : "Open in the editor"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
