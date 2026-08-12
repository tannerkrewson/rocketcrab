/**
 * The U6 multi-player test arena page.
 *
 * Several simulated players on one screen: each is a real runtime frame
 * (U3) connected through the InMemoryTransport (U5) via its own NovaSession
 * (S1) — the runtime protocol is never bypassed. Desktop shows a responsive
 * grid of player frames with a shared simulation toolbar; phones show one
 * player at a time in tabs with the shared controls in a collapsible panel
 * (never covering the game). Per-player connection state reflects the
 * simulated transport state (disconnect → leave, reconnect → rejoin,
 * suspend → background suspension), and every player's console/errors land
 * in its own log panel.
 */
import type { SavedGame } from "@rocketcrab/core";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Droplets,
  FlaskConical,
  Gauge,
  PartyPopper,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { EmptyState } from "../ui/EmptyState";
import { useRecordTestResults } from "../../lib/games/queries";
import { useArena } from "../../lib/arena/use-arena";
import { runtimeOriginForMainOrigin } from "../../lib/runtime-origin";
import type { ChannelPort } from "../../lib/runtime-host";
import type { ArenaPlayer, ArenaState } from "../../lib/arena/types";

/** Test seams forwarded to RuntimeHostClient (no-op in production). */
export interface ArenaRuntimeSeams {
  createChannel?: () => { port1: ChannelPort; port2: unknown };
  waitForFrameLoad?: (iframe: HTMLIFrameElement) => Promise<void>;
  bootstrapTimeoutMs?: number;
}

export const ArenaRuntimeSeamsContext = createContext<ArenaRuntimeSeams>({});

/** Viewport breakpoint matching the md: grid (desktop arena layout). */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window.matchMedia === "function"
      ? window.matchMedia("(min-width: 768px)").matches
      : true,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { timeStyle: "short" });
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { dateStyle: "medium" });
}

function connectionBadge(player: ArenaPlayer): ReactNode {
  const state = player.connectionState;
  const label =
    state === "connected"
      ? "Connected"
      : state === "joining"
        ? "Joining"
        : state === "suspended"
          ? "Suspended"
          : state === "disconnected"
            ? "Disconnected"
            : "Offline";
  const className =
    state === "connected"
      ? "badge badge-success badge-sm"
      : state === "joining"
        ? "badge badge-info badge-sm"
        : state === "suspended"
          ? "badge badge-warning badge-sm"
          : state === "disconnected"
            ? "badge badge-error badge-sm"
            : "badge badge-ghost badge-sm";
  return (
    <span className={className} title={`Connection state: ${state}`}>
      {label}
    </span>
  );
}

function runStateLabel(player: ArenaPlayer): string {
  switch (player.runState) {
    case "started":
      return "Started";
    case "registered":
      return "Registered";
    case "running":
      return "Running";
    case "loading":
      return "Starting";
    case "pending":
      return "Pending";
    case "failed":
      return "Failed";
  }
}

export interface ArenaPageProps {
  /** Saved game under test (undefined for draft-arena mode). */
  game?: SavedGame;
  /** Editor source override (test the current, possibly unsaved, source). */
  overrideSource?: string;
  /** Draft mode: test an unsaved editor source without a saved game. */
  draftSource?: { gameId: string; source: string };
}

