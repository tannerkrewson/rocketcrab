import { Loader2, PartyPopper } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PROTOCOL_VERSION } from "@rocketcrab/protocol";
import { cn } from "../../lib/cn";
import { usePartyEngine } from "../../lib/party/use-party";
import type { PartyEngineState } from "../../lib/party/engine";
import { buildClassicGameUrl, findClassicGame } from "../../lib/classic";
import { findNovaPrebuiltGame } from "../../lib/browse/nova-games";
import type { BrowseEntry } from "../../lib/browse";
import { gameRepository } from "../../lib/games/instance";
import { Button } from "../ui/Button";
import { ErrorPanel } from "../ui/ErrorPanel";
import { PartyLobby } from "./PartyLobby";
import { PartyPlayShell } from "./PartyPlayShell";
import { PartyReconnectScreen } from "./PartyReconnectScreen";
import { PartyShellHeader } from "./PartyShellHeader";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * The party experience (P4): one component that owns the party engine's
 * lifecycle phases — creating, joining, lobby, playing, reconnecting, and
 * errors — plus the single runtime-frame container that stays mounted for
 * the whole party (a phase change never destroys the game frame).
 *
 * Classic parity (7.38): the lobby has NO game preview (the frame loads
 * invisibly so the ready gate still works), and while playing the top bar
 * sits in flow ABOVE the frame — the frame fills the remaining space and is
 * never a floating overlay.
 */
