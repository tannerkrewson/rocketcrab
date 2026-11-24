/**
 * Multiplayer arena embedded in the editor. Each player has a real runtime
 * frame and its own NovaSession over InMemoryTransport. New source restarts
 * all players. Desktop and mobile share mounted frames, with separate
 * per-player logs and controls that exercise transport lifecycle behavior.
 */
import { Badge } from "../ui/Badge";
import { useWindowPointerDrag } from "../ui/useWindowPointerDrag";
import { diagnosticFromBandwidthLog, type Diagnostic } from "../../lib/editor/diagnostics";
import type { SavedGame } from "@rocketcrab/core";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bug,
  Gauge,
  GripHorizontal,
  GripVertical,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { cn } from "../../lib/cn";
import { useRecordTestResults } from "../../lib/games/queries";
import { useArena } from "../../lib/arena/use-arena";
import { getSavedPlayerName } from "../../lib/party/identity";
import { runtimeOriginForMainOrigin } from "../../lib/runtime-origin";
import type { ChannelPort } from "../../lib/runtime-host";
import type { ArenaPlayer } from "../../lib/arena/types";

/** Test seams forwarded to RuntimeHostClient (no-op in production). */
export interface ArenaRuntimeSeams {
  createChannel?: () => { port1: ChannelPort; port2: unknown };
  waitForFrameLoad?: (iframe: HTMLIFrameElement) => Promise<void>;
  bootstrapTimeoutMs?: number;
}

export const ArenaRuntimeSeamsContext = createContext<ArenaRuntimeSeams>({});

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { timeStyle: "short" });
}

function defaultFrameHeightPx(): number {
  return clampFrameHeight(
    Math.round((typeof window === "undefined" ? 800 : window.innerHeight) * 0.45),
  );
}

function clampFrameHeight(value: number): number {
  const max = typeof window === "undefined" ? 1200 : Math.round(window.innerHeight * 0.8);
  return Math.min(Math.max(value, 160), max);
}

