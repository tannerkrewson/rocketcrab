import { LogOut, Menu, OctagonX, Users, Wifi } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { writeToClipboard } from "../../lib/editor/clipboard";
import type { PartyEngineState } from "../../lib/party/engine";
import { Button } from "../ui/Button";

export interface PartyPlayShellProps {
  state: PartyEngineState;
  onEndGame: () => void;
  onLeave: () => void;
}

/**
 * The play shell (P4 / 7.4): classic-style in-game chrome floating over the
 * fullscreen game frame — logo, game title, the room code (click to copy
 * the invite link), and a Menu dropdown (Players, Exit to party for the
 * host, Leave party). The emergency teardown ("Exit to party") lives here,
 * outside the game frame (T6/T21 — game code cannot disable it); game-end
 * returns everyone to the lobby.
 */
export function PartyPlayShell({ state, onEndGame, onLeave }: PartyPlayShellProps) {
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);

  const copyInvite = async () => {
    if (state.inviteUrl === null) return;
    const ok = await writeToClipboard(state.inviteUrl);
    if (ok) {
      toast.success("Invite link copied.");
    } else {
      toast.error("Couldn't copy the invite link.");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Classic top bar: logo, game title, room code, Menu. */}
      <div className="flex items-center gap-2 rounded-box border-2 border-base-300 bg-base-100 px-3 py-2">
        <span className="text-xl leading-none" aria-hidden="true">
          🦀🚀
        </span>
        <span className="min-w-0 flex-1 truncate font-black">{state.game?.title ?? "Playing"}</span>
        <span className="badge badge-success badge-sm" title="Party connection state">
          <Wifi className="mr-1 h-3 w-3" aria-hidden="true" />
          {state.connectionState}
        </span>
        {state.code !== null ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm font-mono font-black tracking-widest"
            onClick={() => void copyInvite()}
            disabled={state.inviteUrl === null}
            title="Copy the invite link"
            aria-label={`Party code ${state.code}`}
          >
            {state.code}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
          Menu
        </button>
      </div>

      {/* In-game menu (classic: Players / Exit to party / Leave). */}
      {menuOpen ? (
        <div
          className="flex flex-col rounded-box border-2 border-base-300 bg-base-100 p-2"
          role="menu"
          aria-label="Game menu"
        >
          <button
            type="button"
            role="menuitem"
            className="btn btn-ghost btn-sm justify-start"
            onClick={() => {
              setMenuOpen(false);
              setPlayersOpen((open) => !open);
            }}
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            Players
          </button>
          {state.role === "creator" ? (
            <button
              type="button"
              role="menuitem"
              className="btn btn-ghost btn-sm justify-start text-error"
              onClick={() => {
                setMenuOpen(false);
                setConfirmEnd(true);
              }}
            >
              <OctagonX className="h-4 w-4" aria-hidden="true" />
              Exit to party
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="btn btn-ghost btn-sm justify-start"
            onClick={() => {
              setMenuOpen(false);
              onLeave();
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Leave party
          </button>
        </div>
      ) : null}

      {/* Players overlay (classic PlayerList; no chat per user scope). */}
      {playersOpen ? (
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-box border-2 border-base-300 bg-base-100 p-3">
          <p className="text-sm font-black uppercase tracking-widest text-base-content/60">
            Players ({state.members.length})
          </p>
          {state.members.map((member) => (
            <div key={member.memberId} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-bold">
                {member.displayName}
                {member.isSelf ? <span className="text-base-content/50"> (you)</span> : null}
              </span>
              {member.connected ? (
                <span className="badge badge-success badge-sm">Connected</span>
              ) : (
                <span className="badge badge-error badge-sm">Disconnected</span>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {confirmEnd ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="End the game for everyone"
        >
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-box border-2 border-base-300 bg-base-100 p-5">
            <p className="font-black">Exit to the party?</p>
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
                Exit to party
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
