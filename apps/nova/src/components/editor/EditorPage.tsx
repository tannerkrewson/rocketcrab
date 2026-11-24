import { PROTOCOL_VERSION } from "@rocketcrab/protocol";
import type { SavedGame } from "@rocketcrab/core";
import { useBlocker, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import {
  ArrowLeft,
  ClipboardPaste,
  Code2,
  HelpCircle,
  PartyPopper,
  Pencil,
  Play,
  Save,
  Users,
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
  type ReactNode,
} from "react";
import { toast } from "../../lib/toast";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { LoadingState } from "../ui/LoadingState";
import { BrandHeader } from "../layout/BrandHeader";
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
import { validateSource } from "../../lib/editor/validation";
import { readFromClipboard, writeToClipboard } from "../../lib/editor/clipboard";
import { CodeEditor } from "./CodeEditor";
import { ProblemsPanel } from "./ProblemsPanel";
import { ArenaSection, ArenaRuntimeSeamsContext } from "./ArenaSection";
import { EditorTutorial, markTutorialSeen, shouldAutoOpenTutorial } from "./EditorTutorial";
import { EditorMoreMenu } from "./EditorMoreMenu";
import { EditorEmptyState } from "./EditorEmptyState";

/** Default title for a new, unnamed game (matches the runtime's fallback). */
const DEFAULT_GAME_TITLE = "Untitled game";

/**
 * Refuse obviously wrong files before reading them. Anything smaller loads,
 * and the problems bar reports a game over the real source limit.
 */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_CONSOLE_ENTRIES = 100;
const MAX_DIAGNOSTICS = 50;

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

type EditorView = "test" | "code";

/**
 * The Nova editor. Most games are written by an AI elsewhere and pasted in,
 * so the page leads with Paste and a live multiplayer test; the code editor
 * is a second tab. A hidden single-player runtime supplies diagnostics and
 * the registered title/mode.
 *
 * Saving is explicit and predictable: /editor is always a fresh, empty game;
 * a game reopens only from My games (/games/:id/edit). Leaving with unsaved
 * changes asks to save or discard, and Play with friends saves first, so a
 * game that was played is always in My games afterwards.
 */
export function EditorPage({ game }: { game?: SavedGame }) {
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
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
  const [registration, setRegistration] = useState<{ title: string } | null>(null);
  const [runInfo, setRunInfo] = useState<{
    startedAt: number;
    sourceHash: string;
    runtimeInstanceId: string | null;
  } | null>(null);
  const [view, setView] = useState<EditorView>("test");
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const firstImport = useRef(true);
  const [titleEditing, setTitleEditing] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const displayTitle = title.trim() || registration?.title || DEFAULT_GAME_TITLE;
  // The pre-edit title, so Escape can cancel an in-progress edit.
  const titleDraftRef = useRef(title);

  const closeTutorial = useCallback(() => {
    markTutorialSeen();
    setTutorialOpen(false);
  }, []);

  const startEditingTitle = useCallback(() => {
    titleDraftRef.current = title;
    setTitleEditing(true);
  }, [title]);

  const handleTitleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      setTitleEditing(false);
    } else if (event.key === "Escape") {
      setTitle(titleDraftRef.current);
      setTitleEditing(false);
    }
  }, []);

  useEffect(() => {
    if (!titleEditing) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [titleEditing]);

  const [leaveDialog, setLeaveDialog] = useState(false);
  const [discardDialog, setDiscardDialog] = useState(false);
  // The arena runs this source; it changes only on Run (or paste).
  const [arenaSource, setArenaSource] = useState<string>(savedSource);
  const hiddenRuntimeRef = useRef<HTMLDivElement | null>(null);

  const dirty = source !== savedSource || title !== savedTitle;
  const savingRef = useRef(false);
  const lastRunSourceRef = useRef<string | null>(null);

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

  useEffect(() => {
    // A digest for an older source can finish after a newer one; ignore it.
    let current = true;
    const timer = window.setTimeout(() => {
      void hashSource(source).then((hash) => {
        if (current) setSourceHash(hash);
      });
    }, 300);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
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
          setRegistration({ title: event.message.title });
          // Only runs of the saved source may update that game's test metadata.
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

  /** Validate, then run `code` in the hidden runtime and (on success) the arena. */
  const runSource = useCallback(
    async (code: string) => {
      const issues = validateSource(code);
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
      lastRunSourceRef.current = code;
      const startedAt = Date.now();
      const hash = await hashSource(code);
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
          gameSource: code,
          player: { memberId: "local-creator", displayName: "You" },
          ...(title.trim().length > 0 ? { gameTitle: title.trim() } : {}),
        });
        // Restart the arena only after runtime startup succeeds; failures keep the
        // last testable arena state rather than replacing it with a failed source.
        setArenaSource(code);
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
    },
    [appendDiagnostics, game?.id, session, title],
  );

  const handleRun = useCallback(() => {
    setView("test");
    void runSource(source);
  }, [runSource, source]);

  /** Replace the code with a whole new game and test it right away. */
  const loadGame = useCallback(
    (text: string, message: string) => {
      setSource(text);
      setView("test");
      void runSource(text);
      toast.success(message);
      if (firstImport.current) {
        firstImport.current = false;
        if (shouldAutoOpenTutorial()) setTutorialOpen(true);
      }
    },
    [runSource],
  );

  /** Paste replaces the code and tests it immediately: the main path for AI-written games. */
  const handlePaste = useCallback(async () => {
    try {
      const text = await readFromClipboard();
      if (text.trim().length === 0) {
        toast.info("Your clipboard is empty. Copy your game's HTML first.");
        return;
      }
      loadGame(text, "Pasted. Testing it now.");
    } catch {
      toast.danger(
        "Couldn't read the clipboard. Your browser may need clipboard permission — open the Code tab and paste with Cmd/Ctrl+V instead.",
      );
    }
  }, [loadGame]);

  /** An AI's downloadable .html file works the same as pasting it. */
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handleFileChosen = useCallback(
    async (file: File | undefined) => {
      if (file === undefined) return;
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.danger("That file is too big for a game. Pick the .html file your AI made.");
        return;
      }
      try {
        const text = await file.text();
        if (text.trim().length === 0) {
          toast.info("That file is empty.");
          return;
        }
        loadGame(text, `Loaded ${file.name}. Testing it now.`);
      } catch {
        toast.danger("Couldn't read that file. Try again or paste the HTML instead.");
      }
    },
    [loadGame],
  );
  const openFilePicker = () => fileInputRef.current?.click();

  /**
   * Persist the current source and title. A new game is created; a saved
   * game is updated. Resolves to the saved game's id, or null on failure.
   */
  const persist = useCallback(async (): Promise<string | null> => {
    if (savingRef.current) return null;
    savingRef.current = true;
    try {
      const nextTitle = title.trim() || registration?.title || DEFAULT_GAME_TITLE;
      const input = {
        title: nextTitle,
        html: source,
        apiVersion: PROTOCOL_VERSION,
      };
      if (game) {
        await updateGame.mutateAsync({ id: game.id, input });
        return game.id;
      }
      const created = await createGame.mutateAsync(input);
      return created.id;
    } catch (error) {
      toast.danger(errorMessage(error));
      return null;
    } finally {
      savingRef.current = false;
    }
  }, [createGame, game, registration, source, title, updateGame]);

  const handleSave = useCallback(async () => {
    const id = await persist();
    if (id === null) return;
    if (game) {
      toast.success("Saved.");
      return;
    }
    toast.success("Saved to My games.");
    // Keep editing the same game at its saved URL and preserve where Back leads.
    await navigate({
      to: "/games/$gameId/edit",
      params: { gameId: id },
      replace: true,
      ignoreBlocker: true,
    });
  }, [game, navigate, persist]);

  const handleSaveAsCopy = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const baseTitle = title.trim() || registration?.title || DEFAULT_GAME_TITLE;
      const created = await createGame.mutateAsync({
        title: `${baseTitle} (copy)`,
        html: source,
        apiVersion: PROTOCOL_VERSION,
      });
      toast.success(`Saved a copy as “${created.title}”.`);
      await navigate({
        to: "/games/$gameId/edit",
        params: { gameId: created.id },
        ignoreBlocker: true,
      });
    } catch (error) {
      toast.danger(errorMessage(error));
    } finally {
      savingRef.current = false;
    }
  }, [createGame, navigate, registration, source, title]);

  /** Save first (so the game is in My games), then start a party with it. */
  const handlePlayWithFriends = useCallback(async () => {
    const errors = validateSource(source).filter((issue) => issue.severity === "error");
    if (errors.length > 0) {
      toast.danger(errors[0]?.message ?? "Fix the problems before starting a party.");
      return;
    }
    const id = !game || dirty ? await persist() : game.id;
    if (id === null) return;
    await navigate({
      to: "/party",
      search: {
        gameId: id,
        title: title.trim() || registration?.title || DEFAULT_GAME_TITLE,
      },
      ignoreBlocker: true,
    });
  }, [dirty, game, navigate, persist, registration, source, title]);

  const confirmDiscard = useCallback(() => {
    setSource(savedSource);
    setTitle(savedTitle);
    setDiagnostics([]);
    setConsoleEntries([]);
    setRegistration(null);
    setRunInfo(null);
    setArenaSource(savedSource);
    lastRunSourceRef.current = null;
    session.stop();
    setDiscardDialog(false);
    toast.info("Discarded unsaved changes.");
  }, [savedSource, savedTitle, session]);

  const handleCopyReport = useCallback(async () => {
    const report = buildDiagnosticReport({
      title: displayTitle,
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
      toast.success("Problem report copied. Paste it into your AI.");
    } else {
      toast.danger("Couldn't copy the report — your browser may need clipboard permission.");
    }
  }, [consoleEntries, diagnostics, displayTitle, game, runInfo, runStatus, source, sourceHash]);

  // Leaving with unsaved changes asks to save or discard them.
  const shouldBlockNavigation = useCallback(() => dirty, [dirty]);
  const blocker = useBlocker({
    shouldBlockFn: shouldBlockNavigation,
    enableBeforeUnload: dirty,
    withResolver: true,
  });
  useEffect(() => {
    setLeaveDialog(blocker.status === "blocked");
  }, [blocker.status]);

  const saveAndLeave = useCallback(async () => {
    const id = await persist();
    if (id === null) return;
    toast.success("Saved to My games.");
    blocker.proceed?.();
  }, [blocker, persist]);

  const handleBack = () => {
    if (canGoBack) {
      router.history.back();
    } else {
      void navigate({ to: game === undefined ? "/build" : "/library", replace: true });
    }
  };

  // The empty-source error is the empty state's job, not a "problem".
  const validationIssues = useMemo(
    () => validateSource(source).filter((issue) => issue.code !== "empty"),
    [source],
  );
  const hasCode = source.trim().length > 0;
  const hasArenaSource = arenaSource.trim().length > 0;
  const awaitingGame = !hasCode && !hasArenaSource;
  const showToolbar = !awaitingGame || view === "code" || game !== undefined;
  const arenaStale = arenaSource !== source;
  const saving = createGame.isPending || updateGame.isPending;

  const tabButton = (id: EditorView, label: string, icon: ReactNode) => (
    <button
      key={id}
      role="tab"
      type="button"
      aria-selected={view === id}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold transition-colors",
        view === id ? "bg-surface-tertiary text-foreground" : "text-foreground/60",
      )}
      onClick={() => setView(id)}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <BrandHeader nova className="-mt-1" />
      <div
        className={cn("theme-nova flex flex-col gap-4", !showToolbar && "mx-auto w-full max-w-2xl")}
      >
        <header className="flex flex-wrap items-center gap-3">
          <Button variant="default" soft onPress={handleBack}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Button>
          <div className="min-w-0 flex-1">
            {titleEditing ? (
              <input
                ref={titleInputRef}
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onFocus={(event) => event.target.select()}
                onKeyDown={handleTitleKeyDown}
                onBlur={() => setTitleEditing(false)}
                aria-label="Game title"
                maxLength={64}
                className="input w-full max-w-md text-lg font-black"
              />
            ) : (
              <button
                type="button"
                onClick={startEditingTitle}
                className="group -mx-1 inline-flex max-w-full items-center gap-2 rounded-md px-1 py-0.5 hover:bg-surface-secondary"
                title="Click to edit the game title"
              >
                <h1 className="truncate text-xl font-black">{displayTitle}</h1>
                <Pencil className="h-4 w-4 shrink-0 text-foreground/40" aria-hidden="true" />
              </button>
            )}
          </div>
          {dirty ? (
            <span className="text-xs font-semibold text-foreground/60">Unsaved changes</span>
          ) : null}
          <Button
            variant="default"
            soft
            size="md"
            isIconOnly
            onClick={() => setTutorialOpen(true)}
            aria-label="How the editor works"
            title="How the editor works"
          >
            <HelpCircle className="h-5 w-5" aria-hidden="true" />
          </Button>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Editor views"
            className="glass flex gap-1 rounded-full p-1"
          >
            {tabButton("test", "Test", <Users className="h-4 w-4" aria-hidden="true" />)}
            {tabButton("code", "Code", <Code2 className="h-4 w-4" aria-hidden="true" />)}
          </div>
          {view === "code" || (hasCode && arenaStale) ? (
            <Button
              variant="default"
              soft
              onClick={handleRun}
              disabled={runStatus === "starting"}
              title="Test your latest code"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Run
            </Button>
          ) : null}
          {showToolbar ? (
            <>
              <div className="flex-1" />
              {view === "code" || !awaitingGame ? (
                <Button
                  variant={hasCode ? "default" : "primary"}
                  soft={hasCode}
                  onClick={() => void handlePaste()}
                  title="Replace the code with your clipboard and test it"
                >
                  <ClipboardPaste className="h-4 w-4" aria-hidden="true" />
                  Paste game
                </Button>
              ) : null}
              <Button
                variant="default"
                soft
                onClick={() => void handleSave()}
                disabled={saving || !hasCode || (game !== undefined && !dirty)}
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                Save
              </Button>
              <Button
                variant="primary"
                onClick={() => void handlePlayWithFriends()}
                disabled={saving || !hasCode}
                title="Save this game and start a party with it"
              >
                <PartyPopper className="h-4 w-4" aria-hidden="true" />
                Play with friends
              </Button>
              <EditorMoreMenu
                source={source}
                onUploadFile={openFilePicker}
                title={title}
                {...(hasCode ? { onSaveAsCopy: () => void handleSaveAsCopy() } : {})}
                {...(game !== undefined && dirty
                  ? { onDiscardChanges: () => setDiscardDialog(true) }
                  : {})}
              />
            </>
          ) : null}
        </div>

        <ProblemsPanel
          validationIssues={hasCode ? validationIssues : []}
          diagnostics={diagnostics}
          consoleEntries={consoleEntries}
          onCopyReport={() => void handleCopyReport()}
        />

        {/* Both views stay mounted so switching tabs keeps the arena running. */}
        <section aria-label="Code" className={cn(view !== "code" && "hidden")}>
          <div className="flex h-[calc(100dvh-14rem)] min-h-80 flex-col overflow-hidden rounded-2xl bg-overlay">
            {!hasCode ? (
              <p className="shrink-0 border-b border-border px-4 py-2 text-sm text-muted">
                Paste or write a single complete HTML page here.
              </p>
            ) : null}
            <div className="min-h-0 flex-1">
              <CodeEditor value={source} onChange={setSource} ariaLabel="Game HTML source" />
            </div>
          </div>
        </section>

        <section aria-label="Test" hidden={view !== "test"}>
          {hasArenaSource ? (
            <ArenaRuntimeSeamsContext.Provider value={seams}>
              <ArenaSection game={game} source={arenaSource} onDiagnostics={appendDiagnostics} />
            </ArenaRuntimeSeamsContext.Provider>
          ) : hasCode ? (
            <div className="glass rounded-2xl text-center">
              {runStatus === "starting" ? (
                <LoadingState label="Starting the test…" />
              ) : (
                <p className="p-8 text-muted">Run your game to test it.</p>
              )}
            </div>
          ) : (
            <EditorEmptyState onPaste={() => void handlePaste()} onUpload={openFilePicker} />
          )}
        </section>

        <input
          ref={fileInputRef}
          type="file"
          accept=".html,.htm,text/html"
          className="hidden"
          data-testid="editor-file-input"
          aria-label="Upload an HTML game file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset so choosing the same file again still fires a change.
            event.target.value = "";
            void handleFileChosen(file);
          }}
        />

        <EditorTutorial open={tutorialOpen} onClose={closeTutorial} />

        <Dialog open={leaveDialog} onClose={() => blocker.reset?.()} title="Save your changes?">
          <div className="flex flex-col gap-4">
            <p>
              “{displayTitle}” has changes that aren&apos;t saved. Save them to My games before you
              leave?
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="danger" soft onClick={() => blocker.proceed?.()}>
                Don&apos;t save
              </Button>
              <Button variant="default" soft onClick={() => blocker.reset?.()}>
                Keep editing
              </Button>
              <Button variant="primary" onClick={() => void saveAndLeave()} disabled={saving}>
                <Save className="h-4 w-4" aria-hidden="true" />
                Save
              </Button>
            </div>
          </div>
        </Dialog>

        <Dialog
          open={discardDialog}
          onClose={() => setDiscardDialog(false)}
          title="Discard unsaved changes?"
        >
          <div className="flex flex-col gap-4">
            <p>This puts “{displayTitle}” back to its last saved version.</p>
            <div className="button-row self-end">
              <Button variant="default" soft onClick={() => setDiscardDialog(false)}>
                Keep editing
              </Button>
              <Button variant="danger" onClick={confirmDiscard}>
                Discard changes
              </Button>
            </div>
          </div>
        </Dialog>

        <div className="hidden" data-testid="hidden-runtime-container" aria-hidden="true">
          <div ref={hiddenRuntimeRef} />
        </div>
      </div>
    </div>
  );
}
