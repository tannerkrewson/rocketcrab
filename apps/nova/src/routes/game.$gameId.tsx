import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Tabs } from "@heroui/react";
import { toast } from "../lib/toast";
import { Badge } from "../components/ui/Badge";
import { ArrowLeft, BookOpen, ExternalLink, PartyPopper, Pencil } from "lucide-react";
import { useState } from "react";
import { PROTOCOL_VERSION } from "@rocketcrab/protocol";
import { Button, buttonStyles } from "../components/ui/Button";
import { ErrorPanel } from "../components/ui/ErrorPanel";
import { LoadingState } from "../components/ui/LoadingState";
import { Dialog } from "../components/ui/Dialog";
import { ScreenshotCarousel } from "../components/games/ScreenshotCarousel";
import { BrandHeader } from "../components/layout/BrandHeader";
import { PartyShellHeader } from "../components/party/PartyShellHeader";
import { findBrowseGame } from "../lib/browse";
import { readBrowseContext } from "../lib/browse/back-context";
import { NOVA_MODE_LABELS } from "../lib/browse/nova-games";
import { useSavedGame } from "../lib/games/queries";
import { usePartyEngine } from "../lib/party/use-party";

export const Route = createFileRoute("/game/$gameId")({
  validateSearch: (search: Record<string, unknown>): GameDetailSearch => ({
    from: isGameDetailOrigin(search.from) ? search.from : undefined,
  }),
  component: BrowseGamePage,
});

type GameDetailOrigin = "party" | "party-browse";

interface GameDetailSearch {
  from?: GameDetailOrigin;
}

function isGameDetailOrigin(value: unknown): value is GameDetailOrigin {
  return value === "party" || value === "party-browse";
}

function CategoryBadge({ label }: { label: string }) {
  return <Badge>{label}</Badge>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * Shared details for classic and saved games. Hosts can select a game for
 * their waiting party; players outside a party can start one. Guests
 * cannot change the party's game.
 */
export function BrowseGamePage() {
  const { gameId } = Route.useParams();
  const { from } = Route.useSearch();
  const navigate = useNavigate();
  const prebuilt = findBrowseGame(gameId);
  const savedQuery = useSavedGame(prebuilt === undefined ? gameId : "");
  const { state, engine } = usePartyEngine();
  const [tab, setTab] = useState<"info" | "guide">("info");
  const [selecting, setSelecting] = useState(false);
  const [editConfirmationOpen, setEditConfirmationOpen] = useState(false);

  const inPartyLobby = (state.phase === "lobby" || state.phase === "starting") && state.amHost;
  const notInParty = state.phase === "idle";
  const inParty = engine.isActive();
  const partyBack = from === "party" || from === "party-browse" || inPartyLobby;
  const partyBrowseBack = from === "party-browse" || (from === undefined && inPartyLobby);

  // Restore the browser's category and query, including when the lobby remounts.
  const browseBack = readBrowseContext();
  const backTarget =
    browseBack === null || browseBack.view === null
      ? "/browse"
      : `/browse?view=${encodeURIComponent(browseBack.view)}&q=${encodeURIComponent(browseBack.query)}`;
  const backLabel = partyBack
    ? partyBrowseBack
      ? "Back to category"
      : "Back to party"
    : "Back to games";

  const backLink = partyBack ? (
    <Link
      to="/party"
      search={{
        browse: partyBrowseBack ? true : undefined,
        gameId: undefined,
        mode: undefined,
        title: undefined,
      }}
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

  const header =
    partyBack && inParty ? <PartyShellHeader inviteUrl={state.inviteUrl} /> : <BrandHeader />;

  const navigateToEditor = () => {
    void navigate({ to: "/games/$gameId/edit", params: { gameId } });
  };

  /** Editing is outside the party flow, so active parties must be left first. */
  const requestEdit = () => {
    if (!inParty) {
      navigateToEditor();
      return;
    }
    setEditConfirmationOpen(true);
  };

  const confirmEdit = async () => {
    try {
      await engine.leaveParty();
      setEditConfirmationOpen(false);
      navigateToEditor();
    } catch (error) {
      toast.danger(`Couldn't leave the party: ${errorMessage(error)}`);
    }
  };

  const pickForParty = async (pick: () => Promise<void>) => {
    if (selecting) return;
    setSelecting(true);
    try {
      await pick();
      await navigate({
        to: "/party",
        search: { gameId: undefined, mode: undefined, title: undefined },
      });
    } catch (error) {
      toast.danger(`Couldn't select that game: ${errorMessage(error)}`);
      setSelecting(false);
    }
  };

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
            <Badge color="accent">{NOVA_MODE_LABELS[saved.mode ?? "state"]} · saved</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {inParty ? (
              <Button variant="default" soft size="md" onClick={requestEdit}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Edit game
              </Button>
            ) : (
              <Link
                to="/games/$gameId/edit"
                params={{ gameId: saved.id }}
                className={buttonStyles("default", "md", undefined, true)}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Edit game
              </Link>
            )}
          </div>
        </header>
        <p className="whitespace-pre-line text-foreground/80">
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
        <Dialog
          open={editConfirmationOpen}
          onClose={() => setEditConfirmationOpen(false)}
          title="Leave the party?"
        >
          <div className="flex flex-col gap-4">
            <p>
              To open the editor, you&apos;ll leave this party first. You can always start or join
              another one later.
            </p>
            <div className="button-row self-end">
              <Button variant="default" soft onClick={() => setEditConfirmationOpen(false)}>
                Stay in party
              </Button>
              <Button variant="danger" onClick={() => void confirmEdit()}>
                Leave party
              </Button>
            </div>
          </div>
        </Dialog>
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
          <Badge color="danger">classic</Badge>
          {prebuilt.category.map((category) => (
            <CategoryBadge key={category} label={category} />
          ))}
        </div>
        <p className="font-semibold text-foreground/50">by {prebuilt.author}</p>
        {prebuilt.players ? (
          <p className="text-sm font-semibold text-foreground/60">{prebuilt.players} players</p>
        ) : null}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold text-foreground/60">
          {prebuilt.displayUrlHref ? (
            <a
              href={prebuilt.displayUrlHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-link underline-offset-4 hover:underline"
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

      <Tabs
        selectedKey={tab}
        onSelectionChange={(key) => setTab(key === "guide" ? "guide" : "info")}
        aria-label="Game details"
      >
        <Tabs.List>
          <Tabs.Tab id="info">Info</Tabs.Tab>
          {prebuilt.guideUrl ? <Tabs.Tab id="guide">Guide</Tabs.Tab> : null}
        </Tabs.List>
      </Tabs>

      {tab === "info" ? (
        <section aria-label="Info" className="flex flex-col gap-4">
          {prebuilt.pictures && prebuilt.pictures.length > 0 ? (
            <ScreenshotCarousel images={prebuilt.pictures} gameName={prebuilt.name} />
          ) : null}

          <p className="whitespace-pre-line text-foreground/80">{prebuilt.description}</p>
        </section>
      ) : (
        <section aria-label="Guide" className="flex flex-col gap-3">
          <p className="text-foreground/70">
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
          // Classic rooms are created in the lobby, so they cannot be preselected via URL.
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
