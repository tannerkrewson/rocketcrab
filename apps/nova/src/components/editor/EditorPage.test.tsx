import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createBrowserHistory,
  createMemoryHistory,
  createRouter,
} from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameRepository } from "../../lib/games/instance";
import { routeTree } from "../../routeTree.gen";
import type { ChannelPort } from "../../lib/runtime-host";
import { EditorRuntimeSeamsContext, type EditorRuntimeSeams } from "./EditorPage";

// Pass-through spy: tests can hold a digest open to control resolve order.
vi.mock("../../lib/games/hashing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/games/hashing")>();
  return { ...actual, hashSource: vi.fn(actual.hashSource) };
});

/** Editor integration tests use real routes and CodeMirror with a fake runtime host. */

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
  // beforeunload protection needs browser history; memory history installs no window listener.
  if (options.browserHistory) {
    window.history.pushState({}, "", initialEntries[0]);
  }
  const history = options.browserHistory
    ? createBrowserHistory()
    : createMemoryHistory({ initialEntries });
  if (options.browserHistory) {
    for (const entry of initialEntries.slice(1)) {
      history.push(entry);
      history.flush();
    }
  }
  const router = createRouter({ routeTree, history });
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

/** The newest channel belongs to the runtime until Run resolves and restarts the arena. */
async function runtimeChannelIndex(harness: HostHarness, count = 1): Promise<number> {
  await vi.waitFor(() => expect(runtimeBootstraps(harness)).toHaveLength(count));
  return harness.channels.length - 1;
}

function pasteButton() {
  return screen.getByRole("button", { name: /^Paste game$/ });
}

/** CodeMirror's contenteditable (it splits text into highlight spans, so
 *  assert on textContent). Mounted in both tabs; the Code tab only shows it. */
async function codeEditor() {
  return screen.findByRole("textbox", { name: "Game HTML source" });
}

/** Open the More menu and pick an item. */
async function moreMenu(item: string | RegExp) {
  await userEvent.click(screen.getByText("More"));
  await userEvent.click(screen.getByRole("menuitem", { name: item }));
}

