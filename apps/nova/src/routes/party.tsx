import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Gamepad2, PartyPopper, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PROTOCOL_VERSION, type GameMode } from "@rocketcrab/protocol";
import { PartyExperience } from "../components/party/PartyExperience";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorPanel } from "../components/ui/ErrorPanel";
import { LoadingState } from "../components/ui/LoadingState";
import { buttonStyles } from "../components/ui/Button";
import { usePartyEngine } from "../lib/party/use-party";
import { takePartySource } from "../lib/party/source-handoff";
import { gameRepository } from "../lib/games/instance";

export const Route = createFileRoute("/party")({
  validateSearch: (search: Record<string, unknown>) => ({
    gameId: typeof search.gameId === "string" ? search.gameId : undefined,
    mode: isGameMode(search.mode) ? search.mode : undefined,
    title: typeof search.title === "string" ? search.title : undefined,
  }),
  component: PartyPage,
});

const GAME_MODES: readonly GameMode[] = ["state", "simulation", "raw"];

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
 */
function PartyPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { engine } = usePartyEngine();
  const startedRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (startedRef.current || engine.isActive()) {
      return;
    }
    const gameId = search.gameId;
    if (gameId === undefined) {
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

  if (engine.isActive()) {
    // A party is being created, joining, in the lobby, playing, or
    // reconnecting — render the full experience.
    return <PartyExperience onLeft={() => void navigate({ to: "/library" })} />;
  }
  if (loadError !== null) {
    return (
      <div className="mx-auto w-full max-w-md py-6">
        <ErrorPanel title="Couldn't start the party" message={loadError} onRetry={handleRetry} />
      </div>
    );
  }
  if (search.gameId !== undefined) {
    return <LoadingState label="Loading game…" />;
  }
  return (
    <div className="mx-auto w-full max-w-xl py-6">
      <EmptyState
        icon={<PartyPopper />}
        title="No party here yet"
        description="Start a party from a game in your library (or the editor), or join a friend's party with their four-letter code."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link to="/library" className={buttonStyles("secondary")}>
              <Gamepad2 className="h-5 w-5" aria-hidden="true" />
              Pick a game
            </Link>
            <Link to="/join" className={buttonStyles("primary")}>
              <Users className="h-5 w-5" aria-hidden="true" />
              Join a party
            </Link>
          </div>
        }
      />
    </div>
  );
}
