import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createBrowserHistory,
  createMemoryHistory,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameRepository } from "../../lib/games/instance";
import { routeTree } from "../../routeTree.gen";
import type { ChannelPort } from "../../lib/runtime-host";
import { runToStart } from "../../lib/arena/test-harness";
import { EditorRuntimeSeamsContext, type EditorRuntimeSeams } from "./EditorPage";

/**
 * Editor integration tests (U4): the real /editor and /games/:id/edit routes
 * through the TanStack Router, real CodeMirror, and a fake runtime host
 * (the same seams RuntimeHostClient already exposes — U3's bridge is used
 * verbatim). Covers paste → run → save, validation gating, unsaved-change
 * protection, save-as-copy, the copyable report, mobile tabs, and the
 * "running unsaved source never overwrites the saved version" contract.
 */

interface FakePort extends ChannelPort {
  sent: unknown[];
  closed: boolean;
}

function createFakePort(): FakePort {
  const port: FakePort = {
    sent: [],
    closed: false,
    onmessage: null,
    onmessageerror: null,
    postMessage(message: unknown): void {
      port.sent.push(message);
    },
    close(): void {
      port.closed = true;
    },
  };
  return port;
}

function deliver(port: FakePort, message: unknown): void {
  port.onmessage?.({ data: message } as MessageEvent);
}

interface HostHarness {
  seams: EditorRuntimeSeams;
  windowMessages: Array<{ data: unknown }>;
  frames: HTMLIFrameElement[];
  channels: Array<{ port1: FakePort; port2: FakePort }>;
  /** Deliver runtime.ready to ONE channel — the runtime session's channel,
   *  identified by its index (see runtimeChannelIndex). The arena's
   *  simulated players share the same fake host, so these helpers never
   *  target at(-1) blindly. */
  ready(index: number): void;
  register(index: number, title: string, gameMode?: string): void;
  runtimeError(index: number, category: string, message: string): void;
  console(index: number, level: string, message: string): void;
}

/** Fake host matching RuntimeHostClient's seams; a fresh channel per load. */
function createHostHarness(): HostHarness {
  const windowMessages: HostHarness["windowMessages"] = [];
  const frames: HTMLIFrameElement[] = [];
  const channels: HostHarness["channels"] = [];

  const harness: HostHarness = {
    seams: {
      createChannel() {
        const port1 = createFakePort();
        const port2 = createFakePort();
        channels.push({ port1, port2 });
        return { port1, port2 };
      },
      async waitForFrameLoad(iframe) {
        frames.push(iframe);
        iframe.contentWindow?.addEventListener("message", (event: MessageEvent) => {
          windowMessages.push({ data: event.data });
        });
      },
    },
    windowMessages,
    frames,
    channels,
    ready(index: number) {
      deliver(harness.channels[index]!.port1, {
        version: 1,
        runtimeInstanceId: "runtime-1",
        messageId: "message-ready",
        sentAt: 1_700_000_000_000,
        type: "runtime.ready",
        status: "ready",
      });
    },
    register(index: number, title: string, gameMode = "state") {
      deliver(harness.channels[index]!.port1, {
        version: 1,
        runtimeInstanceId: "runtime-1",
        messageId: "message-reg",
        sentAt: 1_700_000_000_001,
        type: "game.registration",
        gameId: "game-1",
        title,
        gameMode,
      });
    },
    runtimeError(index: number, category: string, message: string) {
      deliver(harness.channels[index]!.port1, {
        version: 1,
        runtimeInstanceId: "runtime-1",
        messageId: "message-err",
        sentAt: 1_700_000_000_002,
        type: "runtime.error",
        category,
        message,
      });
    },
    console(index: number, level: string, message: string) {
      deliver(harness.channels[index]!.port1, {
        version: 1,
        runtimeInstanceId: "runtime-1",
        messageId: "message-console",
        sentAt: 1_700_000_000_003,
        type: "runtime.console",
        level,
        message,
      });
    },
  };
  return harness;
}

