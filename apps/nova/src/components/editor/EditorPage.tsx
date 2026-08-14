import { PROTOCOL_VERSION, type GameMode } from "@rocketcrab/protocol";
import type { SavedGame } from "@rocketcrab/core";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ClipboardPaste,
  CopyPlus,
  Eraser,
  GripHorizontal,
  MonitorSmartphone,
  PartyPopper,
  Pencil,
  Play,
  Save,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";
import { Button, buttonStyles } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { useCreateGame, useRecordTestResults, useUpdateGame } from "../../lib/games/queries";
import { hashSource, sourceByteLength } from "../../lib/games/hashing";
import type { ChannelPort, RuntimeHostEvent } from "../../lib/runtime-host";
import { runtimeOriginForMainOrigin } from "../../lib/runtime-origin";
import {
  buildDiagnosticReport,
  consoleEntryFromMessage,
  diagnosticsFromHostEvent,
  type ConsoleEntry,
  type Diagnostic,
} from "../../lib/editor/diagnostics";
import { useRuntimeSession } from "../../lib/editor/runtime-session";
import { formatBytes, validateSource } from "../../lib/editor/validation";
import { readFromClipboard, writeToClipboard } from "../../lib/editor/clipboard";
import { storePartySource } from "../../lib/party/source-handoff";
import { CodeEditor } from "./CodeEditor";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { ArenaSection, ArenaRuntimeSeamsContext } from "./ArenaSection";
import { FirstRunTutorial } from "./FirstRunTutorial";
import { PromptExportMenu } from "./PromptExportMenu";

/** Default title for a new, unnamed game (matches the runtime's fallback). */
export const DEFAULT_GAME_TITLE = "Untitled game";

export const MAX_CONSOLE_ENTRIES = 100;
export const MAX_DIAGNOSTICS = 50;

/** Test seams forwarded to RuntimeHostClient (no-op in production). */
export interface EditorRuntimeSeams {
  createChannel?: () => { port1: ChannelPort; port2: unknown };
  waitForFrameLoad?: (iframe: HTMLIFrameElement) => Promise<void>;
  bootstrapTimeoutMs?: number;
}

export const EditorRuntimeSeamsContext = createContext<EditorRuntimeSeams>({});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function friendlyStartupMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("bootstrap timed out")) {
    return "The game runtime did not start in time. Check your connection and try again.";
  }
  if (message.includes("iframe load timed out")) {
    return "The runtime preview could not be loaded.";
  }
  return `The game runtime failed to start: ${message}`;
}

/** Short id for unsaved draft runs (never persisted). */
function draftGameId(): string {
  return `draft-${Date.now().toString(36)}`;
}

/** The code editor's default height (~22% of the viewport, "fairly small"). */
function defaultEditorHeightPx(): number {
  return clampEditorHeight(
    Math.round((typeof window === "undefined" ? 800 : window.innerHeight) * 0.22),
  );
}

function clampEditorHeight(value: number): number {
  const max = typeof window === "undefined" ? 500 : Math.round(window.innerHeight * 0.5);
  return Math.min(Math.max(value, 160), max);
}

/**
 * The consolidated U4 editor + U6 test arena (7.40): one page holding the
 * CodeMirror editor, the diagnostics panel, and the multiplayer test arena
 * together. The code editor sits at the top, small by default, with a drag
 * handle to enlarge it; the arena is always mounted and live below it,
 * flowing in the normal document flow (Task 1: arena-default-on). The
 * single-player runtime session stays mounted in a hidden container purely
 * as the diagnostics / mode-detection / test-metadata engine. Phones
 * (below the sm: breakpoint — not tablets) get a "use the editor on
 * desktop" prompt above the still-working mobile tabs.
 *
 * Replacing the source and Run always destroys and recreates the runtime
 * frame (no hot-module replacement); unsaved source is never written over
 * the saved version. `initialSource` seeds a new-game draft (A4 generator
 * handoff); the caller keys the component so a new draft remounts it.
 */