export function PartyExperience({ onLeft }: { onLeft?: () => void }) {
  const { state, engine, bindContainer } = usePartyEngine();

  const handleLeave = async () => {
    // 7.10: only toast when there was actually a party to leave; the error
    // phase has nothing to tear down and must not claim the user "left".
    const wasInParty =
      state.phase === "lobby" ||
      state.phase === "starting" ||
      state.phase === "playing" ||
      state.phase === "reconnecting";
    await engine.leaveParty();
    if (wasInParty) {
      toast.success("You left the party.");
    }
    onLeft?.();
  };

  // 7.6: the lobby's browse loads a saved game and hands it to the engine,
  // which registers/announces it for the whole party.
  const handlePickGame = async (gameId: string) => {
    try {
      const game = await gameRepository.read(gameId);
      await engine.selectGame({
        gameId: game.id,
        title: game.title,
        mode: game.mode ?? "state",
        source: game.html,
        apiVersion: PROTOCOL_VERSION,
      });
    } catch (error) {
      toast.error(`Couldn't load that game: ${errorMessage(error)}`);
    }
  };

  // 7.43: picking a prebuilt game (classic or nova) from the shared browse
  // UI. Classic games hand the engine the game id (the host creates the
  // room once and the party plane shares it); Nova games load their source
  // and select it like a saved game.
  const handlePickPrebuilt = async (entry: BrowseEntry) => {
    if (entry.kind === "classic") {
      await engine.selectClassicGame(entry.id);
      return;
    }
    const prebuilt = findNovaPrebuiltGame(entry.id);
    if (prebuilt === undefined) {
      return;
    }
    try {
      const { default: source } = await prebuilt.load();
      await engine.selectGame({
        gameId: entry.id,
        title: entry.name,
        mode: entry.mode,
        source,
        apiVersion: PROTOCOL_VERSION,
      });
    } catch (error) {
      toast.error(`Couldn't load that game: ${errorMessage(error)}`);
    }
  };

  /**
   * Picking a game from the in-game browse while playing ends the running
   * game first (session.end flips the phase back to lobby synchronously),
   * then selects the new game — everyone returns to the lobby with the new
   * game registered. From the lobby (never playing) the pick is direct.
   */
  const handlePickFromInGame = (pick: () => Promise<void>) => {
    if (state.phase === "playing") {
      engine.endGame("host_closed");
    }
    void pick();
  };

  // 7.29: in-game menu + lobby controls (classic parity).
  const handleKickMember = (memberId: string) => {
    engine.kickMember(memberId);
  };
  const handleReloadMyGame = () => {
    engine.reloadMyGame();
  };
  const handleReloadAllGames = () => {
    engine.reloadAllGames();
  };

  // 7.5: apply the edited name to the engine identity (persisted there).
  const handleEditName = (name: string) => {
    engine.setDisplayName(name);
    toast.success("Name updated.");
  };

  const playing = state.phase === "playing";

  // The per-player classic URL: the host merges the host overrides and
  // passes ishost=true; every other player builds the same room with their
  // own name and ishost=false.
  const classicUrl = useMemo(() => {
    const classic = state.classicGame;
    if (classic === null) {
      return null;
    }
    const game = findClassicGame(classic.gameId);
    return buildClassicGameUrl(
      classic.connectResult,
      { renameParams: game?.renameParams },
      { name: state.displayName, isHost: state.role === "creator" },
    );
  }, [state.classicGame, state.displayName, state.role]);

  // The runtime frame container: ONE DOM node for the whole party. In the
  // lobby it is invisible (7.38: no game preview — classic parity) but
  // still mounted so the game boots and the ready gate opens; while
  // playing the SAME node fills the space below the in-flow top bar (never
  // remounted, never restarted). Classic games embed a plain iframe built
  // from the shared room URL spec instead of the Nova runtime.
  const frameArea =
    state.classicGame !== null ? (
      playing ? (
        <div
          data-testid="party-classic-frame"
          aria-label="Classic game"
          className="h-full w-full overflow-hidden bg-black"
        >
          {classicUrl !== null ? (
            <iframe
              key={state.classicFrameEpoch}
              title={state.classicGame.title}
              src={classicUrl}
              className="h-full w-full border-0"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-sm font-semibold text-base-content/60">
              Waiting for the host&apos;s room…
            </div>
          )}
        </div>
      ) : null
    ) : (
      <div
        ref={bindContainer}
        data-testid="party-frame"
        aria-label="Your game"
        className={cn("h-full w-full overflow-hidden bg-black", !playing && "invisible")}
      />
    );

  // 7.22: the classic shell header (logo + big code + phonetic) sits above
  // every live party phase EXCEPT playing, where the in-flow play shell's
  // compact top bar takes over (7.38). The invite details (QR/URL/copy)
  // live in the lobby's invite card (10.5), not the header.
  // 2t1.1: while the host browses games in the lobby, the full-size party
  // header hides — GameBrowser's compact dimmed brand row takes over.
  const [browsing, setBrowsing] = useState(false);

  const shellShown = state.phase !== "idle" && state.phase !== "error" && state.phase !== "removed";

  if (playing) {
    return (
      <PartyPlayShell
        state={state}
        onEndGame={() => engine.endGame("host_closed")}
        onLeave={() => void handleLeave()}
        onReloadMyGame={handleReloadMyGame}
        onReloadAllGames={handleReloadAllGames}
        onKickMember={handleKickMember}
        onPickGame={(gameId) => handlePickFromInGame(() => handlePickGame(gameId))}
        onPickPrebuilt={(entry) => handlePickFromInGame(() => handlePickPrebuilt(entry))}
      >
        <div className="h-full w-full">{frameArea}</div>
      </PartyPlayShell>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {shellShown && !browsing ? (
        <PartyShellHeader code={state.code} inviteUrl={state.inviteUrl} />
      ) : null}
      {frameArea}
      {renderPhase(
        state,
        engine,
        handleLeave,
        handlePickGame,
        handlePickPrebuilt,
        handleEditName,
        handleKickMember,
        setBrowsing,
        onLeft,
      )}
    </div>
  );
}

function renderPhase(
  state: PartyEngineState,
  engine: ReturnType<typeof usePartyEngine>["engine"],
  handleLeave: () => Promise<void>,
  handlePickGame: (gameId: string) => Promise<void>,
  handlePickPrebuilt: (entry: BrowseEntry) => Promise<void>,
  handleEditName: (name: string) => void,
  handleKickMember: (memberId: string) => void,
  onBrowseModeChange: (browsing: boolean) => void,
  onLeft?: () => void,
) {
  switch (state.phase) {
    case "creating":
    case "joining":
      return (
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 py-10 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" aria-hidden="true" />
          <p className="font-black">{state.phaseDetail ?? "Working…"}</p>
          <p className="text-sm text-base-content/70">
            {state.phase === "joining"
              ? "Searching the network for the party — this can take a few seconds. If it never appears, double-check the code with your friend."
              : "Your party is being set up — it takes a few seconds."}
          </p>
          <Button variant="outline" size="md" onClick={() => void handleLeave()}>
            Cancel
          </Button>
        </div>
      );
    case "lobby":
    case "starting":
      return (
        <PartyLobby
          state={state}
          onApprove={(memberId) => engine.respondToJoinRequest(memberId, true)}
          onReject={(memberId) => engine.respondToJoinRequest(memberId, false)}
          onStart={(force) => engine.startGame(force)}
          onLeave={() => void handleLeave()}
          onRefreshDiagnostics={() => void engine.refreshDiagnostics()}
          onKickMember={handleKickMember}
          onEditName={handleEditName}
          onBrowseModeChange={onBrowseModeChange}
        />
      );
    case "playing":
      // The play shell renders the whole playing view (in-flow top bar +
      // frame); the lobby content is intentionally hidden while playing.
      return null;
    case "reconnecting":
      return (
        <PartyReconnectScreen
          state={state}
          onReconnect={() => void engine.reconnect()}
          onLeave={() => void handleLeave()}
        />
      );
    case "error":
      return (
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-6">
          <ErrorPanel
            title="The party couldn't be set up"
            message={state.lastError ?? "Something went wrong."}
            // 7.10: retry re-runs the failed setup; it must NOT call leave
            // (that toasted "you left the party" over the navbar and left
            // a blank page).
            onRetry={() => engine.retrySetup()}
          />
          <div className="flex justify-center">
            <Button
              variant="outline"
              onClick={() => {
                engine.dismissError();
                onLeft?.();
              }}
            >
              <PartyPopper className="h-4 w-4" aria-hidden="true" />
              Back
            </Button>
          </div>
        </div>
      );
    case "removed":
      return (
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-6">
          <ErrorPanel
            title="You were removed from the party"
            message={state.removedReason ?? "The host removed you from the party."}
          />
          <div className="flex justify-center">
            <Button
              variant="primary"
              onClick={() => {
                engine.dismissRemoved();
                onLeft?.();
              }}
            >
              <PartyPopper className="h-4 w-4" aria-hidden="true" />
              Back to games
            </Button>
          </div>
        </div>
      );
    case "idle":
      return null;
  }
}