function renderEditor(
  initialEntries: string[],
  harness: HostHarness,
  overrides: EditorRuntimeSeams = {},
  options: { browserHistory?: boolean } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // jsdom has no window.history issues; browser history is required to test
  // the beforeunload half of the unsaved-change protection (memory history
  // has no window listener).
  if (options.browserHistory) {
    window.history.pushState({}, "", initialEntries[0]);
  }
  const router = createRouter({
    routeTree,
    history: options.browserHistory
      ? createBrowserHistory()
      : createMemoryHistory({ initialEntries }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <EditorRuntimeSeamsContext.Provider value={{ ...harness.seams, ...overrides }}>
        {children}
      </EditorRuntimeSeamsContext.Provider>
    </QueryClientProvider>
  );
  return render(<RouterProvider router={router} />, { wrapper });
}

const SAVED_SOURCE =
  "<!doctype html><html><head><title>Rocket Rumble</title></head><body><p>rockets</p></body></html>";
const PASTED_SOURCE =
  "<!doctype html><html><head><title>Card Sharks</title></head><body><p>cards</p></body></html>";

function mockClipboard(text: string) {
  const readText = vi.fn().mockResolvedValue(text);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { readText, writeText },
    configurable: true,
  });
  return { readText, writeText };
}

/** Only the single-player runtime session's bootstraps (the arena's
 *  simulated players use member-1/member-2). */
function runtimeBootstraps(harness: HostHarness) {
  return harness.windowMessages
    .map((message) => message.data as Record<string, unknown>)
    .filter(
      (message) =>
        message.type === "runtime.bootstrap" &&
        (message.player as { memberId?: string })?.memberId === "local-creator",
    );
}

/**
 * Wait until the runtime has bootstrapped `count` times, then return the
 * index of its just-created channel. The runtime's channel is the last one
 * at that moment: the arena restarts only after a run resolves (Task 1
 * handleRun), so no arena restart channels exist yet.
 */
async function runtimeChannelIndex(harness: HostHarness, count = 1): Promise<number> {
  await vi.waitFor(() => expect(runtimeBootstraps(harness)).toHaveLength(count));
  return harness.channels.length - 1;
}

/** Query the currently mounted layout subtree (re-queried after navigation). */
async function layout(layout: "desktop-layout" | "mobile-layout") {
  const element = await screen.findByTestId(layout);
  return within(element);
}

/** The desktop editor's contenteditable (CodeMirror splits text into
 * syntax-highlight spans, so assert on textContent rather than getByText). */
async function editorInDesktop() {
  return (await layout("desktop-layout")).getByRole("textbox", {
    name: "Game HTML source",
  });
}