export function EditorPage({ game, initialSource }: { game?: SavedGame; initialSource?: string }) {
  const navigate = useNavigate();
  const createGame = useCreateGame();
  const updateGame = useUpdateGame();
  const recordTestResults = useRecordTestResults();
  const seams = useContext(EditorRuntimeSeamsContext);

  const savedSource = initialSource ?? game?.html ?? "";
  // New-game mode starts with an empty title; the game's declared title
  // (nova.defineGame) fills the gap on save when the creator typed nothing.
  const savedTitle = game?.title ?? "";

  const [source, setSource] = useState(savedSource);
  const [title, setTitle] = useState(savedTitle);
  const [sourceHash, setSourceHash] = useState("");
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [registration, setRegistration] = useState<{ gameMode: GameMode; title: string } | null>(
    null,
  );
  const [runInfo, setRunInfo] = useState<{
    startedAt: number;
    sourceHash: string;
    runtimeInstanceId: string | null;
  } | null>(null);
  const [mobileTab, setMobileTab] = useState<"code" | "errors">("code");
  const [titleEditing, setTitleEditing] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  // The title shown when not editing: the typed title, else the game's
  // declared title (nova.defineGame), else the default.
  const displayTitle = title.trim() || registration?.title || DEFAULT_GAME_TITLE;
  // The pre-edit title, so Escape can cancel an in-progress edit.
  const titleDraftRef = useRef(title);

  const startEditingTitle = useCallback(() => {
    titleDraftRef.current = title;
    setTitleEditing(true);
  }, [title]);

  const commitTitle = useCallback(() => {
    setTitleEditing(false);
  }, []);

  const handleTitleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      setTitleEditing(false);
    } else if (event.key === "Escape") {
      setTitle(titleDraftRef.current);
      setTitleEditing(false);
    }
  }, []);

  // Swap to an editing input: autofocus and select the whole title.
  useEffect(() => {
    if (!titleEditing) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [titleEditing]);
  const [discardDialog, setDiscardDialog] = useState<{ onConfirm: () => void } | null>(null);
  const [clearAllDialog, setClearAllDialog] = useState(false);
  // The arena's source, seeded with the saved source so the arena is live by
  // default (Task 1: arena-default-on). Run re-applies the current editor
  // source, which restarts every simulated player with it.
  const [arenaSource, setArenaSource] = useState<string>(savedSource);
  const [editorHeightPx, setEditorHeightPx] = useState(defaultEditorHeightPx);
  // The single-player runtime session lives in a hidden container: it stays
  // mounted purely as the diagnostics / mode-detection / saved-source-test-
  // metadata engine (DiagnosticsPanel, registration, recordTestResults).
  const hiddenRuntimeRef = useRef<HTMLDivElement | null>(null);

  const dirty = source !== savedSource || title !== savedTitle;
  const savingRef = useRef(false);
  const lastRunSourceRef = useRef<string | null>(null);

  // Reinitialize when the route's game changes (edit → another edit).
  useEffect(() => {
    setSource(savedSource);
    setTitle(savedTitle);
    setDiagnostics([]);
    setConsoleEntries([]);
    setRegistration(null);
    setRunInfo(null);
    setArenaSource(savedSource);
    lastRunSourceRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id]);

  // Debounced SHA-256 of the current source for the diagnostics panel.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void hashSource(source).then(setSourceHash);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [source]);

  const appendDiagnostics = useCallback((next: Diagnostic[]) => {
    if (next.length === 0) return;
    setDiagnostics((previous) => [...previous, ...next].slice(-MAX_DIAGNOSTICS));
  }, []);

  const appendConsole = useCallback((entry: ConsoleEntry) => {
    setConsoleEntries((previous) => [...previous, entry].slice(-MAX_CONSOLE_ENTRIES));
  }, []);

  const handleRuntimeEvent = useCallback(
    (event: RuntimeHostEvent) => {
      switch (event.type) {
        case "registration":
          setRegistration({ gameMode: event.message.gameMode, title: event.message.title });
          // A successful run of the *saved* source updates the saved-game
          // test metadata (U4 acceptance: successful tests update metadata).
          if (game && lastRunSourceRef.current !== null && lastRunSourceRef.current === game.html) {
            recordTestResults.mutate({
              id: game.id,
              results: { lastTestedAt: Date.now(), lastTestSucceeded: true },
            });
          }
          break;
        case "console":
          appendConsole(consoleEntryFromMessage(event.message));
          break;
        default:
          appendDiagnostics(diagnosticsFromHostEvent(event));
          break;
      }
    },
    [appendConsole, appendDiagnostics, game, recordTestResults],
  );

  const handleRuntimeEventRef = useRef(handleRuntimeEvent);
  handleRuntimeEventRef.current = handleRuntimeEvent;

  const session = useRuntimeSession({
    runtimeOrigin: runtimeOriginForMainOrigin(window.location.origin),
    containerRef: hiddenRuntimeRef,
    onEvent: (event) => handleRuntimeEventRef.current(event),
    ...(seams.createChannel !== undefined ? { createChannel: seams.createChannel } : {}),
    ...(seams.waitForFrameLoad !== undefined ? { waitForFrameLoad: seams.waitForFrameLoad } : {}),
    ...(seams.bootstrapTimeoutMs !== undefined
      ? { bootstrapTimeoutMs: seams.bootstrapTimeoutMs }
      : {}),
  });

  const runStatus = session.status;

  const handleRun = useCallback(async () => {
    const issues = validateSource(source);
    const errors = issues.filter((issue) => issue.severity === "error");
    const warnings = issues.filter((issue) => issue.severity === "warning");
    setDiagnostics([]);
    setConsoleEntries([]);
    setRegistration(null);
    if (errors.length > 0) {
      appendDiagnostics(
        errors.map((issue) => ({
          id: `validation-${issue.code}`,
          severity: "error" as const,
          category: issue.code,
          message: issue.message,
          timestamp: Date.now(),
        })),
      );
      return;
    }
    lastRunSourceRef.current = source;
    const startedAt = Date.now();
    const hash = await hashSource(source);
    setRunInfo({ startedAt, sourceHash: hash, runtimeInstanceId: null });
    if (warnings.length > 0) {
      appendDiagnostics(
        warnings.map((issue) => ({
          id: `validation-${issue.code}`,
          severity: "warning" as const,
          category: issue.code,
          message: issue.message,
          timestamp: Date.now(),
        })),
      );
    }
    try {
      await session.run({
        gameId: game?.id ?? draftGameId(),
        gameMode: game?.mode ?? "state",
        gameSource: source,
        player: { memberId: "local-creator", displayName: "You" },
        ...(title.trim().length > 0 ? { gameTitle: title.trim() } : {}),
      });
      // Run re-applies the current source to the live arena too (Task 1:
      // one Run means "apply my code to the stage and re-test"). The arena
      // restarts only once the run actually started, so its restart channels
      // always follow the runtime's own — and on a startup failure the
      // stage keeps the last testable state (the stale badge explains).
      setArenaSource(source);
      setRunInfo((previous) =>
        previous
          ? {
              ...previous,
              runtimeInstanceId: session.diagnose()?.runtimeInstanceId ?? null,
            }
          : previous,
      );
    } catch (error) {
      appendDiagnostics([
        {
          id: `startup-${Date.now()}`,
          severity: "error",
          category: "startup",
          message: friendlyStartupMessage(error),
          timestamp: Date.now(),
        },
      ]);
    }
  }, [appendDiagnostics, game?.id, game?.mode, session, source, title]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await readFromClipboard();
      if (text.length === 0) {
        toast.info("Your clipboard is empty.");
        return;
      }
      setSource(text);
      setMobileTab("code");
      toast.success("Pasted into the editor. Run it to see it live.");
    } catch {
      toast.error(
        "Couldn't read the clipboard. Your browser may need clipboard permission — use Cmd/Ctrl+V in the editor instead.",
      );
    }
  }, []);

  /**
   * Play with friends (P4): create a REAL party from the CURRENT editor
   * source (saved or not). The source is handed to the party route via
   * sessionStorage; unsaved changes are never written to the saved game.
   */
  const handlePlayWithFriends = useCallback(() => {
    const errors = validateSource(source).filter((issue) => issue.severity === "error");
    if (errors.length > 0) {
      toast.error("Fix the validation errors before starting a party.");
      return;
    }
    const id = game?.id ?? draftGameId();
    storePartySource({ gameId: id, source });
    void navigate({
      to: "/party",
      search: {
        gameId: id,
        mode: game?.mode ?? "state",
        title: title.trim() || registration?.title || DEFAULT_GAME_TITLE,
      },
      ignoreBlocker: true,
    });
  }, [game, navigate, registration, source, title]);

  const handleSave = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      // The game may declare its own title via nova.defineGame; honor it
      // when the creator hasn't typed one.
      const nextTitle = title.trim() || registration?.title || DEFAULT_GAME_TITLE;
      if (game) {
        await updateGame.mutateAsync({
          id: game.id,
          input: {
            title: nextTitle,
            html: source,
            apiVersion: PROTOCOL_VERSION,
            ...(registration ? { mode: registration.gameMode } : {}),
          },
        });
        toast.success("Saved.");
      } else {
        const created = await createGame.mutateAsync({
          title: nextTitle,
          html: source,
          apiVersion: PROTOCOL_VERSION,
          ...(registration ? { mode: registration.gameMode } : {}),
        });
        toast.success(`Created “${created.title}”.`);
        await navigate({
          to: "/games/$gameId/edit",
          params: { gameId: created.id },
          ignoreBlocker: true,
        });
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      savingRef.current = false;
    }
  }, [createGame, game, navigate, registration, source, title, updateGame]);

  const handleSaveAsCopy = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const baseTitle = title.trim() || registration?.title || DEFAULT_GAME_TITLE;
      const created = await createGame.mutateAsync({
        title: `${baseTitle} (copy)`,
        html: source,
        apiVersion: PROTOCOL_VERSION,
        ...(registration ? { mode: registration.gameMode } : {}),
      });
      toast.success(`Saved a copy as “${created.title}”.`);
      await navigate({
        to: "/games/$gameId/edit",
        params: { gameId: created.id },
        ignoreBlocker: true,
      });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      savingRef.current = false;
    }
  }, [createGame, navigate, registration, source, title]);

  const confirmReset = useCallback(() => {
    setSource(savedSource);
    setTitle(savedTitle);
    setDiagnostics([]);
    setConsoleEntries([]);
    setRegistration(null);
    setRunInfo(null);
    lastRunSourceRef.current = null;
    session.stop();
    setDiscardDialog(null);
    setMobileTab("code");
    toast.info("Discarded unsaved changes.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedSource, savedTitle, session]);

  /** Clear all: delete every line of code (saved games keep their saved copy). */
  const handleClearAll = useCallback(() => {
    setSource("");
    setDiagnostics([]);
    setConsoleEntries([]);
    setRegistration(null);
    setRunInfo(null);
    lastRunSourceRef.current = null;
    session.stop();
    setClearAllDialog(false);
    setMobileTab("code");
    toast.info("Editor cleared.");
  }, [session]);

  /** Drag the splitter: enlarge/shrink the code editor pane (7.40). */
  const handleEditorResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      const startY = event.clientY;
      const startHeight = editorHeightPx;
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture unavailable (some test environments); the window
        // listeners below still track the drag.
      }
      const onMove = (moveEvent: PointerEvent) => {
        setEditorHeightPx(clampEditorHeight(startHeight + (moveEvent.clientY - startY)));
      };
      const onEnd = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    },
    [editorHeightPx],
  );

  const handleCopyReport = useCallback(async () => {
    const report = buildDiagnosticReport({
      title: title.trim() || DEFAULT_GAME_TITLE,
      saved: game !== undefined,
      sourceHash,
      sourceBytes: sourceByteLength(source),
      runStatus: runStatus,
      runStartedAt: runInfo?.startedAt,
      runtimeInstanceId: runInfo?.runtimeInstanceId,
      validationIssues: validateSource(source),
      diagnostics,
      consoleEntries,
    });
    const ok = await writeToClipboard(report);
    if (ok) {
      toast.success("Diagnostic report copied to your clipboard.");
    } else {
      toast.error("Couldn't copy the report — select the text above and copy manually.");
    }
  }, [consoleEntries, diagnostics, game, runInfo, runStatus, source, sourceHash, title]);

  // Unsaved-change protection (U4): block in-app navigation and tab close
  // while the draft differs from the saved version, with a custom dialog.
  const shouldBlockNavigation = useCallback(() => dirty, [dirty]);
  const blocker = useBlocker({
    shouldBlockFn: shouldBlockNavigation,
    enableBeforeUnload: dirty,
    withResolver: true,
  });
  useEffect(() => {
    if (blocker.status === "blocked") {
      setDiscardDialog({
        onConfirm: () => {
          blocker.proceed();
          setDiscardDialog(null);
        },
      });
    } else if (discardDialog !== null && blocker.status === "idle") {
      setDiscardDialog(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.status]);

  const validationIssues = useMemo(() => validateSource(source), [source]);
  const arenaStale = arenaSource !== source;

  const actions = (
    <>
      <Button
        variant="outline"
        onClick={handlePaste}
        title="Paste from clipboard (replaces the editor content)"
      >
        <ClipboardPaste className="h-4 w-4" aria-hidden="true" />
        Paste
      </Button>
      <Button
        variant="outline"
        onClick={() => setClearAllDialog(true)}
        disabled={source.length === 0}
        title="Delete every line of code in the editor"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        Clear all
      </Button>
      <Button
        variant="outline"
        onClick={() => setDiscardDialog({ onConfirm: confirmReset })}
        disabled={!dirty}
        title="Reset unsaved changes"
      >
        <Eraser className="h-4 w-4" aria-hidden="true" />
        Reset
      </Button>
      <div className="flex-1" />
      <Button
        variant="outline"
        onClick={handleSaveAsCopy}
        title="Save the current source as a new game"
      >
        <CopyPlus className="h-4 w-4" aria-hidden="true" />
        Save as copy
      </Button>
      <Button
        variant="secondary"
        onClick={handleSave}
        disabled={createGame.isPending || updateGame.isPending}
      >
        <Save className="h-4 w-4" aria-hidden="true" />
        Save
      </Button>
      <Button
        variant="primary"
        onClick={() => void handleRun()}
        disabled={runStatus === "starting"}
      >
        <Play className="h-4 w-4" aria-hidden="true" />
        {runStatus === "running" ? "Re-run" : "Run"}
      </Button>
      <Button
        variant="primary"
        onClick={handlePlayWithFriends}
        title="Create a real party from this source and play it with friends"
      >
        <PartyPopper className="h-4 w-4" aria-hidden="true" />
        Play with friends
      </Button>
      <PromptExportMenu source={source} title={title} />
    </>
  );

  const tabs = (
    <div className="tabs tabs-box" role="tablist" aria-label="Editor views">
      {(
        [
          { id: "code", label: "Code" },
          {
            id: "errors",
            label:
              diagnostics.length > 0 || consoleEntries.length > 0
                ? `Errors (${diagnostics.length})`
                : "Errors",
          },
        ] as const
      ).map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={mobileTab === tab.id}
          className={`tab tab-sm ${mobileTab === tab.id ? "tab-active" : ""}`}
          onClick={() => setMobileTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  // The arena is always mounted and live (Task 1): the stage is what the
  // creator is making — seeded with the saved source on load, re-applied
  // whenever Run is pressed.
  const arenaSection = (
    <ArenaRuntimeSeamsContext.Provider value={seams}>
      <ArenaSection game={game} source={arenaSource} stale={arenaStale} />
    </ArenaRuntimeSeamsContext.Provider>
  );

  return (
    <div className="flex flex-col gap-4">
      <FirstRunTutorial />

      {/* Phone-size prompt (below sm: — not tablets): editing and testing a
          game needs a real screen. */}
      <div className="sm:hidden" data-testid="phone-prompt">
        <div role="alert" className="alert alert-warning">
          <MonitorSmartphone className="h-6 w-6 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="font-black">The editor works best on a computer</h2>
            <p className="text-sm text-base-content/80">
              Writing and testing a game needs a big screen. Open Rocketcrab Nova on a laptop or
              desktop to use the editor and test arena.
            </p>
          </div>
        </div>
      </div>

      {/* Chrome row (Task 2): identity (logo mark, no text), orientation
          (back to the library), the click-to-edit title, and the byte
          count + unsaved-changes indicator. */}
      <header className="flex flex-wrap items-center gap-3">
        <Link
          to="/"
          className="text-2xl leading-none"
          aria-label="Rocketcrab Nova home"
          title="Rocketcrab Nova"
        >
          <span aria-hidden="true">🦀🚀</span>
        </Link>
        <Link to="/library" className={buttonStyles("outline")} title="Back to your games">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          My games
        </Link>
        <div className="min-w-0 flex-1">
          {titleEditing ? (
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onFocus={(event) => event.target.select()}
              onKeyDown={handleTitleKeyDown}
              onBlur={commitTitle}
              aria-label="Game title"
              maxLength={64}
              className="input input-bordered w-full max-w-md text-lg font-black"
            />
          ) : (
            <button
              type="button"
              onClick={startEditingTitle}
              className="group inline-flex max-w-full items-center gap-2 rounded-md px-1 py-0.5 -mx-1 hover:bg-base-200/60"
              title="Click to edit the game title"
            >
              <h1 className="truncate text-xl font-black">{displayTitle}</h1>
              <Pencil
                className="h-4 w-4 shrink-0 text-base-content/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                aria-hidden="true"
              />
            </button>
          )}
        </div>
        <span className="text-xs font-semibold text-base-content/60">
          {formatBytes(sourceByteLength(source))}
          {dirty ? " · unsaved changes" : null}
        </span>
      </header>

      {/* Desktop: actions, small resizable editor, then the arena flows in
          the normal document flow below (7.40). */}
      <div className="hidden flex-col gap-4 md:flex" data-testid="desktop-layout">
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
        <div style={{ height: `${editorHeightPx}px` }}>
          <div className="grid h-full gap-4 grid-cols-2">
            <section
              className="min-h-0 overflow-hidden rounded-box border-2 border-base-300 bg-base-100"
              aria-label="Editor"
            >
              <div className="h-full">
                <CodeEditor value={source} onChange={setSource} ariaLabel="Game HTML source" />
              </div>
            </section>
            <section
              className="flex min-h-0 flex-col gap-4 overflow-y-auto"
              aria-label="Diagnostics"
            >
              <DiagnosticsPanel
                sourceBytes={sourceByteLength(source)}
                sourceHash={sourceHash}
                validationIssues={validationIssues}
                diagnostics={diagnostics}
                consoleEntries={consoleEntries}
                onCopyReport={() => void handleCopyReport()}
                busy={createGame.isPending || updateGame.isPending}
              />
            </section>
          </div>
        </div>
        <div
          role="separator"
          aria-label="Resize the code editor"
          className="flex h-3 cursor-ns-resize select-none items-center justify-center rounded-md border border-base-300 bg-base-200 text-base-content/40"
          onPointerDown={handleEditorResize}
          title="Drag to resize the code editor"
        >
          <GripHorizontal className="h-3 w-3" aria-hidden="true" />
        </div>
      </div>

      {/* Phone: segmented Code / Preview / Errors tabs with a sticky bar. */}
      <div className="flex flex-col gap-3 md:hidden" data-testid="mobile-layout">
        {tabs}
        {mobileTab === "code" ? (
          <div className="overflow-hidden rounded-box border-2 border-base-300 bg-base-100">
            <div className="h-[50vh] min-h-72">
              <CodeEditor value={source} onChange={setSource} ariaLabel="Game HTML source" />
            </div>
          </div>
        ) : null}
        {mobileTab === "errors" ? (
          <DiagnosticsPanel
            sourceBytes={sourceByteLength(source)}
            sourceHash={sourceHash}
            validationIssues={validationIssues}
            diagnostics={diagnostics}
            consoleEntries={consoleEntries}
            onCopyReport={() => void handleCopyReport()}
            busy={createGame.isPending || updateGame.isPending}
          />
        ) : null}
      </div>

      {/* The test arena: one shared rendering for both layouts. It flows in
          the normal document flow (the page scrolls like every other Nova
          page); on phones it sits between the editor tabs and the sticky
          bar. */}
      {arenaSection}

      <div
        className="sticky bottom-0 z-20 -mx-4 flex items-center gap-2 border-t-2 border-base-300 bg-base-100 px-4 py-2 pb-safe md:hidden"
        data-testid="mobile-actions-bar"
      >
        <Button
          variant="outline"
          size="md"
          onClick={handlePaste}
          title="Paste from clipboard (replaces the editor content)"
        >
          <ClipboardPaste className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="md"
          onClick={() => setClearAllDialog(true)}
          disabled={source.length === 0}
          title="Delete every line of code in the editor"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="md"
          onClick={() => setDiscardDialog({ onConfirm: confirmReset })}
          disabled={!dirty}
          title="Reset unsaved changes"
        >
          <Eraser className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="md" onClick={handleSaveAsCopy}>
          <CopyPlus className="h-4 w-4" aria-hidden="true" />
          Copy
        </Button>
        <Button
          variant="secondary"
          size="md"
          onClick={handleSave}
          disabled={createGame.isPending || updateGame.isPending}
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          Save
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={() => void handleRun()}
          disabled={runStatus === "starting"}
        >
          <Play className="h-4 w-4" aria-hidden="true" />
          Run
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={handlePlayWithFriends}
          title="Create a real party from this source and play it with friends"
        >
          <PartyPopper className="h-4 w-4" aria-hidden="true" />
          Party
        </Button>
      </div>

      <Dialog
        open={discardDialog !== null}
        onClose={() => setDiscardDialog(null)}
        title="Discard unsaved changes?"
      >
        <div className="flex flex-col gap-4">
          <p>
            Your edits to “{title.trim() || DEFAULT_GAME_TITLE}” haven't been saved. Leaving now
            loses them.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (discardDialog?.onConfirm === confirmReset) {
                  setDiscardDialog(null);
                } else if (blocker.status === "blocked") {
                  blocker.reset();
                  setDiscardDialog(null);
                }
              }}
            >
              Keep editing
            </Button>
            <Button variant="danger" onClick={() => discardDialog?.onConfirm()}>
              Discard changes
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={clearAllDialog}
        onClose={() => setClearAllDialog(false)}
        title="Clear all code?"
      >
        <div className="flex flex-col gap-4">
          <p>
            This deletes every line of code in the editor.
            {game ? " Your saved version is untouched — Reset restores it." : ""}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setClearAllDialog(false)}>
              Keep code
            </Button>
            <Button variant="danger" onClick={handleClearAll}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Clear all
            </Button>
          </div>
        </div>
      </Dialog>

      {/* The single-player runtime stays mounted in a hidden container: it
          is the diagnostics / mode-detection / saved-source-test-metadata
          engine (registration + recordTestResults) — its frame is never
          visible. */}
      <div className="hidden" data-testid="hidden-runtime-container" aria-hidden="true">
        <div ref={hiddenRuntimeRef} />
      </div>
    </div>
  );
}