function clampFrameWidth(value: number): number {
  const max =
    typeof window === "undefined" ? 1200 : Math.max(320, Math.round(window.innerWidth * 0.92));
  return Math.min(Math.max(value, 240), max);
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
  const color =
    state === "connected"
      ? "success"
      : state === "joining"
        ? "accent"
        : state === "suspended"
          ? "warning"
          : state === "disconnected"
            ? "danger"
            : "default";
  return (
    <Badge color={color} title={`Connection state: ${state}`}>
      {label}
    </Badge>
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

export interface ArenaSectionProps {
  /** Saved game under test (undefined for a blank-editor draft run). */
  game?: SavedGame;
  /** Source frozen at the last Run; changing it restarts every player. */
  source: string;
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

export function ArenaSection({ game, source, onDiagnostics }: ArenaSectionProps) {
  const seams = useContext(ArenaRuntimeSeamsContext);
  const recordTestResults = useRecordTestResults();

  const gameId = game?.id ?? "draft";

  const onRunSucceeded = useCallback(
    (_outcome: { runId: number; source: string }) => {
      if (game === undefined) return;
      // Only a complete run with every player started and no fatal errors counts as success.
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
    gameTitle: game?.title,
    runtimeOrigin: runtimeOriginForMainOrigin(window.location.origin),
    initialPlayers: [
      { id: "player-1", name: getSavedPlayerName() ?? "Player 1", memberId: "member-1" },
      { id: "player-2", name: "Player 2", memberId: "member-2" },
    ],
    seams,
    onRunSucceeded,
  });

  const reportedBandwidthLogs = useRef(new Set<string>());
  useEffect(() => {
    const diagnostics: Diagnostic[] = [];
    for (const player of state?.players ?? []) {
      for (const entry of player.logs) {
        const key = `${player.id}:${entry.id}`;
        if (reportedBandwidthLogs.current.has(key)) continue;
        const diagnostic = diagnosticFromBandwidthLog({ ...entry, id: key });
        if (diagnostic !== null) {
          reportedBandwidthLogs.current.add(key);
          diagnostics.push(diagnostic);
        }
      }
    }
    if (diagnostics.length > 0) onDiagnostics?.(diagnostics);
  }, [state?.players, onDiagnostics]);

  // Replace source inside the existing engine rather than remounting the arena.
  const lastSourceRef = useRef(source);
  useEffect(() => {
    if (lastSourceRef.current === source) return;
    lastSourceRef.current = source;
    actions.replaceSource(source);
  }, [actions, source]);

  const [activePlayerId, setActivePlayerId] = useState("player-1");
  // Network simulation, per-player connection controls and logs.
  const [advanced, setAdvanced] = useState(false);
  const [frameHeightPx, setFrameHeightPx] = useState(defaultFrameHeightPx);
  // null = the frame fills its grid cell (no fixed width); a drag fixes a
  // shared pixel width for every frame, session-local like the height.
  const [frameWidthPx, setFrameWidthPx] = useState<number | null>(null);
  const [renameTarget, setRenameTarget] = useState<ArenaPlayer | null>(null);

  useEffect(() => {
    if (state === null) return;
    if (!state.players.some((player) => player.id === activePlayerId)) {
      setActivePlayerId(state.players[0]?.id ?? "player-1");
    }
  }, [state, activePlayerId]);

  const handleAddPlayer = useCallback(() => {
    actions.addPlayer("");
  }, [actions]);

  const beginWindowDrag = useWindowPointerDrag();

  const handleFrameResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      const startY = event.clientY;
      const startHeight = frameHeightPx;
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture unavailable (some test environments); the window
        // listeners below still track the drag.
      }
      beginWindowDrag((moveEvent) => {
        setFrameHeightPx(clampFrameHeight(startHeight + (moveEvent.clientY - startY)));
      });
    },
    [beginWindowDrag, frameHeightPx],
  );

  const handleFrameWidthResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      const startX = event.clientX;
      // Seed from rendered width so the first drag from auto sizing does not jump.
      const frame = handle.previousElementSibling as HTMLElement | null;
      const startWidth = frameWidthPx ?? (frame?.offsetWidth || 480);
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture unavailable (some test environments); the window
        // listeners below still track the drag.
      }
      beginWindowDrag((moveEvent) => {
        setFrameWidthPx(clampFrameWidth(startWidth + (moveEvent.clientX - startX)));
      });
    },
    [beginWindowDrag, frameWidthPx],
  );

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

  if (state === null) {
    return null;
  }

  const summary = state.summary;
  const authority = state.authorityPlayerId;

  /** Simulation toolbar. Everyday actions up front; network simulation
   *  only with Advanced. `idPrefix` keeps the latency slider ids unique. */
  const toolbar = (idPrefix: string) => {
    const latencyId = `arena-latency-${idPrefix}`;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="default" soft size="md" onClick={handleAddPlayer} title="Add a player">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add player
        </Button>
        <Button
          variant="default"
          soft
          size="md"
          onClick={actions.restartAll}
          title="Restart the game for every player"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Restart
        </Button>
        <Button
          variant={advanced ? "accent" : "default"}
          soft={!advanced}
          size="md"
          onClick={() => setAdvanced((open) => !open)}
          aria-pressed={advanced}
          title="Show network simulation, per-player connection controls and logs"
        >
          <Bug className="h-4 w-4" aria-hidden="true" />
          Advanced
        </Button>
        {advanced ? (
          <>
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-foreground/60" aria-hidden="true" />
              <label htmlFor={latencyId} className="text-xs font-semibold text-foreground/60">
                Latency {state.latencyMs}ms
              </label>
              <input
                id={latencyId}
                type="range"
                min={0}
                max={1000}
                step={25}
                value={state.latencyMs}
                onChange={(event) => actions.setLatency(Number(event.target.value))}
                className="w-32 accent-primary"
                aria-label="Artificial latency"
              />
            </div>
            <Button
              variant="danger"
              soft
              size="md"
              onClick={() => void actions.triggerAuthorityLoss()}
              disabled={authority === null}
              title={`Force the current authority player (${state.players.find((player) => player.id === authority)?.name ?? ""}) to lose its connection`}
            >
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Authority loss
            </Button>
            <Button
              variant="default"
              soft
              size="md"
              onClick={actions.clearLogs}
              title="Clear every player's logs"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Clear logs
            </Button>
          </>
        ) : null}
      </div>
    );
  };

  const summaryBar = (
    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-foreground/70">
      {summary.failed > 0 ? <Badge color="danger">{summary.failed} failed</Badge> : null}
      {advanced && state.stateDiagnostics !== null ? (
        <Badge className="font-mono" title="State-mode diagnostics">
          state rev {state.stateDiagnostics.revision} · {state.stateDiagnostics.stateSizeBytes} B ·{" "}
          {state.stateDiagnostics.actionRatePerSecond.toFixed(1)} act/s
        </Badge>
      ) : null}
      <Badge color={summary.success ? "success" : "default"}>
        {summary.success ? "Test passed" : "Testing…"}
      </Badge>
      {advanced ? <span className="font-mono">run #{state.runId}</span> : null}
    </div>
  );

  const playerCard = (player: ArenaPlayer) => (
    <section
      key={player.id}
      data-testid={`arena-player-${player.id}`}
      className="flex flex-col gap-2 glass rounded-2xl p-3"
      style={frameWidthPx !== null ? { width: `${frameWidthPx}px` } : undefined}
      aria-label={`Player ${player.name}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full",
            player.connectionState === "connected"
              ? "bg-success"
              : player.connectionState === "joining"
                ? "bg-accent"
                : player.connectionState === "suspended"
                  ? "bg-warning"
                  : "bg-danger",
          )}
        />
        <button
          type="button"
          className="font-black hover:underline"
          onClick={() => setRenameTarget(player)}
          title="Rename player"
        >
          {player.name}
        </button>
        {authority === player.id ? (
          <Badge color="accent" title="Runs the game's shared state (the simulated host)">
            Authority
          </Badge>
        ) : null}
        {advanced ? connectionBadge(player) : null}
        {advanced ? <Badge>{runStateLabel(player)}</Badge> : null}
        <div className="flex-1" />
        {!advanced ? null : player.sessionStatus === "disconnected" ? (
          <Button
            variant="default"
            soft
            size="md"
            onClick={() => void actions.reconnectPlayer(player.id)}
            title="Reconnect this player"
          >
            <Wifi className="h-4 w-4" aria-hidden="true" />
            Reconnect
          </Button>
        ) : (
          <Button
            variant="default"
            soft
            size="md"
            onClick={() => void actions.disconnectPlayer(player.id)}
            disabled={player.connectionState !== "connected"}
            title="Disconnect this player"
          >
            <WifiOff className="h-4 w-4" aria-hidden="true" />
            Disconnect
          </Button>
        )}
        {!advanced ? null : player.sessionStatus === "suspended" ? (
          <Button
            variant="default"
            soft
            size="md"
            onClick={() => void actions.resumePlayer(player.id)}
            title="Resume this player from background suspension"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            Resume
          </Button>
        ) : (
          <Button
            variant="default"
            soft
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
          variant="default"
          soft
          size="sm"
          isIconOnly
          onClick={() => actions.removePlayer(player.id)}
          title="Remove this player"
          aria-label={`Remove ${player.name}`}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {player.loadError !== null && !advanced ? (
        <p className="text-xs font-semibold text-danger">Startup failed: {player.loadError}</p>
      ) : null}
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 text-xs font-semibold text-foreground/60",
          !advanced && "hidden",
        )}
      >
        <span className="font-mono">{player.memberId}</span>
        {player.registered ? (
          <span>“{player.registered.title}”</span>
        ) : player.loadError !== null ? (
          <span className="text-danger">Startup failed: {player.loadError}</span>
        ) : (
          <Activity className="h-3 w-3" aria-hidden="true" />
        )}
        <span className="flex-1" />
        {player.sessionStatus !== "disconnected" && player.sessionStatus !== "connected" ? (
          <span>session: {player.sessionStatus}</span>
        ) : null}
      </div>
      <div className="flex items-stretch gap-1">
        <div
          className="min-w-0 flex-1 overflow-hidden rounded-md bg-black"
          style={{ height: `${frameHeightPx}px` }}
          data-testid={`arena-frame-${player.id}`}
        >
          <div ref={bindContainer(player.id)} className="h-full w-full" />
        </div>
        <div
          role="separator"
          aria-label={`Resize ${player.name}'s game frame width`}
          className="flex w-3 cursor-ew-resize select-none items-center justify-center rounded-md bg-surface-tertiary text-foreground/60 transition-colors hover:bg-surface-tertiary hover:text-foreground/90"
          onPointerDown={handleFrameWidthResize}
          title="Drag to resize width"
        >
          <GripVertical className="h-3 w-3" aria-hidden="true" />
        </div>
      </div>
      <div
        role="separator"
        aria-label={`Resize ${player.name}'s game frame`}
        className="flex h-3 cursor-ns-resize select-none items-center justify-center rounded-md bg-surface-tertiary text-foreground/60 transition-colors hover:bg-surface-tertiary hover:text-foreground/90"
        onPointerDown={handleFrameResize}
        title="Drag to resize"
      >
        <GripHorizontal className="h-3 w-3" aria-hidden="true" />
      </div>
      <div
        className={cn(
          "max-h-32 min-h-16 overflow-y-auto rounded-2xl bg-surface-secondary p-2 font-mono text-[11px] leading-relaxed",
          !advanced && "hidden",
        )}
        data-testid={`arena-logs-${player.id}`}
        aria-label={`Logs for ${player.name}`}
      >
        {player.logs.length === 0 ? (
          <span className="text-foreground/40">No log entries yet.</span>
        ) : (
          player.logs.map((entry) => (
            <div
              key={entry.id}
              className={
                entry.level === "error"
                  ? "text-danger"
                  : entry.level === "warn"
                    ? "text-warning"
                    : entry.level === "info"
                      ? "text-accent"
                      : "text-foreground/80"
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
    <div className="flex flex-col gap-3" data-testid="arena-section">
      {summaryBar}

      <div className="hidden flex-col gap-3 md:flex" data-testid="arena-desktop">
        {toolbar("desktop")}
      </div>

      <div className="flex flex-col gap-3 md:hidden" data-testid="arena-mobile">
        <div
          role="tablist"
          aria-label="Simulated players"
          className="flex gap-1 overflow-x-auto rounded-xl bg-surface-secondary p-1"
        >
          {state.players.map((player) => (
            <button
              key={player.id}
              role="tab"
              type="button"
              aria-selected={activePlayerId === player.id}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-bold ${activePlayerId === player.id ? "bg-surface text-foreground shadow-sm" : "text-muted"}`}
              onClick={() => setActivePlayerId(player.id)}
            >
              {player.name}
            </button>
          ))}
        </div>
        {toolbar("mobile")}
      </div>

      {/* Hide inactive phone players with CSS so switching tabs keeps frames
          mounted. Shared frame widths wrap instead of overlapping. */}
      <div className="flex flex-wrap gap-4" data-testid="arena-grid">
        {state.players.map((player) => (
          <div
            key={player.id}
            className={cn("min-w-0", activePlayerId === player.id ? "" : "max-md:hidden")}
            style={frameWidthPx === null ? { flex: "1 1 0%" } : { flex: `0 0 ${frameWidthPx}px` }}
            data-testid={`arena-card-${player.id}`}
          >
            {playerCard(player)}
          </div>
        ))}
      </div>

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
              className="input input--primary"
              onKeyDown={(event) => {
                if (event.key === "Enter") handleRename();
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="default" soft onClick={() => setRenameTarget(null)}>
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
