import { useState } from "react";
import { ArrowLeft, PartyPopper } from "lucide-react";
import { Alert } from "@heroui/react";
import { toast } from "../../lib/toast";
import { PROTOCOL_VERSION } from "@rocketcrab/protocol";
import { cn } from "../../lib/cn";
import { usePartyEngine } from "../../lib/party/use-party";
import type { PartyEngineState } from "../../lib/party/engine";
import { SIGNALING_OUTAGE_MESSAGE } from "../../lib/party/signaling-outage";
import { findCatalogGame } from "../../lib/catalog";
import { selectCatalogGame } from "../../lib/catalog/select";
import { gameRepository } from "../../lib/games/instance";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ErrorPanel } from "../ui/ErrorPanel";
import { LoadingState } from "../ui/LoadingState";
import { ExternalGameFrame } from "./ExternalGameFrame";
import { PartyLobby } from "./PartyLobby";
import { PartyPlayShell } from "./PartyPlayShell";
import { PartyReconnectScreen } from "./PartyReconnectScreen";
import { PartyShellHeader } from "./PartyShellHeader";
import { PeerLinkAlert } from "./PeerLinkAlert";

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
      state.phase === "switching" ||
      state.phase === "playing" ||
      state.phase === "reconnecting";
    await engine.leaveParty();
    if (wasInParty) {
      toast.success("You left the party.");
    }
    onLeft?.();
  };

  const handleSwitchGame = async (gameId: string) => {
    const catalogGame = findCatalogGame(gameId);
    if (catalogGame !== undefined) {
      await selectCatalogGame(engine, catalogGame);
      return;
    }
    const saved = await gameRepository.read(gameId).catch(() => {
      const shared = engine.sharedGameSource(gameId);
      if (shared === undefined) throw new Error("The game isn't on this device.");
      return {
        id: shared.gameId,
        title: shared.title,
        html: shared.source,
        apiVersion: shared.apiVersion,
      };
    });
    await engine.selectGame({
      gameId: saved.id,
      title: saved.title,
      source: saved.html,
      apiVersion: saved.apiVersion ?? PROTOCOL_VERSION,
    });
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

  // Remember the game that just ended, so the lobby can thank the players.
  const [played, setPlayed] = useState<{ gameId: string; title: string } | null>(null);
  const current = playing && state.game !== null ? state.game : null;
  const [round, setRound] = useState<{ gameId: string; title: string } | null>(null);
  if (current !== null && round?.gameId !== current.gameId) {
    setRound({ gameId: current.gameId, title: current.title });
    setPlayed(null);
  } else if (round !== null && state.phase === "lobby") {
    setPlayed(round);
    setRound(null);
  }

  // Keep the lobby runtime invisible but mounted so readiness can complete.
  const external = state.game?.kind === "external" ? state.game : null;
  const frameArea =
    external !== null ? (
      playing ? (
        <div
          data-testid="party-external-frame"
          aria-label={external.title}
          className="h-full w-full overflow-hidden bg-black"
        >
          <ExternalGameFrame
            key={`${external.gameId}|${JSON.stringify(external.room)}|${external.frameEpoch}`}
            gameId={external.gameId}
            title={external.title}
            room={external.room}
            displayName={state.displayName}
            isHost={external.creatorMemberId === state.memberId}
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

  if (playing || state.switchingGame) {
    return (
      <PartyPlayShell
        state={state}
        onEndGame={() => engine.endGame("host_closed")}
        onLeave={() => void handleLeave()}
        onReloadMyGame={handleReloadMyGame}
        onReloadAllGames={handleReloadAllGames}
        onKickMember={handleKickMember}
        onSwitchGame={handleSwitchGame}
        onClearLogs={() => engine.clearRuntimeLogs()}
      >
        <div className="relative h-full w-full">
          {state.signalingOutage ? <SignalingOutageAlert /> : null}
          {peerLinkAlert}
          {frameArea}
          {state.switchingGame ? (
            <div className="absolute inset-0 grid place-items-center bg-black">
              <LoadingState
                label={state.game ? "Loading " + state.game.title + "…" : "Switching games…"}
              />
            </div>
          ) : null}
        </div>
      </PartyPlayShell>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {shellShown || settingUp ? (
        <PartyShellHeader code={shellShown ? state.partyCode : null} />
      ) : null}
      {shellShown && state.signalingOutage ? <SignalingOutageAlert /> : null}
      {shellShown ? peerLinkAlert : null}
      {frameArea}
      {renderPhase(
        state,
        engine,
        handleLeave,
        handleEditName,
        handleKickMember,
        onLeft,
        initialBrowse,
        played !== null && state.game?.gameId === played.gameId ? played.title : null,
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
  handleEditName: (name: string) => void,
  handleKickMember: (memberId: string) => void,
  onLeft?: () => void,
  initialBrowse = false,
  playedTitle: string | null = null,
) {
  switch (state.phase) {
    case "creating":
    case "joining":
      return (
        <Card
          className="mx-auto mt-14 mb-10 max-w-md text-center sm:mt-20"
          actions={
            <Button variant="tertiary" className="mx-auto" onPress={() => void handleLeave()}>
              Cancel
            </Button>
          }
        >
          {state.signalingOutage ? (
            <ErrorPanel
              title="Connection interrupted"
              message={SIGNALING_OUTAGE_MESSAGE + " We'll keep trying to connect."}
            />
          ) : (
            <LoadingState label={state.phaseDetail ?? "Connecting…"} className="p-4" />
          )}
        </Card>
      );
    case "lobby":
    case "starting":
      return (
        <PartyLobby
          state={state}
          onStart={() => engine.startGame()}
          onLeave={() => void handleLeave()}
          onKickMember={handleKickMember}
          onEditName={handleEditName}
          initialBrowsing={initialBrowse}
          playedTitle={playedTitle}
        />
      );
    case "playing":
    case "switching":
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
