import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "../lib/toast";
import { Badge } from "../components/ui/Badge";
import { ArrowLeft, BookOpen, ExternalLink, PartyPopper, Pencil, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { PROTOCOL_VERSION } from "@rocketcrab/protocol";
import { Button, buttonStyles } from "../components/ui/Button";
import { ErrorPanel } from "../components/ui/ErrorPanel";
import { LoadingState } from "../components/ui/LoadingState";
import { Dialog } from "../components/ui/Dialog";
import { ScreenshotCarousel } from "../components/games/ScreenshotCarousel";
import { BrandHeader } from "../components/layout/BrandHeader";
import { PartyShellHeader } from "../components/party/PartyShellHeader";
import { SaveSharedGame } from "../components/party/SaveSharedGame";
import { sharedGameStatus } from "../lib/games/shared-copies";
import { useSavedGame, useSavedGames } from "../lib/games/queries";
import type { SharedPartyGame } from "../lib/party/engine";
import { categoriesOf, displayUrlText, findCatalogGame, playerCountText } from "../lib/catalog";
import { selectCatalogGame } from "../lib/catalog/select";
import { readBrowseContext } from "../lib/browse/back-context";
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

/**
 * Listed descriptions are often indented template literals with hard-wrapped
 * lines: rejoin each paragraph so it wraps to the page instead.
 */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * Shared details for listed and saved games. Hosts can select a game for
 * their waiting party; players outside a party can start one. Guests
 * cannot change the party's game.
 */
export function BrowseGamePage() {
  const { gameId } = Route.useParams();
  const { from } = Route.useSearch();
  const navigate = useNavigate();
  const prebuilt = findCatalogGame(gameId);
  const savedQuery = useSavedGame(prebuilt === undefined ? gameId : "");
  const { state, engine } = usePartyEngine();
  const [selecting, setSelecting] = useState(false);
  const [editConfirmationOpen, setEditConfirmationOpen] = useState(false);

  const lobbyPhase = state.phase === "lobby" || state.phase === "starting";
  const inPartyLobby = lobbyPhase && state.amHost;
  // Guests can browse too; their "Select game" explains that the host picks.
  const guestInLobby = lobbyPhase && !state.amHost;
  const [askHostOpen, setAskHostOpen] = useState(false);
  const hostName =
    state.members.find((member) => member.memberId === state.hostMemberId)?.displayName ?? null;
  const notInParty = state.phase === "idle";
  const inParty = engine.isActive();
  const partyBack = from === "party" || from === "party-browse" || lobbyPhase;
  const partyBrowseBack = from === "party-browse" || (from === undefined && lobbyPhase);

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

  const header = partyBack && inParty ? <PartyShellHeader /> : <BrandHeader />;

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
        search: { gameId: undefined, title: undefined },
      });
    } catch (error) {
      toast.danger(`Couldn't select that game: ${errorMessage(error)}`);
      setSelecting(false);
    }
  };

  const selectForParty = (pick: () => Promise<void>) =>
    guestInLobby ? (
      <Button variant="primary" size="lg" onClick={() => setAskHostOpen(true)}>
        <PartyPopper className="h-4 w-4" aria-hidden="true" />
        Select game
      </Button>
    ) : inPartyLobby ? (
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

  const askHostDialog = (title: string) => (
    <Dialog open={askHostOpen} onClose={() => setAskHostOpen(false)} title="Only the host picks">
      <div className="flex flex-col gap-4">
        <p>
          Tell {hostName ?? "the host"} you want to play <b>{title}</b>. They pick the game for
          everyone.
        </p>
        <Button variant="primary" className="self-end" onClick={() => setAskHostOpen(false)}>
          Got it
        </Button>
      </div>
    </Dialog>
  );

  if (prebuilt === undefined) {
    if (savedQuery.isLoading) {
      return (
        <div className="mx-auto w-full max-w-xl py-6">
          <LoadingState label="Loading game…" />
        </div>
      );
    }
    const saved = savedQuery.data;
    const shared = state.sharedGames.find((game) => game.gameId === gameId);
    if ((savedQuery.isError || saved === undefined) && shared !== undefined) {
      // A friend's game from this party: not in My games, but it can be.
      const isCurrent = state.game?.gameId === shared.gameId;
      return (
        <GamePageLayout header={header} backLink={backLink}>
          <GameHero
            title={shared.title}
            byline={shared.sharedBy !== null ? <>shared by {shared.sharedBy}</> : undefined}
            facts={
              <Badge size="md" className="theme-nova" color="accent">
                Made with Nova
              </Badge>
            }
            actions={
              <>
                {isCurrent
                  ? null
                  : selectForParty(async () => {
                      const source = engine.sharedGameSource(shared.gameId);
                      if (source === undefined) throw new Error("The game isn't on this device.");
                      await engine.selectGame({
                        gameId: source.gameId,
                        title: source.title,
                        source: source.source,
                        apiVersion: source.apiVersion ?? PROTOCOL_VERSION,
                      });
                    })}
                <SaveSharedGame game={shared} size="lg" showHint={false} />
              </>
            }
          />
          <AboutCard>
            <p className="leading-relaxed text-foreground/80">
              {shared.sharedBy ?? "A friend"} shared this game in the party. Save it to keep it in
              My games: you can play it in your own parties and change it in the editor.
            </p>
            <SharedCopyNote game={shared} />
          </AboutCard>
          {askHostDialog(shared.title)}
        </GamePageLayout>
      );
    }
    if (savedQuery.isError || saved === undefined) {
      return (
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-6">
          <ErrorPanel title="Unknown game" message={`No game with the id "${gameId}".`} />
          {backLink}
        </div>
      );
    }
    const editAction = inParty ? (
      <Button variant="default" soft size="lg" onClick={requestEdit}>
        <Pencil className="h-4 w-4" aria-hidden="true" />
        Edit game
      </Button>
    ) : (
      <Link
        to="/games/$gameId/edit"
        params={{ gameId: saved.id }}
        className={buttonStyles("default", "lg", undefined, true)}
      >
        <Pencil className="h-4 w-4" aria-hidden="true" />
        Edit game
      </Link>
    );
    return (
      <GamePageLayout header={header} backLink={backLink}>
        <GameHero
          title={saved.title}
          facts={
            <>
              <Badge size="md">My game</Badge>
              <Badge size="md" className="theme-nova" color="accent">
                Made with Nova
              </Badge>
            </>
          }
          actions={
            <>
              {notInParty ? (
                <Link
                  to="/party"
                  search={{ gameId: saved.id, title: saved.title }}
                  className={buttonStyles("primary", "lg")}
                  title="Create a party from this game and play it with friends"
                >
                  <PartyPopper className="h-4 w-4" aria-hidden="true" />
                  Start party
                </Link>
              ) : null}
              {editAction}
              {selectForParty(async () => {
                await engine.selectGame({
                  gameId: saved.id,
                  title: saved.title,
                  source: saved.html,
                  apiVersion: saved.apiVersion ?? PROTOCOL_VERSION,
                });
              })}
            </>
          }
        />
        <AboutCard>
          <p className="whitespace-pre-line leading-relaxed text-foreground/80">
            {saved.description ?? "No description yet. Open it in the editor to add one."}
          </p>
        </AboutCard>
        {askHostDialog(saved.title)}
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
      </GamePageLayout>
    );
  }

  const hasLinks = Boolean(prebuilt.displayUrlHref || prebuilt.donationUrlHref);
  const players = playerCountText(prebuilt);
  const hosted = prebuilt.play.kind === "nova";
  return (
    <GamePageLayout header={header} backLink={backLink}>
      <GameHero
        title={prebuilt.name}
        byline={
          <>
            by {prebuilt.author}
            {prebuilt.basedOn?.game ? <> · based on {prebuilt.basedOn.game}</> : null}
          </>
        }
        facts={
          <>
            {players ? (
              <Badge size="md">
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                {players} players
              </Badge>
            ) : null}
            {categoriesOf(prebuilt).map((category) => (
              <Badge key={category.id} size="md">
                <span aria-hidden="true">{category.emoji}</span> {category.label}
              </Badge>
            ))}
          </>
        }
        actions={
          <>
            {notInParty ? (
              // External rooms are created in the lobby, so only hosted Nova games
              // can be preselected via URL.
              <Link
                to="/party"
                search={
                  hosted
                    ? { gameId: prebuilt.id, title: prebuilt.name }
                    : { gameId: undefined, title: undefined }
                }
                className={buttonStyles("primary", "lg")}
                title={
                  hosted
                    ? "Create a party with this game"
                    : "Start a party and pick this game in the lobby"
                }
              >
                <PartyPopper className="h-4 w-4" aria-hidden="true" />
                Start party
              </Link>
            ) : null}
            {prebuilt.guideUrl ? (
              <a
                href={prebuilt.guideUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonStyles("default", "lg", undefined, true)}
              >
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                How to play
              </a>
            ) : null}
            {selectForParty(async () => {
              await selectCatalogGame(engine, prebuilt);
            })}
          </>
        }
      />

      {prebuilt.pictures && prebuilt.pictures.length > 0 ? (
        <ScreenshotCarousel images={prebuilt.pictures} gameName={prebuilt.name} />
      ) : null}

      <AboutCard>
        {paragraphs(prebuilt.description).map((paragraph) => (
          <p key={paragraph} className="leading-relaxed text-foreground/80">
            {paragraph}
          </p>
        ))}
        {hasLinks ? (
          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm font-semibold">
            {prebuilt.displayUrlHref ? (
              <ExternalTextLink href={prebuilt.displayUrlHref}>
                {displayUrlText(prebuilt)}
              </ExternalTextLink>
            ) : null}
            {prebuilt.donationUrlHref ? (
              <ExternalTextLink href={prebuilt.donationUrlHref}>
                {prebuilt.donationUrlText ?? "Support the author"}
              </ExternalTextLink>
            ) : null}
          </div>
        ) : null}
      </AboutCard>
      {askHostDialog(prebuilt.name)}
    </GamePageLayout>
  );
}

