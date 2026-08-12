import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { buttonStyles } from "../../components/ui/Button";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { findClassicGame } from "../../lib/classic";
import { buildClassicGameUrl } from "../../lib/classic/url";
import { localPartyIdentity } from "../../lib/party/identity";

export const Route = createFileRoute("/classic/$gameId")({
  component: ClassicGamePage,
});

/**
 * Play a classic external iframe game (rocketcrab-9fv.7.7.1). The room is
 * created in the player's browser (classic ran the same flow on its server),
 * then the game is embedded full-screen via iframe — the classic-style
 * external iframe flow adapted to Nova's backendless architecture. A failure
 * to reach the external service surfaces a readable error instead of a
 * silent hang.
 */
function ClassicGamePage() {
  const { gameId } = Route.useParams();
  const game = findClassicGame(gameId);
  const [attempt, setAttempt] = useState(0);
  const [connect, setConnect] = useState<
    { phase: "connecting" } | { phase: "ready"; url: string } | { phase: "error"; message: string }
  >({ phase: "connecting" });

  useEffect(() => {
    if (game === undefined) {
      return;
    }
    let cancelled = false;
    setConnect({ phase: "connecting" });
    void (async () => {
      try {
        const connected = await game.connectToGame();
        const identity = localPartyIdentity();
        const url = buildClassicGameUrl(connected, game, {
          name: identity.displayName,
          isHost: true,
        });
        if (!cancelled) {
          setConnect({ phase: "ready", url });
        }
      } catch (error) {
        if (!cancelled) {
          setConnect({
            phase: "error",
            message:
              error instanceof Error
                ? error.message
                : "Couldn't set up the game. The game's server may be down.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [game, attempt]);

  if (game === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-6">
        <ErrorPanel
          title="Unknown classic game"
          message={`No classic game with the id "${gameId}".`}
        />
        <Link to="/library" className={buttonStyles("secondary")}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          Back to games
        </Link>
      </div>
    );
  }

  if (connect.phase === "error") {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-6">
        <ErrorPanel
          title={`Couldn't start ${game.name}`}
          message={connect.message}
          onRetry={() => setAttempt((value) => value + 1)}
        />
        <p className="text-sm text-base-content/70">
          Classic games are hosted by their authors. If this keeps failing, the game's server may be
          down.
        </p>
        <Link to="/library" className={buttonStyles("secondary")}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          Back to games
        </Link>
      </div>
    );
  }

  if (connect.phase === "connecting") {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 py-12 text-center">
        <span className="loading loading-spinner loading-lg text-primary" aria-hidden="true" />
        <p className="font-black">Setting up {game.name}…</p>
        <p className="text-sm text-base-content/70">
          Creating a room on the game's server. It can take a few seconds.
        </p>
        <Link to="/library" className={buttonStyles("ghost")}>
          Cancel
        </Link>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 bg-black">
      {/* Plain iframe, exactly like classic rocketcrab's GameFrame: these are
          trusted external services that expect ordinary web capabilities. */}
      <iframe
        title={game.name}
        src={connect.url}
        className="h-full w-full border-0"
        referrerPolicy="no-referrer"
        data-testid="classic-game-frame"
      />
      <Link
        to="/library"
        className="btn btn-sm btn-ghost absolute left-3 top-3 z-10 border-2 border-base-300 bg-base-100/90 text-base-content shadow-sm backdrop-blur"
        aria-label="Back to games"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Back to games</span>
      </Link>
    </div>
  );
}
