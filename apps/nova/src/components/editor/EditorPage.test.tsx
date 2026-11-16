import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createBrowserHistory,
  createMemoryHistory,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameRepository } from "../../lib/games/instance";
import { routeTree } from "../../routeTree.gen";
import type { ChannelPort } from "../../lib/runtime-host";
import { runToStart } from "../../lib/arena/test-harness";
import { EditorRuntimeSeamsContext, type EditorRuntimeSeams } from "./EditorPage";
import { hashSource } from "../../lib/games/hashing";
import type { Sha256 } from "@rocketcrab/protocol";

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

/** The newest channel belongs to the runtime until Run resolves and restarts the arena. */
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
    expect(
      document.querySelectorAll('[data-testid="hidden-runtime-container"] iframe'),
    ).toHaveLength(1);

    harness.register(runtimeIndex, "Card Sharks");
    harness.console(runtimeIndex, "log", "dealt 5 cards");
    await waitFor(() => expect(desktop.getByText("dealt 5 cards")).toBeInTheDocument());

    await userEvent.click(desktop.getByRole("button", { name: /^Save$/ }));
    await screen.findByRole("link", { name: /Play with friends/ });

    const games = await gameRepository.list();
    expect(games).toHaveLength(1);
    expect(games[0]?.html).toBe(PASTED_SOURCE);
    expect(games[0]?.title).toBe("Card Sharks");
    expect(games[0]?.mode).toBe("state");
    expect(games[0]?.apiVersion).toBe(1);

    const reopened = await editorInDesktop();
    expect(reopened.textContent).toContain("<!doctype html>");
    expect(reopened.textContent).toContain("cards");
  });

  it("mounts the test arena by default and seeds it with the saved source", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SAVED_SOURCE });
    mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor([`/games/${game.id}/edit`], harness);

    const arena = within(await screen.findByTestId("arena-section"));
    const grid = within(arena.getByTestId("arena-grid"));
    expect(grid.getByText("Player 1")).toBeInTheDocument();
    expect(grid.getByText("Player 2")).toBeInTheDocument();

    await runToStart(harness.channels, 2);
    const arenaBootstraps = harness.windowMessages
      .map((message) => message.data as Record<string, unknown>)
      .filter((message) => message.type === "runtime.bootstrap");
    expect(arenaBootstraps).toHaveLength(2);
    expect(arenaBootstraps[0]?.gameSource).toBe(SAVED_SOURCE);
    expect(arenaBootstraps[1]?.gameSource).toBe(SAVED_SOURCE);
    expect(sessionStorage.getItem("nova:arena-source:v1")).toBeNull();
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
    expect(runtimeBootstraps(harness)).toHaveLength(0);
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

    await userEvent.click(desktop.getByRole("button", { name: /Clear all/ }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep code" }));
    expect(editor.textContent).toContain("cards");

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

    await userEvent.click(desktop.getByRole("button", { name: /^Paste$/ }));
    await userEvent.click(desktop.getByRole("button", { name: /^Run$/ }));
    const runtimeIndex = await runtimeChannelIndex(harness);
    expect(runtimeBootstraps(harness)[0]?.gameSource).toBe(PASTED_SOURCE);
    harness.ready(runtimeIndex);
    harness.register(runtimeIndex, "Rocket Rumble");

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

    await userEvent.click(desktop.getByRole("button", { name: /Save as copy/ }));
    await screen.findByRole("heading", { level: 1, name: "Rocket Rumble (copy)" });

    const games = await gameRepository.list();
    expect(games).toHaveLength(2);
    const copy = games.find((candidate) => candidate.id !== game.id);
    expect(copy?.title).toBe("Rocket Rumble (copy)");
    expect(copy?.html).toBe(SAVED_SOURCE);

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

    const unloadEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloadEvent);
    expect(unloadEvent.defaultPrevented).toBe(true);

    await userEvent.click(screen.getByRole("link", { name: "My games" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Rocket Rumble");
    expect(screen.getByRole("button", { name: "Rocket Rumble" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "My games" }));
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

    await userEvent.click(screen.getByRole("link", { name: "My games" }));
    expect(await screen.findByText("My games")).toBeInTheDocument();
  });

  it("edits the game title inline (click-to-edit)", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SAVED_SOURCE });
    const harness = createHostHarness();
    renderEditor([`/games/${game.id}/edit`], harness);
    await layout("desktop-layout");

    expect(screen.queryByRole("textbox", { name: "Game title" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Rocket Rumble");

    await userEvent.click(screen.getByRole("heading", { level: 1 }));
    const input = screen.getByRole("textbox", { name: "Game title" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue("Rocket Rumble");

    await userEvent.keyboard("Card Sharks{Enter}");
    expect(screen.queryByRole("textbox", { name: "Game title" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Card Sharks");

    expect(screen.getByText(/· unsaved changes/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("heading", { level: 1 }));
    await userEvent.keyboard("Trivia Night{Escape}");
    expect(screen.queryByRole("textbox", { name: "Game title" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Card Sharks");

    await userEvent.click(screen.getByRole("heading", { level: 1 }));
    await userEvent.keyboard("Bingo");
    await userEvent.tab();
    expect(screen.queryByRole("textbox", { name: "Game title" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Bingo");
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

    await waitFor(() => expect(desktop.getByText(/^[0-9a-f]{12}…$/)).toBeInTheDocument());

    await userEvent.click(desktop.getByRole("button", { name: /Copy report/ }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const report = writeText.mock.calls[0]?.[0] as string;
    expect(report).toContain("Rocketcrab Nova — game diagnostic report");
    expect(report).toContain("Source SHA-256: ");
    expect(report).toContain("syntax");
    expect(report).toContain("Unexpected token");
  });

  it("keeps the current source's hash when an older digest resolves last", async () => {
    mockClipboard(PASTED_SOURCE);
    const resolveDigest: Array<(hash: Sha256) => void> = [];
    vi.mocked(hashSource)
      .mockImplementationOnce(() => new Promise((resolve) => resolveDigest.push(resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => resolveDigest.push(resolve)));
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);
    const desktop = await layout("desktop-layout");

    // Digest 0 hashes the empty starting source; paste starts digest 1.
    await waitFor(() => expect(resolveDigest).toHaveLength(1));
    await userEvent.click(desktop.getByRole("button", { name: /^Paste$/ }));
    await waitFor(() => expect(resolveDigest).toHaveLength(2));

    await act(async () => {
      resolveDigest[1]!("new-hash" as Sha256);
    });
    await waitFor(() => expect(desktop.getByTitle("Source SHA-256: new-hash")).toBeInTheDocument());

    await act(async () => {
      resolveDigest[0]!("stale-hash" as Sha256);
    });
    expect(desktop.getByTitle("Source SHA-256: new-hash")).toBeInTheDocument();
  });
});

describe("prompt export (Task 3)", () => {
  it("copies the raw master prompt from the actions row", async () => {
    const { writeText } = mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);
    const desktop = await layout("desktop-layout");

    await userEvent.click(desktop.getByText("Copy prompt"));
    await userEvent.click(screen.getByRole("button", { name: "Master prompt" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]?.[0] as string;
    expect(copied).toContain("# Nova Master Prompt");
    expect(copied).not.toContain("## Your existing game");
  });

  it("copies the prompt plus the current game source", async () => {
    const { writeText } = mockClipboard(PASTED_SOURCE);
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);
    const desktop = await layout("desktop-layout");

    await userEvent.click(desktop.getByRole("button", { name: /^Paste$/ }));
    await userEvent.click(desktop.getByText("Copy prompt"));
    await userEvent.click(screen.getByRole("button", { name: "Prompt + my game" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]?.[0] as string;
    expect(copied).toContain("# Nova Master Prompt");
    expect(copied).toContain("## Your existing game");
    expect(copied).toContain(PASTED_SOURCE);
  });
});

describe("phone layout", () => {
  it("switches between Code and Errors tabs", async () => {
    const harness = createHostHarness();
    renderEditor(["/editor"], harness);

    const mobile = await layout("mobile-layout");
    const tabs = within(mobile.getByRole("tablist", { name: "Editor views" }));
    expect(tabs.getByRole("tab", { name: "Code" })).toHaveAttribute("aria-selected", "true");
    expect(tabs.queryByRole("tab", { name: "Preview" })).not.toBeInTheDocument();

    await userEvent.click(tabs.getByRole("tab", { name: "Errors" }));
    expect(tabs.getByRole("tab", { name: "Errors" })).toHaveAttribute("aria-selected", "true");
    expect(mobile.getByText("No runtime errors from the last run.")).toBeInTheDocument();

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

    await userEvent.click(desktop.getByRole("button", { name: /^Run$/ }));
    const firstRuntimeIndex = await runtimeChannelIndex(harness);
    harness.ready(firstRuntimeIndex);
    await waitFor(() =>
      expect(desktop.getByRole("button", { name: /^Re-run$/ })).toBeInTheDocument(),
    );
    const firstFrame = document.querySelector('[data-testid="hidden-runtime-container"] iframe');

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
    expect(firstFrame?.isConnected).toBe(false);
  });
});