beforeEach(async () => {
  await gameRepository.clear();
  window.history.pushState({}, "", "/");
  window.localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("/editor — paste, run, save", () => {
  it("pastes from the clipboard, runs the source, and saves it", async () => {
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);

    const desktop = await layout("desktop-layout");
    await userEvent.click(desktop.getByRole("button", { name: /^Paste$/ }));
    const editor = await editorInDesktop();
    await waitFor(() => expect(editor.textContent).toContain("cards"));

    // Run the pasted source: a fresh runtime frame is bootstrapped.
    await userEvent.click(desktop.getByRole("button", { name: /^Run$/ }));
    const runtimeIndex = await runtimeChannelIndex(harness);
    expect(runtimeBootstraps(harness)[0]?.gameSource).toBe(PASTED_SOURCE);
    expect(runtimeBootstraps(harness)[0]?.gameId).toMatch(/^draft-/);
    expect(runtimeBootstraps(harness)[0]?.player).toEqual({
      memberId: "local-creator",
      displayName: "You",
    });

    harness.ready(runtimeIndex);
    await waitFor(() =>
      expect(desktop.getByRole("button", { name: /^Re-run$/ })).toBeInTheDocument(),
    );
    // The single-player runtime frame lives in the hidden diagnostics
    // container; the arena's player frames live in the grid below.
    expect(
      document.querySelectorAll('[data-testid="hidden-runtime-container"] iframe'),
    ).toHaveLength(1);

    // The game registers; console output lands in the diagnostics panel.
    harness.register(runtimeIndex, "Card Sharks");
    harness.console(runtimeIndex, "log", "dealt 5 cards");
    await waitFor(() => expect(desktop.getByText("dealt 5 cards")).toBeInTheDocument());

    // Save creates the game and navigates to its edit route.
    await userEvent.click(desktop.getByRole("button", { name: /^Save$/ }));
    await screen.findByText("Editing a saved game — unsaved edits never touch the saved version.");

    const games = await gameRepository.list();
    expect(games).toHaveLength(1);
    expect(games[0]?.html).toBe(PASTED_SOURCE);
    expect(games[0]?.title).toBe("Card Sharks");
    expect(games[0]?.mode).toBe("state");
    expect(games[0]?.apiVersion).toBe(1);

    // Reopening preserves the source exactly.
    const reopened = await editorInDesktop();
    expect(reopened.textContent).toContain("<!doctype html>");
    expect(reopened.textContent).toContain("cards");
  });

  it("mounts the test arena by default and seeds it with the saved source", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SAVED_SOURCE });
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor([`/games/${game.id}/edit`], harness);

    // The arena is live on load — no Test-multiplayer press needed.
    const arena = within(await screen.findByTestId("arena-section"));
    const grid = within(arena.getByTestId("arena-grid"));
    expect(grid.getByText("Player 1")).toBeInTheDocument();
    expect(grid.getByText("Player 2")).toBeInTheDocument();

    // It runs the seeded (saved) source: every simulated player bootstraps
    // it, on the same page (no navigation, no sessionStorage handoff).
    await runToStart(harness.channels, 2);
    const arenaBootstraps = harness.windowMessages
      .map((message) => message.data as Record<string, unknown>)
      .filter((message) => message.type === "runtime.bootstrap");
    expect(arenaBootstraps).toHaveLength(2);
    expect(arenaBootstraps[0]?.gameSource).toBe(SAVED_SOURCE);
    expect(arenaBootstraps[1]?.gameSource).toBe(SAVED_SOURCE);
    expect(sessionStorage.getItem("nova:arena-source:v1")).toBeNull();
    // The saved version is untouched.
    expect((await gameRepository.read(game.id)).html).toBe(SAVED_SOURCE);
  });

  it("Run is gated on validation errors", async () => {
    mockClipboard("");
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);
    const desktop = await layout("desktop-layout");
    await userEvent.click(desktop.getByRole("button", { name: /^Run$/ }));
    await waitFor(() =>
      expect(desktop.getAllByText(/Game source is empty/).length).toBeGreaterThan(0),
    );
    // The single-player runtime never starts for an invalid source.
    expect(runtimeBootstraps(harness)).toHaveLength(0);
    // The arena stays mounted regardless — it is the stage, always live.
    expect(screen.getByTestId("arena-section")).toBeInTheDocument();
  });

  it("clear-all deletes every line of code after confirmation", async () => {
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);

    const desktop = await layout("desktop-layout");
    await userEvent.click(desktop.getByRole("button", { name: /^Paste$/ }));
    const editor = await editorInDesktop();
    await waitFor(() => expect(editor.textContent).toContain("cards"));

    // Cancel keeps the code.
    await userEvent.click(desktop.getByRole("button", { name: /Clear all/ }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep code" }));
    expect(editor.textContent).toContain("cards");

    // Confirm clears the editor.
    await userEvent.click(desktop.getByRole("button", { name: /Clear all/ }));
    const dialog2 = await screen.findByRole("dialog");
    await userEvent.click(within(dialog2).getByRole("button", { name: /Clear all/ }));
    await waitFor(() => expect(editor.textContent?.trim()).toBe(""));
    expect(runtimeBootstraps(harness)).toHaveLength(0);
  });

  it("shows the first-run tutorial and dismisses it permanently", async () => {
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);

    expect(await screen.findByTestId("first-run-tutorial")).toBeInTheDocument();
    expect(screen.getByText(/New to Nova\? Here's how the editor works/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(screen.queryByTestId("first-run-tutorial")).not.toBeInTheDocument());

    // A fresh visit (same browser) doesn't show it again.
    document.body.innerHTML = "";
    renderEditor(["/editor"], harness);
    expect(screen.queryByTestId("first-run-tutorial")).not.toBeInTheDocument();
  });

  it("does not start a run for an empty source", async () => {
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);

    const desktop = await layout("desktop-layout");
    await userEvent.click(desktop.getByRole("button", { name: /^Run$/ }));

    await waitFor(() =>
      expect(desktop.getAllByText(/Game source is empty/).length).toBeGreaterThan(0),
    );
    expect(runtimeBootstraps(harness)).toHaveLength(0);
  });

  it("does not start a run for an oversized source", async () => {
    const oversized = `<!doctype html>${"x".repeat(2 * 1024 * 1024)}`;
    mockClipboard(oversized);
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);

    const desktop = await layout("desktop-layout");
    await userEvent.click(desktop.getByRole("button", { name: /^Paste$/ }));
    await userEvent.click(desktop.getByRole("button", { name: /^Run$/ }));

    await waitFor(() =>
      expect(desktop.getAllByText(/over the .* hard limit/).length).toBeGreaterThan(0),
    );
    expect(runtimeBootstraps(harness)).toHaveLength(0);
  });

  it("warns about missing HTML structure but still runs", async () => {
    mockClipboard("<div>a fragment</div>");
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);

    const desktop = await layout("desktop-layout");
    await userEvent.click(desktop.getByRole("button", { name: /^Paste$/ }));
    await userEvent.click(desktop.getByRole("button", { name: /^Run$/ }));

    await waitFor(() =>
      expect(desktop.getAllByText(/No <!doctype> or <html> tag found/).length).toBeGreaterThan(0),
    );
    await vi.waitFor(() => expect(runtimeBootstraps(harness)).toHaveLength(1));
  });

  it("shows runtime error categories, including unsupported Nova API versions", async () => {
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);

    const desktop = await layout("desktop-layout");
    await userEvent.click(desktop.getByRole("button", { name: /^Paste$/ }));
    await userEvent.click(desktop.getByRole("button", { name: /^Run$/ }));
    const runtimeIndex = await runtimeChannelIndex(harness);
    harness.ready(runtimeIndex);
    await waitFor(() =>
      expect(desktop.getByRole("button", { name: /^Re-run$/ })).toBeInTheDocument(),
    );

    harness.runtimeError(runtimeIndex, "syntax", "Unexpected token");
    await waitFor(() => expect(desktop.getByText(/Unexpected token/)).toBeInTheDocument());

    harness.runtimeError(
      runtimeIndex,
      "unsupported",
      "Unsupported Nova API version 99. Supported versions: [1].",
    );
    await waitFor(() =>
      expect(desktop.getByText(/Unsupported Nova API version 99/)).toBeInTheDocument(),
    );
  });

  it("reports a runtime startup failure as a diagnostic", async () => {
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor(["/editor"], harness, { bootstrapTimeoutMs: 50 });

    const desktop = await layout("desktop-layout");
    await userEvent.click(desktop.getByRole("button", { name: /^Paste$/ }));
    await userEvent.click(desktop.getByRole("button", { name: /^Run$/ }));

    await waitFor(() => expect(desktop.getByText(/did not start in time/)).toBeInTheDocument());
  });
});

