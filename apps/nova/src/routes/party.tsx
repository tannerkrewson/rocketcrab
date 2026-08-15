import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, PartyPopper } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PROTOCOL_VERSION, type GameMode } from "@rocketcrab/protocol";
import { PartyExperience } from "../components/party/PartyExperience";
import { PartyResumeBanner } from "../components/party/PartyResumeBanner";
import { PartyShellHeader } from "../components/party/PartyShellHeader";
import { ErrorPanel } from "../components/ui/ErrorPanel";
import { LoadingState } from "../components/ui/LoadingState";
import { Button, buttonStyles } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { usePartyEngine } from "../lib/party/use-party";
import { takePartySource } from "../lib/party/source-handoff";
import { getSavedPlayerName } from "../lib/party/identity";
import { gameRepository } from "../lib/games/instance";

export const Route = createFileRoute("/party")({
  validateSearch: (search: Record<string, unknown>): PartySearch => ({
    gameId: typeof search.gameId === "string" ? search.gameId : undefined,
    mode: isGameMode(search.mode) ? search.mode : undefined,
    title: typeof search.title === "string" ? search.title : undefined,
    // 5cl.7: ?browse=1 reopens the lobby straight into browse mode (the
    // game-details back button uses it so back returns to the category).
    browse: search.browse === true ? true : undefined,
  }),
  component: PartyPage,
});

const GAME_MODES: readonly GameMode[] = ["state", "simulation", "raw"];

/** /party search params (all optional; 5cl.7 adds ?browse=1). */
interface PartySearch {
  gameId?: string;
  mode?: GameMode;
  title?: string;
  browse?: boolean;
}

function isGameMode(value: unknown): value is GameMode {
  return typeof value === "string" && (GAME_MODES as readonly string[]).includes(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * The party route (P4): the party lobby. With `gameId` search params it
 * creates a party from a saved game (or the editor's handed-off source);
 * otherwise it shows an entry point, and once a party is active it renders
 * the whole lobby/play experience. Invite links land on /join instead.
 *
 * 7.37: the entry page is just the name + Start a party (no secondary
 * actions); a returning player with a saved name skips the entry page
 * entirely and lands straight in the party.
 */
function PartyPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { engine } = usePartyEngine();
  const startedRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 7.5: the player's name is asked before they enter a lobby (start flow).
  const [name, setName] = useState(() => getSavedPlayerName() ?? "");

  useEffect(() => {
    if (startedRef.current || engine.isActive()) {
      return;
    }
    const gameId = search.gameId;
    if (gameId === undefined) {
      // 7.37: a returning player with a saved name skips the entry page —
      // apply the name and go straight into the party.
      const savedName = getSavedPlayerName();
      if (savedName === null) {
        return;
      }
      startedRef.current = true;
      engine.setDisplayName(savedName);
      void engine.createParty();
      return;
    }
    const mode = search.mode ?? "state";
    const title = search.title ?? "Untitled game";
    startedRef.current = true;
    setLoadError(null);
    void (async () => {
      try {
        // The editor hands the CURRENT (possibly unsaved) source over via
        // sessionStorage; otherwise load the saved game from IndexedDB.
        const source = takePartySource(gameId) ?? (await gameRepository.read(gameId)).html;
        await engine.createParty({
          gameId,
          title,
          mode,
          source,
          apiVersion: PROTOCOL_VERSION,
        });
      } catch (error) {
        setLoadError(errorMessage(error));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, search.gameId, search.mode, search.title, attempt]);

  const handleRetry = () => {
    startedRef.current = false;
    setLoadError(null);
    setAttempt((value) => value + 1);
  };

  // 7.6: start a party with NO game preselected — the host lands in the
  // lobby and picks a game from there (classic parity). The name is applied
  // to the engine identity first (7.5).
  const handleStartParty = () => {
    if (name.trim().length > 0) {
      engine.setDisplayName(name);
    }
    void engine.createParty();
  };

  if (engine.isActive()) {
    // A party is being created, joining, in the lobby, playing, or
    // reconnecting — render the full experience. 5cl.9: leaving the party
    // returns to the HOMEPAGE (was /library).
    return (
      <PartyExperience
        onLeft={() => void navigate({ to: "/" })}
        initialBrowse={search.browse === true}
      />
    );
  }
  if (loadError !== null) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-6">
        <ErrorPanel title="Couldn't start the party" message={loadError} onRetry={handleRetry} />
        <Link
          to="/"
          className={buttonStyles("neutral", "md", "self-start", true)}
          title="Back to home"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to home
        </Link>
      </div>
    );
  }
  if (search.gameId !== undefined) {
    return <LoadingState label="Loading game…" />;
  }
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      {/* Classic party shell (7.22): logo header even before a party exists. */}
      <PartyShellHeader />
      <PartyResumeBanner engine={engine} />
      <Card>
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-black">Start a party</h1>
          <p className="text-sm text-base-content/70">
            Your party starts in the lobby; pick a game there before anyone starts playing.
          </p>
          <label htmlFor="party-name" className="text-sm font-bold">
            Your name
          </label>
          <input
            id="party-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            maxLength={24}
            autoComplete="nickname"
            aria-label="Your player name"
            className="input input-bordered w-full"
          />
          <Button variant="primary" size="lg" onClick={handleStartParty}>
            <PartyPopper className="h-5 w-5" aria-hidden="true" />
            Start a party
          </Button>
        </div>
      </Card>
      <Link
        to="/"
        className={buttonStyles("neutral", "md", "self-center", true)}
        title="Back to home"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to home
      </Link>
    </div>
  );
}
