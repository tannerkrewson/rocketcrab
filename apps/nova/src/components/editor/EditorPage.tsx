import { PROTOCOL_VERSION, type GameMode } from "@rocketcrab/protocol";
import type { SavedGame } from "@rocketcrab/core";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { ClipboardPaste, CopyPlus, Eraser, FlaskConical, Play, Save } from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
} from "react";
import { toast } from "sonner";
import { Button } from "../ui/Button";
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
import { storeArenaSource } from "../../lib/arena/draft-source";
import { CodeEditor } from "./CodeEditor";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { PreviewPanel } from "./PreviewPanel";

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

/** Viewport breakpoint matching the md: grid (desktop editor layout). */
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

/**
 * The U4 editor: paste, edit, run, validate, and save one complete HTML
 * game (ADR-0002 single-HTML model). Desktop shows the editor beside the
 * runtime preview + diagnostics; phones get segmented Code / Preview /
 * Errors tabs with a sticky Run / Save bar. Replacing the source and Run
 * always destroys and recreates the runtime frame (no hot-module
 * replacement); unsaved source is never written over the saved version.
 */
export function EditorPage({ game }: { game?: SavedGame }) {
  const navigate = useNavigate();
  const createGame = useCreateGame();
  const updateGame = useUpdateGame();
  const recordTestResults = useRecordTestResults();
  const seams = useContext(EditorRuntimeSeamsContext);

  const savedSource = game?.html ?? "";
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
  const [mobileTab, setMobileTab] = useState<"code" | "preview" | "errors">("code");
  const [discardDialog, setDiscardDialog] = useState<{ onConfirm: () => void } | null>(null);
  const isDesktop = useIsDesktop();

  const dirty = source !== savedSource || title !== savedTitle;
  const savingRef = useRef(false);
  const lastRunSourceRef = useRef<string | null>(null);
  // Two preview spots exist (desktop column, phone preview tab); the active
  // one is whichever layout the viewport is showing, so the runtime frame is
  // always embedded where the user can see it.
  const desktopPreviewRef = useRef<HTMLDivElement | null>(null);
  const mobilePreviewRef = useRef<HTMLDivElement | null>(null);
  const activePreviewRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activePreviewRef.current = isDesktop ? desktopPreviewRef.current : mobilePreviewRef.current;
  }, [isDesktop]);

  // Reinitialize when the route's game changes (edit → another edit).
  useEffect(() => {
    setSource(savedSource);
    setTitle(savedTitle);
    setDiagnostics([]);
    setConsoleEntries([]);
    setRegistration(null);
    setRunInfo(null);
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
    containerRef: activePreviewRef,
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
   * Test multiplayer (U6): hand the CURRENT editor source (saved or not) to
   * the test arena via sessionStorage and open it. The arena tests exactly
   * what the creator sees in the editor; unsaved changes are not written to
   * the saved game.
   */
  const handleTestMultiplayer = useCallback(() => {
    const errors = validateSource(source).filter((issue) => issue.severity === "error");
    if (errors.length > 0) {
      toast.error("Fix the validation errors before testing multiplayer.");
      return;
    }
    const id = game?.id ?? draftGameId();
    storeArenaSource({ gameId: id, source });
    if (game !== undefined) {
      void navigate({
        to: "/games/$gameId/test",
        params: { gameId: game.id },
        ignoreBlocker: true,
      });
    } else {
      void navigate({ to: "/test", ignoreBlocker: true });
    }
  }, [game, navigate, source]);

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
  const stalePreview = runStatus === "running" && source !== lastRunSourceRef.current;

  const actions = (
    <>
      <Button
        variant="ghost"
        onClick={handlePaste}
        title="Paste from clipboard (replaces the editor content)"
      >
        <ClipboardPaste className="h-4 w-4" aria-hidden="true" />
        Paste
      </Button>
      <Button
        variant="ghost"
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
        variant="secondary"
        onClick={handleTestMultiplayer}
        title="Run this source with several simulated players in the test arena"
      >
        <FlaskConical className="h-4 w-4" aria-hidden="true" />
        Test multiplayer
      </Button>
    </>
  );

  const tabs = (
    <div className="tabs tabs-box" role="tablist" aria-label="Editor views">
      {(
        [
          { id: "code", label: "Code" },
          { id: "preview", label: "Preview" },
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

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Game title"
          aria-label="Game title"
          maxLength={64}
          className="input input-bordered min-w-40 flex-1"
        />
        <span className="text-xs font-semibold text-base-content/60">
          {formatBytes(sourceByteLength(source))}
          {dirty ? " · unsaved changes" : null}
        </span>
        <Link to="/library" className="btn btn-ghost btn-sm font-bold">
          Back to games
        </Link>
      </header>

      {/* Desktop: editor left, preview + diagnostics right. */}
      <div className="hidden gap-4 md:grid md:grid-cols-2" data-testid="desktop-layout">
        <section className="flex flex-col gap-3" aria-label="Editor">
          <div className="overflow-hidden rounded-box border-2 border-base-300 bg-base-100">
            <div className="h-[55vh] min-h-80">
              <CodeEditor value={source} onChange={setSource} ariaLabel="Game HTML source" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </section>
        <section className="flex flex-col gap-4">
          <PreviewPanel
            containerRef={desktopPreviewRef}
            status={runStatus}
            onStop={session.stop}
            stale={stalePreview}
          />
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
        {/* Always mounted so the runtime frame has a stable phone home even
            while another tab is active. */}
        <div className={mobileTab === "preview" ? "" : "hidden"}>
          <PreviewPanel
            containerRef={mobilePreviewRef}
            status={runStatus}
            onStop={session.stop}
            stale={stalePreview}
          />
        </div>
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
        <div className="sticky bottom-0 z-20 -mx-4 flex items-center gap-2 border-t-2 border-base-300 bg-base-100 px-4 py-2 pb-safe">
          <Button
            variant="ghost"
            size="md"
            onClick={handlePaste}
            title="Paste from clipboard (replaces the editor content)"
          >
            <ClipboardPaste className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
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
            variant="secondary"
            size="md"
            onClick={handleTestMultiplayer}
            title="Run this source with several simulated players in the test arena"
          >
            <FlaskConical className="h-4 w-4" aria-hidden="true" />
            Test
          </Button>
        </div>
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
              variant="ghost"
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
    </div>
  );
}