describe("/games/:id/edit — saved games", () => {
  it("loads the saved source and resets unsaved changes", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SAVED_SOURCE });
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor([`/games/${game.id}/edit`], harness);

    const desktop = await layout("desktop-layout");
    const editor = desktop.getByRole("textbox", { name: "Game HTML source" });
    await waitFor(() => expect(editor.textContent).toContain("rockets"));
    expect(screen.queryByText(/· unsaved changes/)).not.toBeInTheDocument();

    // Change the source (unsaved), then reset it back to the saved version.
    await userEvent.click(desktop.getByRole("button", { name: /^Paste$/ }));
    await waitFor(() => expect(editor.textContent).toContain("cards"));
    expect(screen.getByText(/· unsaved changes/)).toBeInTheDocument();

    await userEvent.click(desktop.getByRole("button", { name: /^Reset$/ }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Discard changes" }));

    await waitFor(() => expect(editor.textContent).toContain("rockets"));
    expect(editor.textContent).not.toContain("cards");
    expect(screen.queryByText(/· unsaved changes/)).not.toBeInTheDocument();
  });

  it("running unsaved source never overwrites the saved version", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SAVED_SOURCE });
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor([`/games/${game.id}/edit`], harness);

    const desktop = await layout("desktop-layout");
    const editor = desktop.getByRole("textbox", { name: "Game HTML source" });
    await waitFor(() => expect(editor.textContent).toContain("rockets"));

    // Paste unsaved source and run it.
    await userEvent.click(desktop.getByRole("button", { name: /^Paste$/ }));
    await userEvent.click(desktop.getByRole("button", { name: /^Run$/ }));
    const runtimeIndex = await runtimeChannelIndex(harness);
    expect(runtimeBootstraps(harness)[0]?.gameSource).toBe(PASTED_SOURCE);
    harness.ready(runtimeIndex);
    harness.register(runtimeIndex, "Rocket Rumble");

    // The saved version is untouched and its metadata is not updated by the
    // unsaved run.
    const saved = await gameRepository.read(game.id);
    expect(saved.html).toBe(SAVED_SOURCE);
    expect(saved.lastTestedAt).toBeUndefined();
  });

  it("a successful run of the saved source updates test metadata", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SAVED_SOURCE });
    const harness = createHostHarness();
    renderEditor([`/games/${game.id}/edit`], harness);

    const desktop = await layout("desktop-layout");
    const editor = desktop.getByRole("textbox", { name: "Game HTML source" });
    await waitFor(() => expect(editor.textContent).toContain("rockets"));

    await userEvent.click(desktop.getByRole("button", { name: /^Run$/ }));
    const runtimeIndex = await runtimeChannelIndex(harness);
    harness.ready(runtimeIndex);
    await waitFor(() =>
      expect(desktop.getByRole("button", { name: /^Re-run$/ })).toBeInTheDocument(),
    );
    harness.register(runtimeIndex, "Rocket Rumble");

    await vi.waitFor(async () => {
      const saved = await gameRepository.read(game.id);
      expect(saved.lastTestSucceeded).toBe(true);
      expect(saved.lastTestedAt).toBeDefined();
    });
  });

  it("save-as-copy creates a new game from the current source, then save edits it", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SAVED_SOURCE });
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor([`/games/${game.id}/edit`], harness);

    const desktop = await layout("desktop-layout");
    const editor = desktop.getByRole("textbox", { name: "Game HTML source" });
    await waitFor(() => expect(editor.textContent).toContain("rockets"));

    // Save as copy of the *current editor* source.
    await userEvent.click(desktop.getByRole("button", { name: /Save as copy/ }));
    await screen.findByText("Editing a saved game — unsaved edits never touch the saved version.");

    const games = await gameRepository.list();
    expect(games).toHaveLength(2);
    const copy = games.find((candidate) => candidate.id !== game.id);
    expect(copy?.title).toBe("Rocket Rumble (copy)");
    expect(copy?.html).toBe(SAVED_SOURCE);

    // Edit the copy (re-query the layout after the route change), save it.
    const editorAfterCopy = (await layout("desktop-layout")).getByRole("textbox", {
      name: "Game HTML source",
    });
    await waitFor(() => expect(editorAfterCopy.textContent).toContain("rockets"));
    await userEvent.click(
      (await layout("desktop-layout")).getByRole("button", { name: /^Paste$/ }),
    );
    await waitFor(() => expect(editorAfterCopy.textContent).toContain("cards"));
    await userEvent.click((await layout("desktop-layout")).getByRole("button", { name: /^Save$/ }));
    await vi.waitFor(async () => {
      const reloaded = await gameRepository.read(copy?.id as string);
      expect(reloaded.html).toBe(PASTED_SOURCE);
    });
    expect((await gameRepository.read(game.id)).html).toBe(SAVED_SOURCE);
  });

  it("blocks navigation while dirty and discards on confirmation", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SAVED_SOURCE });
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor([`/games/${game.id}/edit`], harness, {}, { browserHistory: true });

    const desktop = await layout("desktop-layout");
    const editor = desktop.getByRole("textbox", { name: "Game HTML source" });
    await waitFor(() => expect(editor.textContent).toContain("rockets"));
    await userEvent.click(desktop.getByRole("button", { name: /^Paste$/ }));
    await waitFor(() => expect(editor.textContent).toContain("cards"));

    // beforeunload is prevented while dirty.
    const unloadEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloadEvent);
    expect(unloadEvent.defaultPrevented).toBe(true);

    // In-app navigation is blocked with a dialog.
    await userEvent.click(screen.getByRole("link", { name: "Back to games" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "Game title" })).toBeInTheDocument();

    // Discard changes proceeds to the library.
    await userEvent.click(screen.getByRole("link", { name: "Back to games" }));
    const dialog2 = await screen.findByRole("dialog");
    await userEvent.click(within(dialog2).getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByText("My games")).toBeInTheDocument();
  });

  it("does not block navigation when clean", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SAVED_SOURCE });
    const harness = createHostHarness();
    renderEditor([`/games/${game.id}/edit`], harness, {}, { browserHistory: true });

    const desktop = await layout("desktop-layout");
    const editor = desktop.getByRole("textbox", { name: "Game HTML source" });
    await waitFor(() => expect(editor.textContent).toContain("rockets"));

    const unloadEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloadEvent);
    expect(unloadEvent.defaultPrevented).toBe(false);

    await userEvent.click(screen.getByRole("link", { name: "Back to games" }));
    expect(await screen.findByText("My games")).toBeInTheDocument();
  });
});