beforeEach(async () => {
  await gameRepository.clear();
  window.history.pushState({}, "", "/");
  window.localStorage.clear();
  // Most tests skip the tutorial that follows the first import.
  window.localStorage.setItem("nova:editor-tutorial-dismissed:v1", "1");
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("/editor — a new game", () => {
  it("starts empty, and pasting runs the game immediately; Save adds it to My games", async () => {
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor(["/build", "/editor"], harness);

    expect(await screen.findByTestId("editor-empty-state")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Play with friends/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Code" }));
    expect(screen.getByText("Paste or write a single complete HTML page here.")).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "Test" }));

    await userEvent.click(pasteButton());
    const editor = await codeEditor();
    await waitFor(() => expect(editor.textContent).toContain("cards"));
    const runtimeIndex = await runtimeChannelIndex(harness);
    expect(runtimeBootstraps(harness)[0]?.gameSource).toBe(PASTED_SOURCE);
    expect(runtimeBootstraps(harness)[0]?.gameId).toMatch(/^draft-/);
    expect(runtimeBootstraps(harness)[0]?.player).toEqual({
      memberId: "local-creator",
      displayName: "You",
    });

    harness.ready(runtimeIndex);
    harness.register(runtimeIndex, "Card Sharks");
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Card Sharks"),
    );
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument());

    const games = await gameRepository.list();
    expect(games).toHaveLength(1);
    expect(games[0]?.html).toBe(PASTED_SOURCE);
    expect(games[0]?.title).toBe("Card Sharks");
    expect(games[0]?.mode).toBe("state");
    expect(games[0]?.apiVersion).toBe(1);
    const reopened = await codeEditor();
    expect(reopened.textContent).toContain("cards");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Introducing Nova" })).toBeVisible();
  });

  it("uploading an .html file loads and runs it like a paste", async () => {
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);
    await screen.findByTestId("editor-empty-state");
    expect(screen.getByRole("button", { name: "Upload HTML file" })).toBeInTheDocument();

    const file = new File([PASTED_SOURCE], "card-sharks.html", { type: "text/html" });
    await userEvent.upload(screen.getByTestId("editor-file-input"), file);

    const editor = await codeEditor();
    await waitFor(() => expect(editor.textContent).toContain("cards"));
    await runtimeChannelIndex(harness);
    expect(runtimeBootstraps(harness)[0]?.gameSource).toBe(PASTED_SOURCE);
  });

  it("an empty clipboard pastes nothing and starts no run", async () => {
    mockClipboard("   ");
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);
    await screen.findByTestId("editor-empty-state");
    await userEvent.click(pasteButton());
    await waitFor(() => expect(screen.getByTestId("editor-empty-state")).toBeInTheDocument());
    expect(runtimeBootstraps(harness)).toHaveLength(0);
  });

  it("does not start a run for an oversized source and lists the problem", async () => {
    mockClipboard(`<!doctype html>${"x".repeat(2 * 1024 * 1024)}`);
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);
    await screen.findByTestId("editor-empty-state");
    await userEvent.click(pasteButton());

    const problems = within(await screen.findByTestId("problems-panel"));
    await waitFor(() =>
      expect(problems.getAllByText(/over the .* hard limit/).length).toBeGreaterThan(0),
    );
    expect(runtimeBootstraps(harness)).toHaveLength(0);
  });

  it("warns about missing HTML structure but still runs", async () => {
    mockClipboard("<div>a fragment</div>");
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);
    await screen.findByTestId("editor-empty-state");
    await userEvent.click(pasteButton());

    const problems = within(await screen.findByTestId("problems-panel"));
    expect(problems.getAllByText(/No <!doctype> or <html> tag found/).length).toBeGreaterThan(0);
    await vi.waitFor(() => expect(runtimeBootstraps(harness)).toHaveLength(1));
  });

  it("lists runtime errors, including unsupported Nova API versions", async () => {
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);
    await screen.findByTestId("editor-empty-state");
    await userEvent.click(pasteButton());
    const runtimeIndex = await runtimeChannelIndex(harness);
    harness.ready(runtimeIndex);

    harness.runtimeError(runtimeIndex, "syntax", "Unexpected token");
    const problems = within(await screen.findByTestId("problems-panel"));
    await waitFor(() => expect(problems.getByText(/Unexpected token/)).toBeInTheDocument());
    expect(problems.getByText("1 problem")).toBeInTheDocument();

    harness.runtimeError(
      runtimeIndex,
      "unsupported",
      "Unsupported Nova API version 99. Supported versions: [1].",
    );
    await waitFor(() =>
      expect(problems.getByText(/Unsupported Nova API version 99/)).toBeInTheDocument(),
    );
    expect(problems.getByText("2 problems")).toBeInTheDocument();
  });

  it("reports a runtime startup failure as a problem", async () => {
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor(["/editor"], harness, { bootstrapTimeoutMs: 50 });
    await screen.findByTestId("editor-empty-state");
    await userEvent.click(pasteButton());

    await waitFor(() => expect(screen.getByText(/did not start in time/)).toBeInTheDocument());
  });

  it("Play with friends saves the new game first, then starts a party with it", async () => {
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);
    await screen.findByTestId("editor-empty-state");
    await userEvent.click(pasteButton());
    await runtimeChannelIndex(harness);

    await userEvent.click(screen.getByRole("button", { name: /Play with friends/ }));
    await vi.waitFor(async () => expect(await gameRepository.list()).toHaveLength(1));
    const [saved] = await gameRepository.list();
    expect(saved?.html).toBe(PASTED_SOURCE);
  });

  it("opens the tutorial after the first import and reopens it from the help button", async () => {
    window.localStorage.removeItem("nova:editor-tutorial-dismissed:v1");
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);

    await screen.findByTestId("editor-empty-state");
    expect(screen.queryByTestId("editor-tutorial")).not.toBeInTheDocument();
    await userEvent.click(pasteButton());
    expect(await screen.findByTestId("editor-tutorial")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(screen.queryByTestId("editor-tutorial")).not.toBeInTheDocument());

    cleanup();
    renderEditor(["/editor"], harness);
    await screen.findByTestId("editor-empty-state");
    expect(screen.queryByTestId("editor-tutorial")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "How the editor works" }));
    expect(await screen.findByTestId("editor-tutorial")).toBeInTheDocument();
    // Close it so teardown doesn't remove the body under an open modal portal.
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(screen.queryByTestId("editor-tutorial")).not.toBeInTheDocument());
  });
});

