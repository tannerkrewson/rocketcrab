import { LogOut, OctagonX, Wifi } from "lucide-react";
import { useState } from "react";
import type { PartyEngineState } from "../../lib/party/engine";
import { Button } from "../ui/Button";

export interface PartyPlayShellProps {
  state: PartyEngineState;
  onEndGame: () => void;
  onLeave: () => void;
}

/**
 * The play shell (P4): the game frame front and center with Nova's controls
 * around it. The emergency teardown ("End game for everyone") lives here,
 * outside the game frame (T6/T21 — game code cannot disable it); game-end
 * returns everyone to the lobby.
 */
export function PartyPlayShell({ state, onEndGame, onLeave }: PartyPlayShellProps) {
  const [confirmEnd, setConfirmEnd] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2 rounded-box border-2 border-base-300 bg-base-100 px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-black">{state.game?.title ?? "Playing"}</span>
        <span className="badge badge-success badge-sm">
          <Wifi className="mr-1 h-3 w-3" aria-hidden="true" />
          {state.connectionState}
        </span>
        <Button variant="danger" size="md" onClick={() => setConfirmEnd(true)}>
          <OctagonX className="h-4 w-4" aria-hidden="true" />
          End game for everyone
        </Button>
        <Button variant="ghost" size="md" onClick={onLeave}>
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Leave
        </Button>
      </div>

      {confirmEnd ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="End the game for everyone"
        >
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-box border-2 border-base-300 bg-base-100 p-5">
            <p className="font-black">End the game for everyone?</p>
            <p className="text-sm text-base-content/70">
              Every player&apos;s game will end and the party will return to the lobby. This is the
              emergency stop — game code cannot disable it.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
                Keep playing
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirmEnd(false);
                  onEndGame();
                }}
              >
                End game
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