describe("diagnostic report", () => {
  it("copies a report with the source hash and diagnostics", async () => {
    const { writeText } = mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);

    const desktop = await layout("desktop-layout");
    await userEvent.click(desktop.getByRole("button", { name: /^Paste$/ }));
    await userEvent.click(desktop.getByRole("button", { name: /^Run$/ }));
    const runtimeIndex = await runtimeChannelIndex(harness);
    harness.ready(runtimeIndex);
    harness.runtimeError(runtimeIndex, "syntax", "Unexpected token");

    // Wait for the debounced source hash to appear.
    await waitFor(() => expect(desktop.getByText(/^[0-9a-f]{12}…$/)).toBeInTheDocument());

    await userEvent.click(desktop.getByRole("button", { name: /Copy report/ }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const report = writeText.mock.calls[0]?.[0] as string;
    expect(report).toContain("Rocketcrab Nova — game diagnostic report");
    expect(report).toContain("Source SHA-256: ");
    expect(report).toContain("syntax");
    expect(report).toContain("Unexpected token");
  });
});

describe("phone layout", () => {
  it("switches between Code and Errors tabs", async () => {
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);

    const mobile = await layout("mobile-layout");
    const tabs = within(mobile.getByRole("tablist", { name: "Editor views" }));
    expect(tabs.getByRole("tab", { name: "Code" })).toHaveAttribute("aria-selected", "true");
    // The Preview tab is gone: the arena below is the live preview now.
    expect(tabs.queryByRole("tab", { name: "Preview" })).not.toBeInTheDocument();

    await userEvent.click(tabs.getByRole("tab", { name: "Errors" }));
    expect(tabs.getByRole("tab", { name: "Errors" })).toHaveAttribute("aria-selected", "true");
    expect(mobile.getByText("No runtime errors from the last run.")).toBeInTheDocument();

    // The sticky bar keeps Run and Save reachable on the phone.
    const bar = within(await screen.findByTestId("mobile-actions-bar"));
    expect(bar.getByRole("button", { name: /^Run$/ })).toBeInTheDocument();
    expect(bar.getByRole("button", { name: /^Save$/ })).toBeInTheDocument();
  });

  it("replaces the runtime frame completely on every run (no HMR)", async () => {
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);

    const desktop = await layout("desktop-layout");
    await userEvent.click(desktop.getByRole("button", { name: /^Paste$/ }));

    // First run.
    await userEvent.click(desktop.getByRole("button", { name: /^Run$/ }));
    const firstRuntimeIndex = await runtimeChannelIndex(harness);
    harness.ready(firstRuntimeIndex);
    await waitFor(() =>
      expect(desktop.getByRole("button", { name: /^Re-run$/ })).toBeInTheDocument(),
    );
    const firstFrame = document.querySelector('[data-testid="hidden-runtime-container"] iframe');

    // Change the source and run again: a brand-new frame is created and the
    // old one is gone (destroy + recreate, never hot-module replacement).
    mockClipboard(SAVED_SOURCE);
    await userEvent.click(desktop.getByRole("button", { name: /^Paste$/ }));
    await userEvent.click(desktop.getByRole("button", { name: /Re-run/ }));
    const secondRuntimeIndex = await runtimeChannelIndex(harness, 2);
    expect(runtimeBootstraps(harness)[1]?.gameSource).toBe(SAVED_SOURCE);
    harness.ready(secondRuntimeIndex);
    await waitFor(() =>
      expect(desktop.getByRole("button", { name: /^Re-run$/ })).toBeInTheDocument(),
    );

    const runtimeFrames = document.querySelectorAll(
      '[data-testid="hidden-runtime-container"] iframe',
    );
    expect(runtimeFrames).toHaveLength(1);
    expect(runtimeFrames[0]).not.toBe(firstFrame);
    // The run-1 frame is gone entirely (destroy + recreate, never HMR).
    expect(firstFrame?.isConnected).toBe(false);
  });
});