/** Brand row, back link, then the page's cards. */
function GamePageLayout({
  header,
  backLink,
  children,
}: {
  header: ReactNode;
  backLink: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      {header}
      {backLink}
      {children}
    </div>
  );
}

/** Title, byline, quick facts and the page's actions, in one card. */
function GameHero({
  title,
  byline,
  facts,
  actions,
}: {
  title: string;
  byline?: ReactNode;
  facts: ReactNode;
  actions: ReactNode;
}) {
  return (
    <section
      aria-label="Game"
      className="glass flex flex-col items-center gap-4 rounded-2xl p-6 text-center"
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-black sm:text-4xl">{title}</h1>
        {byline ? <p className="font-semibold text-foreground/60">{byline}</p> : null}
      </div>
      <div className="flex flex-wrap justify-center gap-2">{facts}</div>
      {/* Empty for a guest in a party: the host picks the game. */}
      <div className="button-row empty:hidden">{actions}</div>
    </section>
  );
}

function AboutCard({ children }: { children: ReactNode }) {
  return (
    <section aria-label="About" className="glass flex flex-col gap-3 rounded-2xl p-5 sm:p-6">
      <h2 className="text-sm font-black text-foreground/60">About</h2>
      {children}
    </section>
  );
}

function ExternalTextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-foreground/70 underline-offset-4 hover:text-foreground hover:underline"
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </a>
  );
}

/** Explains an update or an edited copy, under the About text. */
function SharedCopyNote({ game }: { game: SharedPartyGame }) {
  const games = useSavedGames().data;
  if (games === undefined) return null;
  const status = sharedGameStatus(games, game);
  const from = game.sharedBy ?? "The host";
  if (status.kind === "update") {
    return (
      <p className="text-sm text-foreground/60">
        {from} changed this game since you saved it. Update your copy to get the new version.
      </p>
    );
  }
  if (status.kind === "edited") {
    return (
      <p className="text-sm text-foreground/60">
        You changed your copy (“{status.game.title}”), so saving keeps yours and adds this version
        as another game.
      </p>
    );
  }
  return null;
}
