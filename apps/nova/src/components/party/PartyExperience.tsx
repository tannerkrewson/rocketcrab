import { ArrowLeft, PartyPopper } from "lucide-react";
import { Alert } from "@heroui/react";
import { toast } from "../../lib/toast";
import { PROTOCOL_VERSION } from "@rocketcrab/protocol";
import { cn } from "../../lib/cn";
import { usePartyEngine } from "../../lib/party/use-party";
import type { PartyEngineState } from "../../lib/party/engine";
import { SIGNALING_OUTAGE_MESSAGE } from "../../lib/party/signaling-outage";
import type { CatalogGame } from "../../lib/catalog";
import { selectCatalogGame } from "../../lib/catalog/select";
import { gameRepository } from "../../lib/games/instance";
import { Button } from "../ui/Button";
import { ErrorPanel } from "../ui/ErrorPanel";
import { LoadingState } from "../ui/LoadingState";
import { ExternalGameFrame } from "./ExternalGameFrame";
import { PartyLobby } from "./PartyLobby";
import { PartyPlayShell } from "./PartyPlayShell";
import { PartyReconnectScreen } from "./PartyReconnectScreen";
import { PartyShellHeader } from "./PartyShellHeader";
import { PeerLinkAlert } from "./PeerLinkAlert";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * Party lifecycle view. The lobby boots the runtime invisibly for readiness;
 * the playing view places controls above the game, outside its frame.
 */
export function PartyExperience({
  onLeft,
  initialBrowse = false,
}: {
  onLeft?: () => void;
  initialBrowse?: boolean;
}) {
  const { state, engine, bindContainer } = usePartyEngine();

  const handleLeave = async () => {
    // Failed setup has no party to leave, so do not toast that the player left.
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

  const handlePickGame = async (gameId: string) => {
    try {
      const game = await gameRepository.read(gameId);
      await engine.selectGame({
        gameId: game.id,
        title: game.title,
        source: game.html,
        apiVersion: PROTOCOL_VERSION,
      });
    } catch (error) {
      toast.danger(`Couldn't load that game: ${errorMessage(error)}`);
    }
  };

  const handlePickPrebuilt = async (entry: CatalogGame) => {
    try {
      await selectCatalogGame(engine, entry);
    } catch (error) {
      toast.danger(`Couldn't load that game: ${errorMessage(error)}`);
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

  const handleKickMember = (memberId: string) => {
    engine.kickMember(memberId);
  };
  const handleReloadMyGame = () => {
    engine.reloadMyGame();
  };
  const handleReloadAllGames = () => {
    engine.reloadAllGames();
  };

  const handleEditName = (name: string) => {
    engine.setDisplayName(name);
    toast.success("Name updated.");
  };

  const playing = state.phase === "playing";

  // Keep the lobby runtime invisible but mounted so readiness can complete.
  const frameArea =
    state.externalGame !== null ? (
      playing ? (
        <div
          data-testid="party-external-frame"
          aria-label={state.externalGame.title}
          className="h-full w-full overflow-hidden bg-black"
        >
          <ExternalGameFrame
            key={`${state.externalGame.gameId}|${JSON.stringify(state.externalGame.room)}|${state.externalFrameEpoch}`}
            gameId={state.externalGame.gameId}
            title={state.externalGame.title}
            room={state.externalGame.room}
            displayName={state.displayName}
            isHost={state.externalGame.creatorMemberId === state.memberId}
          />
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

  const settingUp = state.phase === "creating" || state.phase === "joining";
  const shellShown =
    !settingUp && state.phase !== "idle" && state.phase !== "error" && state.phase !== "removed";

  const peerLinkAlert =
    state.peerLink === null ? null : (
      <PeerLinkAlert
        status={state.peerLink}
        phase={state.phase}
        onRetry={() => void engine.reconnect()}
      />
    );

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
        onClearLogs={() => engine.clearRuntimeLogs()}
      >
        <div className="relative h-full w-full">
          {state.signalingOutage ? <SignalingOutageAlert /> : null}
          {peerLinkAlert}
          {frameArea}
        </div>
      </PartyPlayShell>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {shellShown || settingUp ? <PartyShellHeader /> : null}
      {shellShown && state.signalingOutage ? <SignalingOutageAlert /> : null}
      {shellShown ? peerLinkAlert : null}
      {frameArea}
      {renderPhase(
        state,
        engine,
        handleLeave,
        handlePickGame,
        handlePickPrebuilt,
        handleEditName,
        handleKickMember,
        onLeft,
        initialBrowse,
      )}
    </div>
  );
}

function SignalingOutageAlert() {
  return (
    <Alert status="warning">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{SIGNALING_OUTAGE_MESSAGE}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

function renderPhase(
  state: PartyEngineState,
  engine: ReturnType<typeof usePartyEngine>["engine"],
  handleLeave: () => Promise<void>,
  handlePickGame: (gameId: string) => Promise<void>,
  handlePickPrebuilt: (entry: CatalogGame) => Promise<void>,
  handleEditName: (name: string) => void,
  handleKickMember: (memberId: string) => void,
  onLeft?: () => void,
  initialBrowse = false,
) {
  switch (state.phase) {
    case "creating":
    case "joining":
      return (
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 pb-10 pt-14 text-center sm:pt-20">
          {state.signalingOutage ? (
            <ErrorPanel
              title="Connection interrupted"
              message={SIGNALING_OUTAGE_MESSAGE + " We'll keep trying to connect."}
            />
          ) : (
            <LoadingState label={state.phaseDetail ?? "Connecting…"} className="p-0" />
          )}
          <Button variant="tertiary" onPress={() => void handleLeave()}>
            Cancel
          </Button>
        </div>
      );
    case "lobby":
    case "starting":
      return (
        <PartyLobby
          state={state}
          onStart={(force) => engine.startGame(force)}
          onLeave={() => void handleLeave()}
          onKickMember={handleKickMember}
          onEditName={handleEditName}
          initialBrowsing={initialBrowse}
        />
      );
    case "playing":
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
            title={
              state.setupFailureCode
                ? "Couldn't connect to the party"
                : "The party couldn't be set up"
            }
            message={
              (state.lastError ?? "Something went wrong.") +
              (state.setupFailureCode === "room-full"
                ? " A player reported the party may be full, but this may not be why you couldn't connect. Ask the host for help."
                : state.setupFailureCode === "decrypt-failed"
                  ? " A message from a player couldn't be decrypted. It may have been damaged or the invite may be old; this may not be why you couldn't connect. Ask the host for a fresh invite."
                  : "")
            }
            // Retry setup rather than leaving the party flow.
            onRetry={() => engine.retrySetup()}
          />
          <div className="flex justify-center">
            <Button
              variant="default"
              soft
              onClick={() => {
                engine.dismissError();
                onLeft?.();
              }}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
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
