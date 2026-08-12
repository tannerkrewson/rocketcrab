import { Loader2, PartyPopper } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../lib/cn";
import { usePartyEngine } from "../../lib/party/use-party";
import type { PartyEngineState } from "../../lib/party/engine";
import { Button } from "../ui/Button";
import { ErrorPanel } from "../ui/ErrorPanel";
import { PartyLobby } from "./PartyLobby";
import { PartyPlayShell } from "./PartyPlayShell";
import { PartyReconnectScreen } from "./PartyReconnectScreen";

/**
 * The party experience (P4): one component that owns the party engine's
 * lifecycle phases — creating, joining, lobby, playing, reconnecting, and
 * errors — plus the single runtime-frame container that stays mounted for
 * the whole party (a phase change never destroys the game frame).
 */
export function PartyExperience({ onLeft }: { onLeft?: () => void }) {
  const { state, engine, bindContainer } = usePartyEngine();

  const handleLeave = async () => {
    await engine.leaveParty();
    toast.success("You left the party.");
    onLeft?.();
  };

  // The frame container: the same DOM node for the whole party. The lobby
  // shows it as a preview card; the play shell expands it full-screen.
  const frameMounted =
    state.phase === "lobby" ||
    state.phase === "starting" ||
    state.phase === "playing" ||
    state.phase === "reconnecting";
  const frameFullscreen = state.phase === "playing";

  const frameContainer = frameMounted ? (
    <div
      ref={bindContainer}
      data-testid="party-frame"
      aria-label="Your game"
      className={cn(
        "overflow-hidden bg-black",
        frameFullscreen
          ? "fixed inset-0 z-40"
          : "relative h-64 w-full rounded-box border-2 border-base-300 md:h-96",
      )}
    />
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      {frameContainer}
      {frameFullscreen ? (
        // The play-shell controls float ABOVE the fullscreen frame; the
        // container itself never moves so the runtime frame survives the
        // lobby → playing transition (never remounted, never restarted).
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 pt-safe">
          <div className="pointer-events-auto">
            <PartyPlayShell
              state={state}
              onEndGame={() => engine.endGame("host_closed")}
              onLeave={() => void handleLeave()}
            />
          </div>
        </div>
      ) : null}
      {renderPhase(state, engine, handleLeave)}
    </div>
  );
}

function renderPhase(
  state: PartyEngineState,
  engine: ReturnType<typeof usePartyEngine>["engine"],
  handleLeave: () => Promise<void>,
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
              ? "The greeter needs to approve your request before you can join."
              : "Your party is being set up — it takes a few seconds."}
          </p>
          <Button variant="ghost" size="md" onClick={() => void handleLeave()}>
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
        />
      );
    case "playing":
      // The play shell controls are the fullscreen overlay above; the lobby
      // content is intentionally hidden while playing.
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
            onRetry={() => void handleLeave()}
          />
          <div className="flex justify-center">
            <Button variant="ghost" onClick={() => void handleLeave()}>
              <PartyPopper className="h-4 w-4" aria-hidden="true" />
              Back
            </Button>
          </div>
        </div>
      );
    case "idle":
      return null;
  }
}
