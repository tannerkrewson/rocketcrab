import {
  ArrowLeft,
  BookOpen,
  Eraser,
  Gamepad2,
  Menu,
  OctagonX,
  RotateCcw,
  Terminal,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge } from "../ui/Badge";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "../../lib/toast";
import { writeToClipboard } from "../../lib/editor/clipboard";
import { clearBrowseContext } from "../../lib/browse/back-context";
import { cn } from "../../lib/cn";
import type { PartyEngineState } from "../../lib/party/engine";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { GameBrowser } from "./GameBrowser";
import { PartyGameDetailsModal } from "./PartyGameDetails";
import { PartyInvite } from "./PartyInvite";

export interface PartyPlayShellProps {
  state: PartyEngineState;
  /** The game frame area (the Nova runtime container or an external iframe). */
  children: ReactNode;
  onEndGame: () => void;
  onLeave: () => void;
  onReloadMyGame: () => void;
  /** Host-only: reload every player's frame. */
  onReloadAllGames: () => void;
  /** Host-only: remove a member after confirmation. */
  onKickMember: (memberId: string) => void;
  onSwitchGame: (gameId: string) => Promise<void>;
  onClearLogs?: () => void;
}

/** Panels are mutually exclusive; logs are available only for Nova games. */
type PlayShellPanel = "menu" | "players" | "browse" | "logs" | null;

/**
 * In-game controls stay outside the game frame so game code cannot disable
 * emergency teardown. Everyone can browse while the game remains mounted.
 */
