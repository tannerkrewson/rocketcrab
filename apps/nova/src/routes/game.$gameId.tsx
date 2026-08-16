import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, BookOpen, ExternalLink, PartyPopper } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PROTOCOL_VERSION } from "@rocketcrab/protocol";
import { Button, buttonStyles } from "../components/ui/Button";
import { ErrorPanel } from "../components/ui/ErrorPanel";
import { LoadingState } from "../components/ui/LoadingState";
import { ScreenshotCarousel } from "../components/games/ScreenshotCarousel";
import { BrandHeader } from "../components/layout/BrandHeader";
import { PartyShellHeader } from "../components/party/PartyShellHeader";
import { findBrowseGame } from "../lib/browse";
import { readBrowseContext } from "../lib/browse/back-context";
import { NOVA_MODE_LABELS } from "../lib/browse/nova-games";
import { useSavedGame } from "../lib/games/queries";
import { usePartyEngine } from "../lib/party/use-party";
import { cn } from "../lib/cn";

export const Route = createFileRoute("/game/$gameId")({
  component: BrowseGamePage,
});

function CategoryBadge({ label }: { label: string }) {
  // l41: badges use daisyUI's soft style (was badge-ghost).
  return <span className="badge badge-soft badge-sm font-bold">{label}</span>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * Game detail page (7.23 / 10.9 / 2t1.10): classic-style Info | Guide tabs
 * for prebuilt games, and metadata (title, description, mode) for the
 * player's own saved games loaded from the IndexedDB repository. The brand
 * row (rocketcrab.com) stays visible (2t1.1) — except inside a party,
 * where the shared party shell header (logo + rocketcrab.com/abcd with the
 * code) takes its place (5cl.8).
 *
 * The call to action is contextual — there is NO standalone "play game"
 * view (2t1.10): when a party is waiting in its lobby and the viewer is the
 * creator, "Select game" hands the game to the party engine (saved games
 * via selectGame, classic games via selectClassicGame) and returns to
 * /party; when the viewer is not in a party, "Start party" creates one with
 * the game preselected (saved games via /party search params + source
 * handoff; classic games can't be preselected over the URL, so the party
 * starts and the lobby's pick-a-game browser shows the classic boxes).
 * Guests in a party get no CTA — the host picks.
 *
 * 5cl.7: the back button returns to where the user came from — the browse
 * category/search they left (the browser records its position in
 * sessionStorage before navigating here), or the party lobby when reached
 * from a party. 5cl.10: the browser is classic-only, so there are no Nova
 * prebuilt branches anymore.
 */
export function BrowseGamePage() {
  const { gameId } = Route.useParams();
  const navigate = useNavigate();
  const prebuilt = findBrowseGame(gameId);
  const savedQuery = useSavedGame(prebuilt === undefined ? gameId : "");
  const { state, engine } = usePartyEngine();
  const [tab, setTab] = useState<"info" | "guide">("info");
  const [selecting, setSelecting] = useState(false);

  const inPartyLobby =
    (state.phase === "lobby" || state.phase === "starting") && state.role === "creator";
  const notInParty = state.phase === "idle";

  // 5cl.7: the browser recorded its view + query before navigating here.
  // In a party the back button returns to /party?browse=1 — the lobby
  // reopens straight into browse mode and its GameBrowser restores the
  // stored category on mount (so back lands on the exact category page the
  // user left). Otherwise the back button returns to the exact
  // category/search via /browse?view=&q=.
  const browseBack = readBrowseContext();
  const backTarget =
    browseBack === null || browseBack.view === null
      ? "/browse"
      : `/browse?view=${encodeURIComponent(browseBack.view)}&q=${encodeURIComponent(browseBack.query)}`;
  const backLabel = inPartyLobby ? "Back to category" : "Back to games";

  const backLink = inPartyLobby ? (
    <Link
      to="/party"
      search={{ browse: true, gameId: undefined, mode: undefined, title: undefined }}
      className={buttonStyles("default", "md", "self-start", true)}
      title={backLabel}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {backLabel}
    </Link>
  ) : (
    <Link
      to={backTarget}
      className={buttonStyles("default", "md", "self-start", true)}
      title={backLabel}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {backLabel}
    </Link>
  );

  /** 5cl.8: the party shell header (logo + code + invite copy) replaces the
   * brand row when this page was reached from a party lobby. */
  const header = inPartyLobby ? (
    <PartyShellHeader code={state.code} inviteUrl={state.inviteUrl} />
  ) : (
    <BrandHeader />
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
        {header}
        {backLink}
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-black">{saved.title}</h1>
            <span className="badge badge-info badge-soft font-bold">
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

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      {header}
      {backLink}

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-black">{prebuilt.name}</h1>
          <span className="badge badge-error badge-soft font-bold">classic</span>
          {/* l41: all badges sit at the top — the category badges live next
              to the classic badge instead of inside the Info tab. */}
          {prebuilt.category.map((category) => (
            <CategoryBadge key={category} label={category} />
          ))}
        </div>
        <p className="font-semibold text-base-content/50">by {prebuilt.author}</p>
        {prebuilt.players ? (
          <p className="text-sm font-semibold text-base-content/60">{prebuilt.players} players</p>
        ) : null}
        {/* l41: the game link + donation link moved up from the bottom of the
            Info tab to sit right under the player count. */}
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

          <p className="whitespace-pre-line text-base-content/80">{prebuilt.description}</p>
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
            className={buttonStyles("default", "md", "self-start", true)}
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            Read the guide
          </a>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        {notInParty ? (
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
        ) : null}
        {selectForParty(async () => {
          await engine.selectClassicGame(prebuilt.id);
        })}
      </div>
    </div>
  );
}
