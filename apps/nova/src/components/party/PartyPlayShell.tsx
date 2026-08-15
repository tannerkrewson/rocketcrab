import { ArrowLeft, BookOpen, Gamepad2, Menu, OctagonX, RotateCcw, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { BrowseEntry } from "../../lib/browse";
import { writeToClipboard } from "../../lib/editor/clipboard";
import type { PartyEngineState } from "../../lib/party/engine";
import { BrandLogo } from "../layout/BrandLogo";
import { ThemeSelector } from "../layout/ThemeSelector";
import { Button } from "../ui/Button";
import { GameBrowser } from "./GameBrowser";
import { PartyGameDetailsModal } from "./PartyGameDetails";

export interface PartyPlayShellProps {
  state: PartyEngineState;
  /** The game frame area (the Nova runtime container or classic iframe). */
  children: ReactNode;
  onEndGame: () => void;
  onLeave: () => void;
  /** Reload only the local game frame (7.29). */
  onReloadMyGame: () => void;
  /** Host: reload every player's game frame (7.29). */
  onReloadAllGames: () => void;
  /** Host: remove a member from the party (7.29). */
  onKickMember: (memberId: string) => void;
  /** Pick a saved game for the party (7.43 shared browse). */
  onPickGame: (gameId: string) => void;
  /** Pick a prebuilt classic/nova game for the party (7.43 shared browse). */
  onPickPrebuilt: (entry: BrowseEntry) => void;
}

/** Which single panel is open (7.38: the panels are mutually exclusive). */
type PlayShellPanel = "menu" | "players" | "browse" | null;

/**
 * The play shell (P4 / 7.4, redesigned for classic parity in 7.38): the
 * in-game chrome sits IN FLOW ABOVE the game frame — a compact top bar
 * (the SVG brand logo collapses to a bare floating logo on tap, a centered
 * rocketcrab.com/CODE URL copies the invite, and a Menu dropdown opens a
 * compact, flush dropdown), plus a Players POPUP (7.45: a compact overlay
 * anchored top-center BELOW the top bar - never a full-page takeover, so
 * the game keeps running underneath) and the shared pick-a-game browser.
 * The menu (9fv.11.11) holds Browse games (host only — picking a game
 * while playing ends it for everyone) and About this game (the same
 * details overlay the lobby's "What is GameName?" opens); leaving the
 * party happens back in the lobby. Minimal chrome, the code front and
 * center: classic parity. The emergency teardown ("Exit to lobby") lives
 * here, outside the game frame (T6/T21 — game code cannot disable it);
 * game-end returns everyone to the lobby.
 */
export function PartyPlayShell({
  state,
  children,
  onEndGame,
  onReloadMyGame,
  onReloadAllGames,
  onKickMember,
  onPickGame,
  onPickPrebuilt,
}: PartyPlayShellProps) {
  // 7.38: the top bar can collapse to just the floating logo (classic's
  // minimal-chrome mode) so the game gets the whole screen.
  const [barHidden, setBarHidden] = useState(false);
  // 7.38: only one panel is open at a time (menu / players / browse).
  const [panel, setPanel] = useState<PlayShellPanel>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  // 9fv.11.11: "About this game" reuses the lobby's details overlay.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // 7.38: "Reload all" is red and asks first — players' games will be lost.
  const [confirmReloadAll, setConfirmReloadAll] = useState(false);

  // 7.45: Escape closes the open panel (the players popup or the pick-a-
  // game panel); the top bar and the game keep running while it is open.
  useEffect(() => {
    if (panel === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPanel(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panel]);

  const copyInvite = async () => {
    if (state.inviteUrl === null) return;
    const ok = await writeToClipboard(state.inviteUrl);
    if (ok) {
      toast.success("Invite link copied.");
    } else {
      toast.error("Couldn't copy the invite link.");
    }
  };

  // 7.38: the top bar shows the party URL (the code) instead of the game
  // name — classic parity (the code front and center).
  const roomUrl =
    state.code !== null ? `rocketcrab.com/${state.code.toLowerCase()}` : "rocketcrab.com";
  const menuOpen = panel === "menu";

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black" data-testid="party-play-view">
      {!barHidden ? (
        <header className="relative z-50 flex items-center gap-2 border-b-2 border-base-300 bg-base-100 px-3 pb-2 pt-safe">
          {/* 5cl.14: while the navbar is showing, the logo sits bare on the
              bar — no btn background/border/shadow (that chrome only
              returns on the floating collapsed-mode logo below). hover/
              active keep a subtle fill so the tap target still reads as
              tappable. */}
          <button
            type="button"
            className="btn btn-sm shrink-0 border-transparent bg-transparent shadow-none hover:bg-base-200 active:bg-base-300"
            onClick={() => setBarHidden(true)}
            aria-label="Hide the top bar"
            title="Hide the top bar"
          >
            <BrandLogo size={20} />
          </button>

          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <button
              type="button"
              className="font-title whitespace-nowrap text-lg font-black text-base-content md:text-xl"
              onClick={() => void copyInvite()}
              disabled={state.inviteUrl === null}
              title={state.inviteUrl === null ? roomUrl : "Copy the invite link"}
              aria-label={`Party link ${roomUrl}`}
            >
              {roomUrl}
            </button>
          </div>

          <div className="min-w-0 flex-1" />

          {/* 5cl.14: the menu button needs contrast against the base-100 bar
              in every theme — btn-outline draws a base-content border and
              label (the default btn fill is base-200, near-invisible on
              dark themes like the default one). */}
          <button
            type="button"
            className="btn btn-sm btn-outline shrink-0"
            aria-expanded={menuOpen}
            onClick={() => setPanel(menuOpen ? null : "menu")}
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
            Menu
          </button>

          {/* 7.38: the menu is a compact dropdown directly under the Menu
              button, sized to its content and flush with the top bar. */}
          {menuOpen ? (
            <ul
              className="absolute right-0 top-full z-50 flex w-max min-w-56 flex-col rounded-b-box border-2 border-t-0 border-base-300 bg-base-100 p-1.5 shadow-lg"
              role="menu"
              aria-label="Game menu"
            >
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-box px-3 py-2 text-sm font-bold hover:bg-base-200"
                  onClick={() => setPanel("players")}
                >
                  <Users className="h-4 w-4" aria-hidden="true" />
                  Players
                </button>
              </li>
              {/* 9fv.11.11: Browse games moved from the Players popup into the
                  menu (host only — picking a game while playing ends it for
                  everyone, so joiners never see it). */}
              {state.role === "creator" ? (
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-box px-3 py-2 text-sm font-bold hover:bg-base-200"
                    onClick={() => setPanel("browse")}
                  >
                    <Gamepad2 className="h-4 w-4" aria-hidden="true" />
                    Browse games
                  </button>
                </li>
              ) : null}
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-box px-3 py-2 text-sm font-bold hover:bg-base-200"
                  onClick={() => {
                    setPanel(null);
                    setDetailsOpen(true);
                  }}
                  disabled={state.game === null}
                >
                  <BookOpen className="h-4 w-4" aria-hidden="true" />
                  About this game
                </button>
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-box px-3 py-2 text-sm font-bold hover:bg-base-200"
                  onClick={() => {
                    setPanel(null);
                    onReloadMyGame();
                  }}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Reload my game
                </button>
              </li>
              {state.role === "creator" ? (
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-box px-3 py-2 text-sm font-bold text-error hover:bg-base-200"
                    onClick={() => {
                      setPanel(null);
                      setConfirmReloadAll(true);
                    }}
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Reload all
                  </button>
                </li>
              ) : null}
              {state.role === "creator" ? (
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-box px-3 py-2 text-sm font-bold text-error hover:bg-base-200"
                    onClick={() => {
                      setPanel(null);
                      setConfirmEnd(true);
                    }}
                  >
                    <OctagonX className="h-4 w-4" aria-hidden="true" />
                    Exit to lobby
                  </button>
                </li>
              ) : null}
            </ul>
          ) : null}
        </header>
      ) : null}

      {/* The game frame fills everything below the top bar (in flow, never
          floating over the game). The players popup and the pick-a-game
          panel live INSIDE this area (7.45), so they always start BELOW the
          fixed top bar - the bar can never overlap their title/back row. */}
      <div className="relative min-h-0 flex-1">
        {children}

        {/* 7.45: the Players POPUP - a compact overlay anchored top-center
            just below the top bar (never a full-page takeover). The game
            keeps running underneath; clicking outside, Escape, or Back
            dismisses it. The invisible backdrop catches outside clicks. */}
        {panel === "players" ? (
          <>
            <div
              className="absolute inset-0 z-40"
              onClick={() => setPanel(null)}
              aria-hidden="true"
              data-testid="players-popup-backdrop"
            />
            <div
              className="absolute left-1/2 top-3 z-50 flex max-h-[calc(100%-1.5rem)] w-[min(28rem,calc(100%-1.5rem))] -translate-x-1/2 flex-col overflow-hidden rounded-box border-2 border-base-300 bg-base-100 shadow-xl"
              role="dialog"
              aria-label="Players"
            >
              <div className="flex items-center gap-2 border-b-2 border-base-300 px-3 py-2">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setPanel(null)}
                  aria-label="Back to the game"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Back
                </button>
                <p className="font-black">Players ({state.members.length})</p>
                <div className="min-w-0 flex-1" />
              </div>
              <div className="min-h-0 overflow-y-auto p-3">
                <ul className="flex flex-col gap-2">
                  {state.members.map((member) => (
                    <li
                      key={member.memberId}
                      className="flex items-center gap-2 rounded-box border-2 border-base-300 bg-base-100 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate font-bold">
                        {member.displayName}
                        {member.isSelf ? (
                          <span className="text-base-content/50"> (you)</span>
                        ) : null}
                      </span>
                      {member.connected ? (
                        <span className="badge badge-success badge-sm">Connected</span>
                      ) : (
                        <span className="badge badge-error badge-sm">Disconnected</span>
                      )}
                      {state.role === "creator" && !member.isSelf ? (
                        <button
                          type="button"
                          className="btn btn-xs text-error"
                          onClick={() => onKickMember(member.memberId)}
                          title={`Remove ${member.displayName} from the party`}
                        >
                          Kick
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        ) : null}

        {/* 7.43: pick a game - the SAME shared browse UI as /browse, in pick
            mode, so the host can switch the game without leaving the party.
            7.45: rendered inside the frame area so its back row sits below
            the fixed top bar too. 9fv.11.11: opened from the menu (the
            Players popup's browse button moved there); Back returns to the
            running game. */}
        {panel === "browse" ? (
          <div
            className="absolute inset-0 z-40 flex flex-col bg-base-200"
            role="dialog"
            aria-label="Pick a game"
          >
            <div className="flex items-center gap-2 border-b-2 border-base-300 bg-base-100 px-3 py-2">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setPanel(null)}
                aria-label="Back to the game"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back
              </button>
              <p className="font-black">Pick a game</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
              <GameBrowser
                compact
                onPick={onPickPrebuilt}
                onPickSaved={onPickGame}
                // 2t1.1 coordination: the unified back button closes the
                // in-game browse panel (the fallback navigate would be a
                // no-op from the party route).
                onBack={() => setPanel(null)}
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* 11.1: the one floating theme/color control, bottom-right on every
          page — this shell is full-screen (z-40) and covers AppLayout's
          copy, so it renders its own above the game, safe-area aware. */}
      <div
        className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 z-30 rounded-box border-2 border-base-300 bg-base-100 p-1 shadow-md"
        data-testid="floating-theme-control"
      >
        <ThemeSelector />
      </div>

      {/* 7.38: collapsed mode — only the floating logo remains; tap to
          reopen the full top bar. */}
      {barHidden ? (
        <button
          type="button"
          className="btn btn-sm absolute left-[max(0.5rem,env(safe-area-inset-left))] top-[max(0.5rem,env(safe-area-inset-top))] z-50 opacity-80 hover:opacity-100"
          onClick={() => setBarHidden(false)}
          aria-label="Show the top bar"
          title="Show the top bar"
        >
          <BrandLogo size={18} />
        </button>
      ) : null}

      {/* 9fv.11.11: About this game opens the SAME details overlay the
          lobby's "What is GameName?" does, in-game (title / description /
          how-to-play); the game keeps running underneath. */}
      {detailsOpen ? (
        <PartyGameDetailsModal game={state.game} onClose={() => setDetailsOpen(false)} />
      ) : null}

      {confirmEnd ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="End the game for everyone"
        >
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-box border-2 border-base-300 bg-base-100 p-5">
            <p className="font-black">Exit to the lobby?</p>
            <p className="text-sm text-base-content/70">
              Every player&apos;s game will end and the party will return to the lobby. This is the
              emergency stop — game code cannot disable it.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="neutral" soft onClick={() => setConfirmEnd(false)}>
                Keep playing
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirmEnd(false);
                  onEndGame();
                }}
              >
                Exit to lobby
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmReloadAll ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Reload every player's game"
        >
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-box border-2 border-base-300 bg-base-100 p-5">
            <p className="font-black">Reload every player&apos;s game?</p>
            <p className="text-sm text-base-content/70">
              Every player&apos;s game will reload, and any unsaved progress in the running games
              will be lost. Are you sure?
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="neutral" soft onClick={() => setConfirmReloadAll(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirmReloadAll(false);
                  onReloadAllGames();
                }}
              >
                Reload all
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