export function PartyPlayShell({
  state,
  children,
  onEndGame,
  onReloadMyGame,
  onReloadAllGames,
  onKickMember,
  onSwitchGame,
  onClearLogs,
}: PartyPlayShellProps) {
  const [barHidden, setBarHidden] = useState(false);
  const [panel, setPanel] = useState<PlayShellPanel>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmKickMemberId, setConfirmKickMemberId] = useState<string | null>(null);
  const [libraryGame, setLibraryGame] = useState<{ gameId: string; title: string } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmReloadMine, setConfirmReloadMine] = useState(false);
  const [confirmReloadAll, setConfirmReloadAll] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    if (panel === null || libraryGame !== null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPanel(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panel, libraryGame]);

  useEffect(() => {
    if (!state.switchingGame) return;
    setPanel(null);
    setLibraryGame(null);
    setDetailsOpen(false);
  }, [state.switchingGame]);

  const copyInvite = async () => {
    if (state.inviteUrl === null) return;
    const ok = await writeToClipboard(state.inviteUrl);
    if (ok) {
      toast.success("Invite link copied.");
    } else {
      toast.danger("Couldn't copy the invite link.");
    }
  };

  const menuOpen = panel === "menu";

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black" data-testid="party-play-view">
      {!barHidden ? (
        <header className="relative z-50 grid grid-cols-[1fr_auto_1fr] items-center gap-2 bg-overlay px-3 pb-2 pt-safe">
          <Button
            size="sm"
            variant="tertiary"
            className="justify-self-start"
            onClick={() => setBarHidden(true)}
            aria-label="Hide the top bar"
            title="Hide the top bar"
          >
            <img src="/rocketcrab-logo-no-glow.svg" alt="" width={26} height={26} />
          </Button>

          <Button
            variant="tertiary"
            size="sm"
            className="h-auto px-0 font-title text-lg font-black whitespace-nowrap md:text-xl"
            onPress={() => void copyInvite()}
            disabled={state.inviteUrl === null}
            title="Copy the invite link"
            aria-label="Copy the invite link"
          >
            <span>
              rocketcrab<span className="text-primary">.com</span>
            </span>
          </Button>

          <Button
            size="sm"
            variant="tertiary"
            className="justify-self-end"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setPanel(menuOpen ? null : "menu")}
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
            <span className="hidden min-[384px]:inline">Menu</span>
          </Button>

          {menuOpen ? (
            <ul
              className="absolute right-0 top-full z-50 flex w-max min-w-56 flex-col rounded-b-2xl bg-overlay p-1.5 shadow-overlay"
              role="menu"
              aria-label="Game menu"
            >
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm font-bold hover:bg-surface-secondary"
                  onClick={() => {
                    setPanel(null);
                    setInviteOpen(true);
                  }}
                >
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  Invite friends
                </button>
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm font-bold hover:bg-surface-secondary"
                  onClick={() => setPanel("players")}
                >
                  <Users className="h-4 w-4" aria-hidden="true" />
                  Players
                </button>
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm font-bold hover:bg-surface-secondary disabled:opacity-50"
                  disabled={state.switchingGame}
                  onClick={() => {
                    clearBrowseContext();
                    setPanel("browse");
                  }}
                >
                  <Gamepad2 className="h-4 w-4" aria-hidden="true" />
                  Browse games
                </button>
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm font-bold hover:bg-surface-secondary"
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
              {/* External iframes do not emit runtime console logs. */}
              {state.game?.kind === "nova" ? (
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm font-bold hover:bg-surface-secondary"
                    onClick={() => setPanel("logs")}
                  >
                    <Terminal className="h-4 w-4" aria-hidden="true" />
                    Logs
                  </button>
                </li>
              ) : null}
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm font-bold hover:bg-surface-secondary"
                  onClick={() => {
                    setPanel(null);
                    setConfirmReloadMine(true);
                  }}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Reload my game
                </button>
              </li>
              {state.amHost ? (
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm font-bold hover:bg-surface-secondary"
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
              {state.amHost ? (
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm font-bold hover:bg-surface-secondary"
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

      <div className="relative min-h-0 flex-1">
        {children}

        {panel === "players" ? (
          <>
            <div
              className="absolute inset-0 z-40"
              onClick={() => setPanel(null)}
              aria-hidden="true"
              data-testid="players-popup-backdrop"
            />
            <div
              className="absolute left-1/2 top-3 z-50 flex max-h-[calc(100%-1.5rem)] w-[min(28rem,calc(100%-1.5rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl bg-overlay shadow-overlay"
              role="dialog"
              aria-label="Players"
            >
              <div className="flex items-center gap-2 bg-surface-secondary px-3 py-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setPanel(null)}
                  aria-label="Back to the game"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Back
                </Button>
                <p className="font-black">Players ({state.members.length})</p>
                <div className="min-w-0 flex-1" />
              </div>
              <div className="min-h-0 overflow-y-auto p-3">
                <ul className="flex flex-col gap-2">
                  {state.members.map((member) => (
                    <li
                      key={member.memberId}
                      className="flex items-center gap-2 rounded-2xl bg-surface-secondary px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate font-bold">
                        {member.displayName}
                        {member.isSelf ? <span className="text-foreground/50"> (you)</span> : null}
                      </span>
                      {member.connected ? (
                        <Badge color="success">Connected</Badge>
                      ) : (
                        <Badge color="danger">Disconnected</Badge>
                      )}
                      {state.amHost && !member.isSelf ? (
                        <Button
                          size="sm"
                          variant="danger"
                          soft
                          onClick={() => setConfirmKickMemberId(member.memberId)}
                        >
                          Kick<span className="sr-only"> {member.displayName}</span>
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        ) : null}

        {panel === "logs" ? (
          <>
            <div
              className="absolute inset-0 z-40"
              onClick={() => setPanel(null)}
              aria-hidden="true"
              data-testid="logs-panel-backdrop"
            />
            <div
              className="absolute left-1/2 top-3 z-50 flex max-h-[calc(100%-1.5rem)] w-[min(32rem,calc(100%-1.5rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl bg-overlay shadow-overlay"
              role="dialog"
              aria-label="Logs"
            >
              <div className="flex items-center gap-2 bg-surface-secondary px-3 py-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setPanel(null)}
                  aria-label="Back to the game"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Back
                </Button>
                <p className="font-black">Logs</p>
                <div className="min-w-0 flex-1" />
                <Button
                  size="sm"
                  variant="tertiary"
                  onClick={() => onClearLogs?.()}
                  disabled={state.runtimeLogs.length === 0}
                  title="Clear these logs"
                >
                  <Eraser className="h-4 w-4" aria-hidden="true" />
                  Clear
                </Button>
              </div>
              <div className="min-h-0 overflow-y-auto p-3">
                {state.runtimeLogs.length === 0 ? (
                  <p className="rounded-2xl bg-surface-secondary p-6 text-center text-sm text-foreground/60">
                    No logs yet — the game&apos;s console output will appear here.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5 font-mono text-xs">
                    {state.runtimeLogs.map((entry) => (
                      <li
                        key={entry.id}
                        className={cn(
                          "break-words rounded-2xl bg-surface-secondary px-2.5 py-1.5",
                          entry.level === "error" && "bg-danger/10 text-danger",
                          entry.level === "warn" && "bg-warning/10 text-warning",
                        )}
                      >
                        <span className="mr-2 text-foreground/40">
                          {new Date(entry.timestamp).toLocaleTimeString([], {
                            hour12: false,
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                        <span className="font-bold">{entry.level}</span>
                        <span className="ml-2">{entry.message}</span>
                        {entry.details !== undefined ? (
                          <pre className="mt-1 whitespace-pre-wrap text-[10px] text-foreground/60">
                            {entry.details}
                          </pre>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        ) : null}

        {/* Bound the browser overlay so the running game stays mounted and
             emergency controls remain usable above it. */}
        {panel === "browse" && !state.switchingGame ? (
          <>
            <div
              className="absolute inset-0 z-40"
              onClick={() => setPanel(null)}
              aria-hidden="true"
              data-testid="browse-panel-backdrop"
            />
            <div
              className="absolute left-1/2 top-3 z-50 flex max-h-[calc(100%-1.5rem)] w-[min(42rem,calc(100%-1.5rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl bg-overlay shadow-overlay"
              role="dialog"
              aria-label="Pick a game"
            >
              <div className="flex items-center gap-2 bg-surface-secondary px-3 py-2">
                <p className="font-black">Pick a game</p>
              </div>
              <div className="min-h-0 overflow-y-auto p-3 md:p-4">
                <GameBrowser
                  compact
                  onShowDetails={setLibraryGame}
                  // Close the panel; fallback navigation to the current party route would be a no-op.
                  onBack={() => setPanel(null)}
                  inParty
                />
              </div>
            </div>
          </>
        ) : null}
      </div>

      {barHidden ? (
        <Button
          size="sm"
          variant="secondary"
          className="absolute left-[max(0.5rem,env(safe-area-inset-left))] top-[max(0.5rem,env(safe-area-inset-top))] z-50 opacity-80 hover:opacity-100"
          onClick={() => setBarHidden(false)}
          aria-label="Show the top bar"
          title="Show the top bar"
        >
          <img src="/rocketcrab-logo-no-glow.svg" alt="" width={28} height={28} />
        </Button>
      ) : null}

      {libraryGame !== null && !state.switchingGame ? (
        <PartyGameDetailsModal
          key={libraryGame.gameId}
          game={libraryGame}
          onClose={() => setLibraryGame(null)}
          onSwitch={
            state.amHost && libraryGame.gameId !== state.game?.gameId
              ? async () => {
                  await onSwitchGame(libraryGame.gameId);
                  setLibraryGame(null);
                  setPanel(null);
                }
              : undefined
          }
        />
      ) : null}

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
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-overlay p-5 shadow-overlay">
            <p className="font-black">Exit to the lobby?</p>
            <p className="text-sm text-foreground/70">
              Every player&apos;s game will end and the party will return to the lobby. This is the
              emergency stop — game code cannot disable it.
            </p>
            <div className="button-row self-end">
              <Button variant="default" soft onClick={() => setConfirmEnd(false)}>
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

      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Get your friends to join!"
        className="max-w-md"
      >
        <div className="flex justify-center pb-2">
          <PartyInvite inviteUrl={state.inviteUrl} />
        </div>
      </Dialog>
      <Dialog
        open={confirmReloadMine}
        onClose={() => setConfirmReloadMine(false)}
        title="Reload my game?"
        className="sm:max-w-sm"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-foreground/80">
            Reloading can fix a frozen or blank game screen. You may lose unsaved progress on this
            device.
          </p>
          <div className="button-row self-end">
            <Button variant="secondary" autoFocus onPress={() => setConfirmReloadMine(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onPress={() => {
                setConfirmReloadMine(false);
                onReloadMyGame();
              }}
            >
              Reload my game
            </Button>
          </div>
        </div>
      </Dialog>

      {confirmReloadAll ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Reload every player's game"
        >
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-overlay p-5 shadow-overlay">
            <p className="font-black">Reload every player&apos;s game?</p>
            <p className="text-sm text-foreground/70">
              Every player&apos;s game will reload, and any unsaved progress in the running games
              will be lost. Are you sure?
            </p>
            <div className="button-row self-end">
              <Button variant="default" soft onClick={() => setConfirmReloadAll(false)}>
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

      {confirmKickMemberId !== null ? (
        <PartyKickConfirm
          memberName={
            state.members.find((member) => member.memberId === confirmKickMemberId)?.displayName ??
            confirmKickMemberId
          }
          onCancel={() => setConfirmKickMemberId(null)}
          onConfirm={() => {
            setConfirmKickMemberId(null);
            onKickMember(confirmKickMemberId);
          }}
        />
      ) : null}
    </div>
  );
}

function PartyKickConfirm({
  memberName,
  onCancel,
  onConfirm,
}: {
  memberName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Kick a player from the party"
    >
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-overlay p-5 shadow-overlay">
        <p className="font-black">Kick {memberName} from the party?</p>
        <p className="text-sm">
          This removes them for now, not permanently. They can rejoin with the same private invite.
        </p>
        <p className="text-sm text-foreground/70">
          {memberName} will be removed from the party and will have to rejoin with the invite link.
        </p>
        <div className="button-row self-end">
          <Button variant="default" soft onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Kick player
          </Button>
        </div>
      </div>
    </div>
  );
}