describe("/games/:id/edit — saved games", () => {
  it("loads and tests the saved source; Discard puts back the saved version", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SAVED_SOURCE });
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor([`/games/${game.id}/edit`], harness);

    const editor = await codeEditor();
    await waitFor(() => expect(editor.textContent).toContain("rockets"));
    expect(await screen.findByTestId("arena-section")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeDisabled();

    await userEvent.click(pasteButton());
    await waitFor(() => expect(editor.textContent).toContain("cards"));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect((await gameRepository.read(game.id)).html).toBe(SAVED_SOURCE);

    await moreMenu(/Discard unsaved changes/);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(editor.textContent).toContain("rockets"));
    expect(editor.textContent).not.toContain("cards");
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("a successful run of the saved source updates test metadata", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SAVED_SOURCE });
    const harness = createHostHarness();
    renderEditor([`/games/${game.id}/edit`], harness);
    const editor = await codeEditor();
    await waitFor(() => expect(editor.textContent).toContain("rockets"));

    await userEvent.click(screen.getByRole("tab", { name: "Code" }));
    await userEvent.click(screen.getByRole("button", { name: /^Run$/ }));
    const runtimeIndex = await runtimeChannelIndex(harness);
    harness.ready(runtimeIndex);
    harness.register(runtimeIndex, "Rocket Rumble");

    await vi.waitFor(async () => {
      const saved = await gameRepository.read(game.id);
      expect(saved.lastTestSucceeded).toBe(true);
      expect(saved.lastTestedAt).toBeDefined();
    });
  });

  it("saves a copy from the More menu, then Save edits the copy", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SAVED_SOURCE });
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor([`/games/${game.id}/edit`], harness);
    const editor = await codeEditor();
    await waitFor(() => expect(editor.textContent).toContain("rockets"));

    await moreMenu(/Save as a copy/);
    await screen.findByRole("heading", { level: 1, name: "Rocket Rumble (copy)" });
    const games = await gameRepository.list();
    expect(games).toHaveLength(2);
    const copy = games.find((candidate) => candidate.id !== game.id);
    expect(copy?.html).toBe(SAVED_SOURCE);

    await userEvent.click(pasteButton());
    await waitFor(async () => expect((await codeEditor()).textContent).toContain("cards"));
    await userEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await vi.waitFor(async () => {
      expect((await gameRepository.read(copy?.id as string)).html).toBe(PASTED_SOURCE);
    });
    expect((await gameRepository.read(game.id)).html).toBe(SAVED_SOURCE);
  });

  it("asks to save or discard before leaving with unsaved changes", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SAVED_SOURCE });
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor([`/games/${game.id}/edit`], harness, {}, { browserHistory: true });
    const editor = await codeEditor();
    await waitFor(() => expect(editor.textContent).toContain("rockets"));
    await userEvent.click(pasteButton());
    await waitFor(() => expect(editor.textContent).toContain("cards"));

    const unloadEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloadEvent);
    expect(unloadEvent.defaultPrevented).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    const dialog = await screen.findByRole("dialog", { name: "Save your changes?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Rocket Rumble");

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    const dialog2 = await screen.findByRole("dialog", { name: "Save your changes?" });
    await userEvent.click(within(dialog2).getByRole("button", { name: /^Save$/ }));
    expect(await screen.findByRole("heading", { name: "My games" })).toBeInTheDocument();
    expect((await gameRepository.read(game.id)).html).toBe(PASTED_SOURCE);
  });

  it("can leave without saving", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SAVED_SOURCE });
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor(["/about", `/games/${game.id}/edit`], harness, {}, { browserHistory: true });
    const editor = await codeEditor();
    await waitFor(() => expect(editor.textContent).toContain("rockets"));
    await userEvent.click(pasteButton());
    await waitFor(() => expect(editor.textContent).toContain("cards"));

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    const dialog = await screen.findByRole("dialog", { name: "Save your changes?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Don't save" }));
    expect(await screen.findByRole("heading", { name: "Coming soon" })).toBeInTheDocument();
    expect((await gameRepository.read(game.id)).html).toBe(SAVED_SOURCE);
  });

  it("does not block navigation when clean", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SAVED_SOURCE });
    const harness = createHostHarness();
    renderEditor([`/games/${game.id}/edit`], harness, {}, { browserHistory: true });
    const editor = await codeEditor();
    await waitFor(() => expect(editor.textContent).toContain("rockets"));

    const unloadEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloadEvent);
    expect(unloadEvent.defaultPrevented).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "My games" })).toBeInTheDocument();
  });

  it("edits the game title inline (click-to-edit)", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SAVED_SOURCE });
    const harness = createHostHarness();
    renderEditor([`/games/${game.id}/edit`], harness);
    await codeEditor();

    expect(screen.queryByRole("textbox", { name: "Game title" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Rocket Rumble");

    await userEvent.click(screen.getByRole("heading", { level: 1 }));
    const input = screen.getByRole("textbox", { name: "Game title" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue("Rocket Rumble");

    await userEvent.keyboard("Card Sharks{Enter}");
    expect(screen.queryByRole("textbox", { name: "Game title" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Card Sharks");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("heading", { level: 1 }));
    await userEvent.keyboard("Trivia Night{Escape}");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Card Sharks");

    await userEvent.click(screen.getByRole("heading", { level: 1 }));
    await userEvent.keyboard("Bingo");
    await userEvent.tab();
    expect(screen.queryByRole("textbox", { name: "Game title" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Bingo");
  });
});

describe("problem report and prompts", () => {
  it("copies a problem report for the AI with the source hash and errors", async () => {
    const { writeText } = mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);
    await screen.findByTestId("editor-empty-state");
    await userEvent.click(pasteButton());
    const runtimeIndex = await runtimeChannelIndex(harness);
    harness.ready(runtimeIndex);
    harness.runtimeError(runtimeIndex, "syntax", "Unexpected token");

    const problems = within(await screen.findByTestId("problems-panel"));
    // The source hash is computed after a short debounce.
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    await userEvent.click(problems.getByRole("button", { name: /Copy for AI/ }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    const report = writeText.mock.calls.at(-1)?.[0] as string;
    expect(report).toContain("Rocketcrab Nova — game diagnostic report");
    expect(report).toMatch(/Source SHA-256: [0-9a-f]{64}/);
    expect(report).toContain("syntax");
    expect(report).toContain("Unexpected token");
  });

  it("copies the AI prompt, alone or with the current game, from the More menu", async () => {
    const { writeText } = mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);
    await screen.findByTestId("editor-empty-state");
    await userEvent.click(pasteButton());
    await waitFor(async () => expect((await codeEditor()).textContent).toContain("cards"));

    await moreMenu("Copy AI prompt");
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]?.[0]).toContain("# Nova Master Prompt");
    expect(writeText.mock.calls[0]?.[0]).not.toContain("## Your existing game");

    await moreMenu("Copy AI prompt + my game");
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    const copied = writeText.mock.calls[1]?.[0] as string;
    expect(copied).toContain("## Your existing game");
    expect(copied).toContain(PASTED_SOURCE);
  });

  it("replaces the runtime frame completely on every run (no HMR)", async () => {
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);
    await screen.findByTestId("editor-empty-state");

    await userEvent.click(pasteButton());
    const firstRuntimeIndex = await runtimeChannelIndex(harness);
    harness.ready(firstRuntimeIndex);
    await vi.waitFor(() =>
      expect(
        document.querySelectorAll('[data-testid="hidden-runtime-container"] iframe'),
      ).toHaveLength(1),
    );
    const firstFrame = document.querySelector('[data-testid="hidden-runtime-container"] iframe');

    mockClipboard(SAVED_SOURCE);
    await userEvent.click(pasteButton());
    const secondRuntimeIndex = await runtimeChannelIndex(harness, 2);
    expect(runtimeBootstraps(harness)[1]?.gameSource).toBe(SAVED_SOURCE);
    harness.ready(secondRuntimeIndex);

    await vi.waitFor(() => {
      const frames = document.querySelectorAll('[data-testid="hidden-runtime-container"] iframe');
      expect(frames).toHaveLength(1);
      expect(frames[0]).not.toBe(firstFrame);
    });
    expect(firstFrame?.isConnected).toBe(false);
  });
});
