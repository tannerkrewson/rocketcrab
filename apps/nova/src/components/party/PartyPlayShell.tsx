import {
  ArrowLeft,
  BookOpen,
  Eraser,
  Gamepad2,
  Menu,
  OctagonX,
  RotateCcw,
  Terminal,
  Users,
} from "lucide-react";
import { Badge } from "../ui/Badge";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "../../lib/toast";
import type { BrowseEntry } from "../../lib/browse";
import { writeToClipboard } from "../../lib/editor/clipboard";
import { cn } from "../../lib/cn";
import type { PartyEngineState } from "../../lib/party/engine";
import { ThemeSelector } from "../layout/ThemeSelector";
import { BrandLogo } from "../layout/BrandLogo";
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
  /** 5cl.11: clear the runtime console ring buffer (Logs panel). */
  onClearLogs?: () => void;
}

/** Which single panel is open (7.38: the panels are mutually exclusive).
 *  5cl.11: "logs" is the in-game runtime console panel (nova games only). */
type PlayShellPanel = "menu" | "players" | "browse" | "logs" | null;

/**
 * The play shell (P4 / 7.4, redesigned for classic parity in 7.38): the
 * in-game chrome sits IN FLOW ABOVE the game frame — a compact top bar
 * (the SVG brand logo collapses to a bare floating logo on tap, a centered
 * rocketcrab.com/CODE URL copies the invite, and a Menu dropdown opens a
 * compact, flush dropdown), plus a Players POPUP (7.45: a compact overlay
 * anchored top-center BELOW the top bar - never a full-page takeover, so
 * the game keeps running underneath) and the shared pick-a-game browser.
 * The menu (9fv.11.11) holds Browse games (host only — picking a game
 * while playing ends it for everyone) and About this game (the party's
 * in-game details overlay), and since i47
 * the light/dark/system theme control lives at the bottom of the same menu
 * (the in-game shell no longer has a floating copy); leaving the
 * party happens back in the lobby. ch6: the in-game mark is the
 * non-glowing brand logo, sized up without growing the bar. Minimal
 * chrome, the code front and center: classic parity. The emergency
 * teardown ("Exit to lobby") lives here, outside the game frame (T6/T21 —
 * game code cannot disable it); game-end returns everyone to the lobby.
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
  onClearLogs,
}: PartyPlayShellProps) {
  // 7.38: the top bar can collapse to just the floating logo (classic's
  // minimal-chrome mode) so the game gets the whole screen.
  const [barHidden, setBarHidden] = useState(false);
  // 7.38: only one panel is open at a time (menu / players / browse).
  const [panel, setPanel] = useState<PlayShellPanel>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  // 2z9: removing a player exits them from the party — a mis-tap boots
  // someone out, so the kick buttons ask first (like Reload all / Exit).
  const [confirmKickMemberId, setConfirmKickMemberId] = useState<string | null>(null);
  // 9fv.11.11: "About this game" opens the in-game details overlay.
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
      toast.danger("Couldn't copy the invite link.");
    }
  };

  // 7.38: the top bar shows the party URL (the code) instead of the game
  // name — classic parity (the code front and center).
  const roomUrl = "Nova party";
  const menuOpen = panel === "menu";

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black" data-testid="party-play-view">
      {!barHidden ? (
        <header className="relative z-50 flex items-center gap-2 border-b-2 border-border bg-surface px-3 pb-2 pt-safe">
          {/* 5cl.14: while the navbar is showing, the logo sits bare on the
              bar — no btn background/border/shadow (that chrome only
              returns on the floating collapsed-mode logo below). hover/
              active keep a subtle fill so the tap target still reads as
              tappable. ch6: the in-game mark is the non-glowing brand
              logo, sized up without growing the bar (the btn-sm box
              already fixes the bar row's height). */}
          <Button
            size="sm"
            variant="tertiary"
            className="shrink-0"
            onClick={() => setBarHidden(true)}
            aria-label="Hide the top bar"
            title="Hide the top bar"
          >
            <BrandLogo variant="no-glow" size={26} className="shrink-0" />
          </Button>

          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <button
              type="button"
              // 0dd: the URL gets the same press feedback as the homepage
              // title (rocketcrab-2t1.8) — scale down while pressed.
              className="font-title whitespace-nowrap text-lg font-black text-foreground transition-transform active:scale-95 md:text-xl"
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
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            aria-expanded={menuOpen}
            onClick={() => setPanel(menuOpen ? null : "menu")}
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
            Menu
          </Button>

          {/* 7.38: the menu is a compact dropdown directly under the Menu
              button, sized to its content and flush with the top bar. */}
          {menuOpen ? (
            <ul
              className="absolute right-0 top-full z-50 flex w-max min-w-56 flex-col rounded-b-box border-2 border-t-0 border-border bg-surface p-1.5 shadow-lg"
              role="menu"
              aria-label="Game menu"
            >
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
              {/* 9fv.11.11: Browse games moved from the Players popup into the
                  menu (host only — picking a game while playing ends it for
                  everyone, so joiners never see it). */}
              {state.amHost ? (
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm font-bold hover:bg-surface-secondary"
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
              {/* 5cl.11: runtime console logs — nova-mode games only (classic
                  games run in their own iframe and emit nothing here). */}
              {state.classicGame === null && state.game !== null ? (
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
                    onReloadMyGame();
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
                    className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm font-bold text-danger hover:bg-surface-secondary"
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
                    className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm font-bold text-danger hover:bg-surface-secondary"
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
              {/* i47: the light/dark/system theme control lives INSIDE the
                  menu now (below every menu item) — the in-game shell's
                  old floating bottom-right control is gone. */}
              <li role="separator" aria-hidden="true" className="my-1 border-t-2 border-border" />
              <li>
                <div className="flex items-center justify-center px-3 py-1.5">
                  <ThemeSelector />
                </div>
              </li>
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
              className="absolute left-1/2 top-3 z-50 flex max-h-[calc(100%-1.5rem)] w-[min(28rem,calc(100%-1.5rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border-2 border-border bg-surface shadow-xl"
              role="dialog"
              aria-label="Players"
            >
              <div className="flex items-center gap-2 border-b-2 border-border px-3 py-2">
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
                      className="flex items-center gap-2 rounded-2xl border-2 border-border bg-surface px-3 py-2 text-sm"
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
                          title={`Remove ${member.displayName} from the party`}
                        >
                          Kick
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        ) : null}

        {/* 5cl.11: the Logs panel — the game's runtime console output for
            the user's own (nova-mode) games. Compact overlay like the
            players popup; the game keeps running underneath. */}
        {panel === "logs" ? (
          <>
            <div
              className="absolute inset-0 z-40"
              onClick={() => setPanel(null)}
              aria-hidden="true"
              data-testid="logs-panel-backdrop"
            />
            <div
              className="absolute left-1/2 top-3 z-50 flex max-h-[calc(100%-1.5rem)] w-[min(32rem,calc(100%-1.5rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border-2 border-border bg-surface shadow-xl"
              role="dialog"
              aria-label="Logs"
            >
              <div className="flex items-center gap-2 border-b-2 border-border px-3 py-2">
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
                  variant="outline"
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
                  <p className="rounded-2xl border-2 border-dashed border-border p-6 text-center text-sm text-foreground/60">
                    No logs yet — the game&apos;s console output will appear here.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5 font-mono text-xs">
                    {state.runtimeLogs.map((entry) => (
                      <li
                        key={entry.id}
                        className={cn(
                          "break-words rounded-2xl border-2 border-border bg-surface-secondary/50 px-2.5 py-1.5",
                          entry.level === "error" && "border-danger/40 text-danger",
                          entry.level === "warn" && "border-warning/40 text-warning",
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

        {/* 7.43: pick a game - the SAME shared browse UI as /browse, in pick
             mode, so the host can switch the game without leaving the party.
             7.45 / aqn-ui-party: a bounded overlay keeps the running game
             mounted underneath and leaves the top bar/emergency controls
             usable. 9fv.11.11: opened from the menu; Back returns to the game. */}
        {panel === "browse" ? (
          <>
            <div
              className="absolute inset-0 z-40"
              onClick={() => setPanel(null)}
              aria-hidden="true"
              data-testid="browse-panel-backdrop"
            />
            <div
              className="absolute left-1/2 top-3 z-50 flex max-h-[calc(100%-1.5rem)] w-[min(42rem,calc(100%-1.5rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border-2 border-border bg-surface shadow-xl"
              role="dialog"
              aria-label="Pick a game"
            >
              <div className="flex items-center gap-2 border-b-2 border-border px-3 py-2">
                <Button
                  variant="default"
                  size="md"
                  onClick={() => setPanel(null)}
                  aria-label="Back to the game"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Back
                </Button>
                <p className="font-black">Pick a game</p>
              </div>
              <div className="min-h-0 overflow-y-auto p-3 md:p-4">
                <GameBrowser
                  compact
                  onPick={onPickPrebuilt}
                  onPickSaved={onPickGame}
                  // 2t1.1 coordination: the unified back button closes the
                  // in-game browse panel (the fallback navigate would be a
                  // no-op from the party route).
                  onBack={() => setPanel(null)}
                  inParty
                />
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* i47: the in-game theme control moved INTO the Menu dropdown — the
          floating bottom-right copy is gone from this shell (the comment
          below is where it lived, 11.1). */}

      {/* 7.38: collapsed mode — only the floating logo remains; tap to
          reopen the full top bar. ch6: the collapsed mark is the
          non-glowing logo, larger (fits comfortably in the btn-sm tap
          target). */}
      {barHidden ? (
        <Button
          size="sm"
          variant="secondary"
          className="absolute left-[max(0.5rem,env(safe-area-inset-left))] top-[max(0.5rem,env(safe-area-inset-top))] z-50 opacity-80 hover:opacity-100"
          onClick={() => setBarHidden(false)}
          aria-label="Show the top bar"
          title="Show the top bar"
        >
          <BrandLogo variant="no-glow" size={28} />
        </Button>
      ) : null}

      {/* 9fv.11.11: About this game opens the in-game details overlay (title /
          description / how-to-play); the game keeps running underneath. */}
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
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border-2 border-border bg-surface p-5">
            <p className="font-black">Exit to the lobby?</p>
            <p className="text-sm text-foreground/70">
              Every player&apos;s game will end and the party will return to the lobby. This is the
              emergency stop — game code cannot disable it.
            </p>
            <div className="flex justify-end gap-2">
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

      {confirmReloadAll ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Reload every player's game"
        >
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border-2 border-border bg-surface p-5">
            <p className="font-black">Reload every player&apos;s game?</p>
            <p className="text-sm text-foreground/70">
              Every player&apos;s game will reload, and any unsaved progress in the running games
              will be lost. Are you sure?
            </p>
            <div className="flex justify-end gap-2">
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

      {/* 2z9: kicking asks first — a mis-tap would boot a player from the
          party (mirrors the confirmEnd/confirmReloadAll pattern above). */}
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

/** 2z9: shared kick-confirmation dialog (host only, in-game + lobby). */
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
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border-2 border-border bg-surface p-5">
        <p className="font-black">Kick {memberName} from the party?</p>
        <p className="text-sm">
          This removes them for now, not permanently. They can rejoin with the same private invite.
        </p>
        <p className="text-sm text-foreground/70">
          {memberName} will be removed from the party and will have to rejoin with the invite link.
        </p>
        <div className="flex justify-end gap-2">
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
