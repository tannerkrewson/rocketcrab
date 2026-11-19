import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PROTOCOL_VERSION, type GameMode } from "@rocketcrab/protocol";
import { PartyExperience } from "../components/party/PartyExperience";
import { PartyResumeBanner } from "../components/party/PartyResumeBanner";
import { NameEntry } from "../components/party/NameEntry";
import { ErrorPanel } from "../components/ui/ErrorPanel";
import { LoadingState } from "../components/ui/LoadingState";
import { buttonStyles } from "../components/ui/Button";
import { usePartyEngine } from "../lib/party/use-party";
import { takePartySource } from "../lib/party/source-handoff";
import { getSavedPlayerName } from "../lib/party/identity";
import { importInviteFromLocation, type ImportedInvite } from "../lib/party/invite-import";
import { gameRepository } from "../lib/games/instance";

export const Route = createFileRoute("/party")({
  validateSearch: (search: Record<string, unknown>): PartySearch => ({
    gameId: typeof search.gameId === "string" ? search.gameId : undefined,
    mode: isGameMode(search.mode) ? search.mode : undefined,
    title: typeof search.title === "string" ? search.title : undefined,
    browse: search.browse === true ? true : undefined,
  }),
  component: PartyPage,
});

const GAME_MODES: readonly GameMode[] = ["state", "raw"];

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
 * The party entry point. A plain visit starts your own party; a link with an
 * invite fragment (`/party#secret=…`, ADR-0011) joins a friend's. Either way
 * a player without a saved name names themselves first.
 */
function PartyPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { engine } = usePartyEngine();
  const startedRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Players must pick a real name before any party starts or is joined.
  const [needsName, setNeedsName] = useState(() => getSavedPlayerName() === null);
  // The invite fragment is imported (and stripped from the URL) once per page
  // load, then held here. Until the import effect runs, a fragment in the URL
  // means an invite is probably on its way, so nothing starts yet.
  const [invite, setInvite] = useState<ImportedInvite | null>(null);
  const [importing, setImporting] = useState(() => window.location.hash.length > 0);
  useEffect(() => {
    // StrictMode re-runs this; the importer returns null the second time, so
    // only ever store a real invite.
    const imported = importInviteFromLocation(window.location);
    if (imported !== null) setInvite(imported);
    setImporting(false);
  }, []);

  useEffect(() => {
    if (startedRef.current || engine.isActive() || needsName || importing) {
      return;
    }
    if (invite !== null) {
      startedRef.current = true;
      void engine.joinByInvite(invite);
      return;
    }
    const gameId = search.gameId;
    if (gameId === undefined) {
      startedRef.current = true;
      const savedName = getSavedPlayerName();
      if (savedName !== null) engine.setDisplayName(savedName);
      void engine.createParty();
      return;
    }
    const mode = search.mode ?? "state";
    const title = search.title ?? "Untitled game";
    startedRef.current = true;
    setLoadError(null);
    void (async () => {
      try {
        // The editor may hand over source via sessionStorage; otherwise load
        // the saved game from IndexedDB.
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
  }, [engine, search.gameId, search.mode, search.title, attempt, needsName, importing, invite]);

  const handleRetry = () => {
    startedRef.current = false;
    setLoadError(null);
    setAttempt((value) => value + 1);
  };

  if (engine.isActive()) {
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
          className={buttonStyles("default", "md", "self-start", true)}
          title="Back to home"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to home
        </Link>
      </div>
    );
  }
  if (importing) return null;
  if (needsName) {
    const joining = invite !== null;
    return (
      <NameEntry
        description={
          joining
            ? "Your friends will see this in the party."
            : "Your friends will see this when they join your party."
        }
        submitLabel={joining ? "Join party" : "Start party"}
        onSubmit={(name) => {
          engine.setDisplayName(name);
          setNeedsName(false);
        }}
        secondary={
          <>
            {joining ? null : <PartyResumeBanner engine={engine} />}
            <Link to="/" className={buttonStyles("default", "md", undefined, true)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to home
            </Link>
          </>
        }
      />
    );
  }
  return (
    <LoadingState
      label={
        invite !== null
          ? "Joining the party…"
          : search.gameId !== undefined
            ? "Loading game…"
            : "Starting your party…"
      }
    />
  );
}