export function ArenaPage({ game, overrideSource, draftSource }: ArenaPageProps) {
  const seams = useContext(ArenaRuntimeSeamsContext);
  const recordTestResults = useRecordTestResults();

  const savedSource = game?.html ?? "";
  const source = overrideSource ?? draftSource?.source ?? savedSource;
  const gameId = game?.id ?? draftSource?.gameId ?? "draft";
  const gameMode = game?.mode ?? "state";

  const onRunSucceeded = useCallback(
    (outcome: { runId: number; source: string }) => {
      if (game === undefined) return;
      // Persist the last successful test time (U2 recordTestResults). Only a
      // clean full run (every player registered + started, no fatal errors)
      // counts as success.
      recordTestResults.mutate({
        id: game.id,
        results: { lastTestedAt: Date.now(), lastTestSucceeded: true },
      });
    },
    [game, recordTestResults],
  );

  const { state, actions, bindContainer } = useArena({
    source,
    gameId,
    gameMode,
    gameTitle: game?.title,
    runtimeOrigin: runtimeOriginForMainOrigin(window.location.origin),
    initialPlayers: [
      { id: "player-1", name: "Player 1", memberId: "member-1" },
      { id: "player-2", name: "Player 2", memberId: "member-2" },
    ],
    seams,
    onRunSucceeded,
  });

  const [activePlayerId, setActivePlayerId] = useState("player-1");
  const [newPlayerName, setNewPlayerName] = useState("");
  const [replaceDialog, setReplaceDialog] = useState(false);
  const [replacementSource, setReplacementSource] = useState(source);
  const [renameTarget, setRenameTarget] = useState<ArenaPlayer | null>(null);

  // Keep the mobile tab on an existing player when players are removed.
  useEffect(() => {
    if (state === null) return;
    if (!state.players.some((player) => player.id === activePlayerId)) {
      setActivePlayerId(state.players[0]?.id ?? "player-1");
    }
  }, [state, activePlayerId]);

  const handleAddPlayer = useCallback(() => {
    actions.addPlayer(newPlayerName);
    setNewPlayerName("");
  }, [actions, newPlayerName]);

  const handleReplaceSource = useCallback(() => {
    const next = replacementSource.trim();
    if (next.length === 0) {
      toast.error("The source can't be empty.");
      return;
    }
    actions.replaceSource(next);
    setReplaceDialog(false);
    toast.success("Source replaced — all players restarted.");
  }, [actions, replacementSource]);

  const handleRename = useCallback(() => {
    if (renameTarget === null) return;
    const input = document.getElementById(
      `arena-name-${renameTarget.id}`,
    ) as HTMLInputElement | null;
    const name = input?.value.trim() ?? "";
    if (name.length > 0) {
      actions.renamePlayer(renameTarget.id, name);
    }
    setRenameTarget(null);
  }, [actions, renameTarget]);

  if (state === null || state.players.length === 0) {
    return (
      <EmptyState
        icon={<FlaskConical />}
        title="Multi-player test arena"
        description="Several simulated players run your game on one page so you can see how it plays before the real party."
      />
    );
  }

  const summary = state.summary;
  const authority = state.authorityPlayerId;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newPlayerName}
          onChange={(event) => setNewPlayerName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleAddPlayer();
          }}
          placeholder="Player name"
          aria-label="New player name"
          maxLength={32}
          className="input input-bordered input-sm w-36"
        />
        <Button
          variant="secondary"
          size="md"
          onClick={handleAddPlayer}
          title="Add a simulated player"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add player
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-base-content/60" aria-hidden="true" />
        <label htmlFor="arena-latency" className="text-xs font-semibold text-base-content/60">
          Latency {state.latencyMs}ms
        </label>
        <input
          id="arena-latency"
          type="range"
          min={0}
          max={1000}
          step={25}
          value={state.latencyMs}
          onChange={(event) => actions.setLatency(Number(event.target.value))}
          className="range range-xs w-32"
          aria-label="Artificial latency"
        />
        <Button
          variant={state.dropMessages ? "accent" : "outline"}
          size="md"
          onClick={() => actions.setDropMessages(!state.dropMessages)}
          title="Toggle simulated message drops on unreliable channels"
        >
          <Droplets className="h-4 w-4" aria-hidden="true" />
          {state.dropMessages ? "Dropping" : "Drop messages"}
        </Button>
      </div>
      <Button
        variant="danger"
        size="md"
        onClick={() => void actions.triggerAuthorityLoss()}
        disabled={authority === null}
        title={`Force the current authority player (${state.players.find((player) => player.id === authority)?.name ?? ""}) to lose its connection`}
      >
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        Authority loss
      </Button>
      <Button
        variant="ghost"
        size="md"
        onClick={actions.clearLogs}
        title="Clear every player's logs"
      >
        <X className="h-4 w-4" aria-hidden="true" />
        Clear logs
      </Button>
      <Button
        variant="outline"
        size="md"
        onClick={() => {
          setReplacementSource(source);
          setReplaceDialog(true);
        }}
        title="Replace the source and restart every player"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Replace source
      </Button>
      <Button
        variant="outline"
        size="md"
        onClick={actions.restartAll}
        title="Restart every simulated player"
      >
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        Restart all
      </Button>
    </div>
  );

  const summaryBar = (
    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-base-content/70">
      <span className="badge badge-ghost badge-sm">
        {summary.registered}/{summary.total} registered
      </span>
      <span className="badge badge-ghost badge-sm">
        {summary.started}/{summary.total} started
      </span>
      {summary.failed > 0 ? (
        <span className="badge badge-error badge-sm">{summary.failed} failed</span>
      ) : null}
      <span
        className={summary.success ? "badge badge-success badge-sm" : "badge badge-ghost badge-sm"}
      >
        {summary.success ? "Test passed" : "Testing…"}
      </span>
      {game?.lastTestedAt !== undefined ? (
        <span>
          Last passed: {formatDate(game.lastTestedAt)}
          {game.lastTestSucceeded === false ? " (failed last time)" : ""}
        </span>
      ) : null}
      <span className="font-mono">run #{state.runId}</span>
    </div>
  );

  const playerCard = (player: ArenaPlayer) => (
    <section
      key={player.id}
      data-testid={`arena-player-${player.id}`}
      className="flex flex-col gap-2 rounded-box border-2 border-base-300 bg-base-100 p-3"
      aria-label={`Player ${player.name}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="font-black hover:underline"
          onClick={() => setRenameTarget(player)}
          title="Rename player"
        >
          {player.name}
        </button>
        {authority === player.id ? (
          <span className="badge badge-accent badge-sm" title="Simulated authority player">
            Authority
          </span>
        ) : null}
        {connectionBadge(player)}
        <span className="badge badge-ghost badge-sm">{runStateLabel(player)}</span>
        <div className="flex-1" />
        {player.sessionStatus === "disconnected" ? (
          <Button
            variant="ghost"
            size="md"
            onClick={() => void actions.reconnectPlayer(player.id)}
            title="Reconnect this player"
          >
            <Wifi className="h-4 w-4" aria-hidden="true" />
            Reconnect
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="md"
            onClick={() => void actions.disconnectPlayer(player.id)}
            disabled={player.connectionState !== "connected"}
            title="Disconnect this player"
          >
            <WifiOff className="h-4 w-4" aria-hidden="true" />
            Disconnect
          </Button>
        )}
        {player.sessionStatus === "suspended" ? (
          <Button
            variant="ghost"
            size="md"
            onClick={() => void actions.resumePlayer(player.id)}
            title="Resume this player from background suspension"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            Resume
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="md"
            onClick={() => void actions.suspendPlayer(player.id)}
            disabled={player.connectionState !== "connected"}
            title="Simulate background suspension (Mobile Safari)"
          >
            <Pause className="h-4 w-4" aria-hidden="true" />
            Suspend
          </Button>
        )}
        <Button
          variant="ghost"
          size="md"
          onClick={() => actions.removePlayer(player.id)}
          title="Remove this player"
          aria-label={`Remove ${player.name}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-base-content/60">
        <span className="font-mono">{player.memberId}</span>
        {player.registered ? (
          <span>
            “{player.registered.title}” · {player.registered.gameMode} mode
          </span>
        ) : player.loadError !== null ? (
          <span className="text-error">Startup failed: {player.loadError}</span>
        ) : (
          <Activity className="h-3 w-3" aria-hidden="true" />
        )}
        <span className="flex-1" />
        {player.sessionStatus !== "disconnected" && player.sessionStatus !== "connected" ? (
          <span>session: {player.sessionStatus}</span>
        ) : null}
      </div>
      <div
        className="h-52 overflow-hidden rounded-box border border-base-300 bg-black"
        data-testid={`arena-frame-${player.id}`}
      >
        <div ref={bindContainer(player.id)} className="h-full w-full" />
      </div>
      <div
        className="max-h-32 min-h-16 overflow-y-auto rounded-box border border-base-300 bg-base-200 p-2 font-mono text-[11px] leading-relaxed"
        data-testid={`arena-logs-${player.id}`}
        aria-label={`Logs for ${player.name}`}
      >
        {player.logs.length === 0 ? (
          <span className="text-base-content/40">No log entries yet.</span>
        ) : (
          player.logs.map((entry) => (
            <div
              key={entry.id}
              className={
                entry.level === "error"
                  ? "text-error"
                  : entry.level === "warn"
                    ? "text-warning"
                    : entry.level === "info"
                      ? "text-info"
                      : "text-base-content/80"
              }
            >
              <span className="opacity-60">[{formatTime(entry.timestamp)}]</span> {entry.message}
              {entry.details !== undefined ? (
                <span className="opacity-70"> {entry.details}</span>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-black">Test arena</h1>
          <p className="text-sm text-base-content/70">
            {game !== undefined ? `“${game.title}” · ` : ""}
            {overrideSource !== undefined && game !== undefined
              ? "testing the editor's unsaved source"
              : `${summary.total} simulated players on this page`}
          </p>
        </div>
        {game !== undefined ? (
          <Link
            to="/party"
            search={{ gameId: game.id, mode: game.mode ?? "state", title: game.title }}
            className="btn btn-secondary btn-md font-bold"
            title="Launch this game into a real party"
          >
            <PartyPopper className="h-4 w-4" aria-hidden="true" />
            Play with friends
          </Link>
        ) : null}
        <Link to="/library" className="btn btn-ghost btn-sm font-bold">
          Back to games
        </Link>
      </header>

      {summaryBar}

      {/* Desktop: shared toolbar above a responsive grid of player frames. */}
      <div className="hidden flex-col gap-3 md:flex" data-testid="arena-desktop">
        <div className="flex flex-wrap items-center gap-2 rounded-box border-2 border-base-300 bg-base-100 p-3">
          {toolbar}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {state.players.map(playerCard)}
        </div>
      </div>

      {/* Phone: one player frame at a time; shared controls in a
          collapsible panel so they never cover the game. */}
      <div className="flex flex-col gap-3 md:hidden" data-testid="arena-mobile">
        <div
          role="tablist"
          aria-label="Simulated players"
          className="tabs tabs-box overflow-x-auto"
        >
          {state.players.map((player) => (
            <button
              key={player.id}
              role="tab"
              type="button"
              aria-selected={activePlayerId === player.id}
              className={`tab tab-sm whitespace-nowrap ${activePlayerId === player.id ? "tab-active" : ""}`}
              onClick={() => setActivePlayerId(player.id)}
            >
              {player.name}
            </button>
          ))}
        </div>
        <details className="collapse collapse-arrow border-2 border-base-300 bg-base-100">
          <summary className="collapse-title text-sm font-bold">Simulation controls</summary>
          <div className="collapse-content">{toolbar}</div>
        </details>
        {/* Every frame stays mounted so switching tabs never reloads it. */}
        {state.players.map((player) => (
          <div key={player.id} className={activePlayerId === player.id ? "" : "hidden"}>
            {playerCard(player)}
          </div>
        ))}
      </div>

      <Dialog open={replaceDialog} onClose={() => setReplaceDialog(false)} title="Replace source">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-base-content/70">
            Replacing the source destroys every current runtime frame and restarts all players with
            the new source. Unsaved editor changes are not affected.
          </p>
          <textarea
            value={replacementSource}
            onChange={(event) => setReplacementSource(event.target.value)}
            aria-label="Replacement game source"
            spellCheck={false}
            className="textarea textarea-bordered h-64 w-full font-mono text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReplaceDialog(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleReplaceSource}>
              Replace and restart all
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title={`Rename ${renameTarget?.name ?? "player"}`}
      >
        {renameTarget !== null ? (
          <div className="flex flex-col gap-3">
            <input
              id={`arena-name-${renameTarget.id}`}
              type="text"
              defaultValue={renameTarget.name}
              maxLength={32}
              aria-label="Player name"
              className="input input-bordered"
              onKeyDown={(event) => {
                if (event.key === "Enter") handleRename();
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRenameTarget(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleRename}>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
                Rename
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
