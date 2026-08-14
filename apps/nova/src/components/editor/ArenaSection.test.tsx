/**
 * Arena UI tests (U6, 7.40): the multi-player test arena lives INSIDE
 * the consolidated editor page and is live by default (Task 1:
 * arena-default-on), so these tests render the real /editor and
 * /games/:id/edit routes and exercise the arena through the fake runtime
 * hosts (the same seams RuntimeHostClient exposes). Covers the responsive
 * player grid, mobile player tabs, shared toolbar controls, per-player
 * logs, re-testing with a changed source, test-result persistence (U2
 * recordTestResults), and the launch-into-party action.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameRepository } from "../../lib/games/instance";
import { routeTree } from "../../routeTree.gen";
import {
  apiCallMessage,
  createHarness,
  deliver,
  readyMessage,
  registrationMessage,
  runtimeErrorMessage,
  runToStart,
  type ArenaHarness,
} from "../../lib/arena/test-harness";
import { EditorRuntimeSeamsContext } from "./EditorPage";

const SOURCE =
  "<!doctype html><html><head><title>Rocket Rumble</title></head><body><p>rockets</p></body></html>";
const PASTED_SOURCE =
  "<!doctype html><html><head><title>Card Sharks</title></head><body><p>cards</p></body></html>";

/** Render the consolidated editor route; the arena is live on load. */
function renderEditor(initialEntries: string[], harness: ArenaHarness) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {/* EditorPage forwards these seams to the embedded arena too. */}
      <EditorRuntimeSeamsContext.Provider value={harness.seams}>
        {children}
      </EditorRuntimeSeamsContext.Provider>
    </QueryClientProvider>
  );
  return render(<RouterProvider router={router} />, { wrapper });
}

function mockClipboard(text: string) {
  const readText = vi.fn().mockResolvedValue(text);
  Object.defineProperty(navigator, "clipboard", {
    value: { readText, writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
}

/** The arena is live on load; scope queries to its section. */
async function openArena() {
  return within(await screen.findByTestId("arena-section"));
}

async function desktopLayout() {
  return within(await screen.findByTestId("arena-desktop"));
}

async function gridLayout() {
  return within(await screen.findByTestId("arena-grid"));
}

/** Bootstraps posted for one arena player (memberId-tagged). */
function arenaBootstraps(harness: ArenaHarness, memberId: string) {
  return harness.windowMessages
    .map((message) => message.data as Record<string, unknown>)
    .filter(
      (message) =>
        message.type === "runtime.bootstrap" &&
        (message.player as { memberId?: string })?.memberId === memberId,
    );
}

/** Only the single-player runtime session's bootstraps (local-creator). */
function runtimeBootstraps(harness: ArenaHarness) {
  return arenaBootstraps(harness, "local-creator");
}

beforeEach(async () => {
  await gameRepository.clear();
  sessionStorage.clear();
  window.localStorage.clear();
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ArenaSection — desktop grid", () => {
  it("runs two simulated players to a passing test and persists the result", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    const harness = createHarness();
    renderEditor([`/games/${game.id}/edit`], harness);
    await openArena();

    const grid = await gridLayout();
    expect(grid.getByText("Player 1")).toBeInTheDocument();
    expect(grid.getByText("Player 2")).toBeInTheDocument();
    expect(grid.getAllByTestId(/arena-frame-/)).toHaveLength(2);

    await runToStart(harness.channels, 2);
    await waitFor(() => expect(screen.getByText("Test passed")).toBeInTheDocument());

    // The clean run persisted lastTestSucceeded/lastTestedAt (U2).
    await vi.waitFor(async () => {
      const saved = await gameRepository.read(game.id);
      expect(saved.lastTestSucceeded).toBe(true);
      expect(saved.lastTestedAt).toBeDefined();
    });
    // Every frame carries a distinct identity and its own session.
    const bootstraps = harness.windowMessages
      .map((message) => message.data as Record<string, unknown>)
      .filter((message) => message.type === "runtime.bootstrap");
    expect(bootstraps).toHaveLength(2);
    expect(
      new Set(bootstraps.map((bootstrap) => (bootstrap.player as { memberId: string }).memberId))
        .size,
    ).toBe(2);
    expect(screen.getByText(/run #1/)).toBeInTheDocument();
  });

  it("resizes every frame's width with the shared horizontal drag handle", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    const harness = createHarness();
    renderEditor([`/games/${game.id}/edit`], harness);
    await openArena();
    const grid = await gridLayout();
    await runToStart(harness.channels, 2);

    // Frames fill their grid cell by default: no fixed width.
    expect(grid.getByTestId("arena-player-player-1").style.width).toBe("");

    // Drag the width handle on player 1's card: every frame card shares
    // the fixed width (same session-local state as the shared height).
    const handle = grid.getByRole("separator", {
      name: /Resize Player 1's game frame width/,
    });
    fireEvent.pointerDown(handle, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 0 });
    fireEvent.pointerUp(window);
    await waitFor(() => {
      expect(grid.getByTestId("arena-player-player-1").style.width).toBe("580px");
    });
    expect(grid.getByTestId("arena-player-player-2").style.width).toBe("580px");

    // The height handle still resizes the frame height independently.
    const heightHandle = grid.getByRole("separator", {
      name: /Resize Player 1's game frame$/,
    });
    const frame = grid.getByTestId("arena-frame-player-1");
    const initialHeight = Number.parseInt(frame.style.height, 10);
    fireEvent.pointerDown(heightHandle, { clientY: 400, pointerId: 2 });
    fireEvent.pointerMove(window, { clientY: 550, clientX: 400 });
    fireEvent.pointerUp(window);
    await waitFor(() => {
      expect(frame.style.height).toBe(`${initialHeight + 150}px`);
    });
  });

  it("shows per-player connection badges and per-player controls", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    const harness = createHarness();
    renderEditor([`/games/${game.id}/edit`], harness);
    await openArena();
    await runToStart(harness.channels, 2);
    const playerCard = within(screen.getByTestId("arena-player-player-1"));
    await waitFor(() => expect(playerCard.getAllByText("Connected").length).toBeGreaterThan(0));
    expect(playerCard.getByRole("button", { name: /Disconnect/ })).toBeInTheDocument();
    expect(playerCard.getByRole("button", { name: /Suspend/ })).toBeInTheDocument();
    expect(playerCard.getByRole("button", { name: /Remove Player 1/ })).toBeInTheDocument();
    expect(playerCard.getByText("Authority")).toBeInTheDocument(); // player 1 is authority

    // Disconnect: the badge flips and the control becomes Reconnect.
    await userEvent.click(playerCard.getByRole("button", { name: /Disconnect/ }));
    await waitFor(() => expect(playerCard.getAllByText("Disconnected").length).toBeGreaterThan(0));
    expect(playerCard.getByRole("button", { name: /Reconnect/ })).toBeInTheDocument();
    await userEvent.click(playerCard.getByRole("button", { name: /Reconnect/ }));
    await waitFor(() => expect(playerCard.getAllByText("Connected").length).toBeGreaterThan(0));
  });

  it("adds a player from the shared toolbar with a distinct identity", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    const harness = createHarness();
    renderEditor([`/games/${game.id}/edit`], harness);
    await openArena();
    const desktop = await desktopLayout();
    await runToStart(harness.channels, 2);

    await userEvent.type(desktop.getByLabelText("New player name"), "Zoe");
    await userEvent.click(desktop.getByRole("button", { name: /Add player/ }));
    const grid = await gridLayout();
    await waitFor(() => expect(grid.getByText("Zoe")).toBeInTheDocument());

    await vi.waitFor(() => expect(harness.channels.length).toBe(3));
    deliver(harness.channels[2]!.port1, readyMessage());
    deliver(harness.channels[2]!.port1, registrationMessage("Game 3"));
    deliver(harness.channels[2]!.port1, apiCallMessage("ready", {}));
    await waitFor(() => expect(screen.getByText("Test passed")).toBeInTheDocument());
    expect(screen.getByText("member-3")).toBeInTheDocument();
  });

  it("attributes runtime errors to the correct player's logs", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    const harness = createHarness();
    renderEditor([`/games/${game.id}/edit`], harness);
    await openArena();
    await runToStart(harness.channels, 2);

    deliver(harness.channels[1]!.port1, runtimeErrorMessage("syntax", "Oops in player 2"));
    const player1 = screen.getByTestId("arena-logs-player-1");
    const player2 = screen.getByTestId("arena-logs-player-2");
    await waitFor(() => expect(player2).toHaveTextContent("Oops in player 2"));
    expect(player1).not.toHaveTextContent("Oops in player 2");
  });

  it("mounts every player's game frame inside the shared grid (player 2 regression)", async () => {
    // Regression for rocketcrab-9fv.7.9: player 2's window was black with no
    // iframe because the arena rendered each player card twice (desktop grid
    // + mobile tab list) and the second binding hijacked the frame container.
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    const harness = createHarness();
    renderEditor([`/games/${game.id}/edit`], harness);
    await openArena();
    const grid = await gridLayout();
    await runToStart(harness.channels, 2);

    // Every player's frame host holds an iframe (player 2 previously empty).
    for (const id of ["player-1", "player-2"]) {
      expect(grid.getByTestId(`arena-frame-${id}`).querySelector("iframe")).not.toBeNull();
    }
    // And every created runtime frame lives inside the shared grid — never in
    // a hidden phone-only card.
    expect(harness.frames).toHaveLength(2);
    for (const frame of harness.frames) {
      expect(frame.closest('[data-testid="arena-grid"]')).not.toBeNull();
    }
  });

  it("offers the launch-into-party action for saved games", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    const harness = createHarness();
    renderEditor([`/games/${game.id}/edit`], harness);
    await openArena();

    const link = await screen.findByRole("link", { name: /Play with friends/ });
    expect(link.getAttribute("href")).toContain("/party");
    expect(link.getAttribute("href")).toContain(encodeURIComponent(game.id));
  });

  it("applies the shared latency and drop-message controls (behind the debug menu)", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    const harness = createHarness();
    renderEditor([`/games/${game.id}/edit`], harness);
    await openArena();
    const desktop = await desktopLayout();
    await runToStart(harness.channels, 2);

    // Network simulation controls are hidden by default behind the debug menu.
    expect(desktop.queryByLabelText("Artificial latency")).not.toBeInTheDocument();
    expect(desktop.queryByRole("button", { name: /Drop messages/ })).not.toBeInTheDocument();
    await userEvent.click(desktop.getByRole("button", { name: /^Debug$/ }));

    const latency = desktop.getByLabelText("Artificial latency");
    fireEvent.change(latency, { target: { value: "300" } });
    await waitFor(() => expect(desktop.getByText("Latency 300ms")).toBeInTheDocument());

    await userEvent.click(desktop.getByRole("button", { name: /Drop messages/ }));
    await waitFor(() => expect(desktop.getByText("Dropping")).toBeInTheDocument());
    await userEvent.click(desktop.getByRole("button", { name: /Dropping/ }));
    await waitFor(() => expect(desktop.getByText("Drop messages")).toBeInTheDocument());
  });

  it("removes a player and stops its frame, staying mounted", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    const harness = createHarness();
    renderEditor([`/games/${game.id}/edit`], harness);
    const section = await openArena();
    await runToStart(harness.channels, 2);

    await userEvent.click(section.getByRole("button", { name: /Remove Player 2/ }));
    const grid = within(await screen.findByTestId("arena-grid"));
    await waitFor(() =>
      expect(grid.queryByTestId("arena-player-player-2")).not.toBeInTheDocument(),
    );
    expect(grid.getByTestId("arena-player-player-1")).toBeInTheDocument();
    // The arena is always mounted now — there is no close flow.
    expect(screen.getByTestId("arena-section")).toBeInTheDocument();
  });
});

describe("ArenaSection — phone layout", () => {
  it("switches among four simulated players with tabs, all frames mounted", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    const harness = createHarness();
    renderEditor([`/games/${game.id}/edit`], harness);
    await openArena();
    const desktop = await desktopLayout();
    await runToStart(harness.channels, 2);
    // Add two more players (four total, per the U6 mobile acceptance).
    for (const name of ["Player 3", "Player 4"]) {
      await userEvent.type(desktop.getByLabelText("New player name"), name);
      await userEvent.click(desktop.getByRole("button", { name: /Add player/ }));
      await vi.waitFor(() => expect(harness.channels.length).toBeGreaterThanOrEqual(3));
      const index = harness.channels.length - 1;
      deliver(harness.channels[index]!.port1, readyMessage());
      deliver(harness.channels[index]!.port1, registrationMessage(name));
      deliver(harness.channels[index]!.port1, apiCallMessage("ready", {}));
    }

    const mobile = within(await screen.findByTestId("arena-mobile"));
    const tabs = within(mobile.getByRole("tablist", { name: "Simulated players" }));
    for (const name of ["Player 1", "Player 2", "Player 3", "Player 4"]) {
      expect(tabs.getByRole("tab", { name })).toBeInTheDocument();
    }
    expect(tabs.getByRole("tab", { name: "Player 1" })).toHaveAttribute("aria-selected", "true");
    // On phones only the active card is visible; the rest stay mounted with
    // a max-md:hidden class so switching tabs never reloads a frame.
    expect(screen.getByTestId("arena-card-player-1").className).not.toContain("max-md:hidden");
    expect(screen.getByTestId("arena-card-player-2").className).toContain("max-md:hidden");
    await userEvent.click(tabs.getByRole("tab", { name: "Player 4" }));
    expect(tabs.getByRole("tab", { name: "Player 4" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("arena-card-player-4").className).not.toContain("max-md:hidden");
    // Every frame stays mounted: one per player in the shared grid.
    expect(screen.getAllByTestId(/arena-frame-/)).toHaveLength(4);
    // The shared controls live in a collapsible panel (doesn't cover the game).
    expect(mobile.getByText("Simulation controls")).toBeInTheDocument();
    expect(mobile.getByRole("button", { name: /Add player/ })).toBeInTheDocument();
  });
});

describe("ArenaSection — source handoff and re-testing", () => {
  it("runs the editor's current source in the arena without touching the saved copy", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    mockClipboard(PASTED_SOURCE);
    const harness = createHarness();
    renderEditor([`/games/${game.id}/edit`], harness);
    const desktop = within(await screen.findByTestId("desktop-layout"));

    // The arena boots the saved source on load…
    await runToStart(harness.channels, 2);
    await waitFor(() => expect(screen.getByText("Test passed")).toBeInTheDocument());

    // …and Run applies the pasted (unsaved) source to the arena, restarting
    // every player with it (the arena restarts once the hidden runtime run
    // resolves, so ready its channel first).
    await userEvent.click(desktop.getByRole("button", { name: /^Paste$/ }));
    await userEvent.click(desktop.getByRole("button", { name: /^Run$/ }));
    await vi.waitFor(() => expect(runtimeBootstraps(harness)).toHaveLength(1));
    const runtimeIndex = harness.channels.length - 1;
    deliver(harness.channels[runtimeIndex]!.port1, readyMessage());
    await vi.waitFor(() => {
      const restarts = arenaBootstraps(harness, "member-1");
      expect(restarts.at(-1)?.gameSource).toBe(PASTED_SOURCE);
    });
    // The saved source is untouched.
    const saved = await gameRepository.read(game.id);
    expect(saved.html).toBe(SOURCE);
    // No sessionStorage handoff any more — the source travels in React state.
    expect(sessionStorage.getItem("nova:arena-source:v1")).toBeNull();
  });

  it("re-tests with a new source after the editor changed", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    mockClipboard(PASTED_SOURCE);
    const harness = createHarness();
    renderEditor([`/games/${game.id}/edit`], harness);
    const desktop = within(await screen.findByTestId("desktop-layout"));

    // First run: the saved source passes in the arena.
    await runToStart(harness.channels, 2);
    await waitFor(() => expect(screen.getByText("Test passed")).toBeInTheDocument());
    expect(screen.getByText(/run #1/)).toBeInTheDocument();

    // Editing the source marks the running arena stale…
    await userEvent.click(desktop.getByRole("button", { name: /^Paste$/ }));
    await waitFor(() =>
      expect(screen.getByText(/Editor changed — press Run to re-test/)).toBeInTheDocument(),
    );

    // …and Run restarts every player with the pasted source (run #2). The
    // arena restarts only once the hidden runtime run resolves, so ready
    // the runtime's channel first (its channel is the newest at the moment
    // its bootstrap appears; the arena restart follows).
    await userEvent.click(desktop.getByRole("button", { name: /^Run$/ }));
    await vi.waitFor(() => expect(runtimeBootstraps(harness)).toHaveLength(1));
    const runtimeIndex = harness.channels.length - 1;
    deliver(harness.channels[runtimeIndex]!.port1, readyMessage());

    // The arena's restarted players load right after the runtime's channel:
    // player 1 then player 2 (each waits for the previous one's ready).
    await vi.waitFor(() =>
      expect(harness.channels.length).toBeGreaterThanOrEqual(runtimeIndex + 2),
    );
    deliver(harness.channels[runtimeIndex + 1]!.port1, readyMessage());
    await vi.waitFor(() =>
      expect(harness.channels.length).toBeGreaterThanOrEqual(runtimeIndex + 3),
    );
    deliver(harness.channels[runtimeIndex + 2]!.port1, readyMessage());
    deliver(harness.channels[runtimeIndex + 1]!.port1, registrationMessage("Game 1"));
    deliver(harness.channels[runtimeIndex + 1]!.port1, apiCallMessage("ready", {}));
    deliver(harness.channels[runtimeIndex + 2]!.port1, registrationMessage("Game 2"));
    deliver(harness.channels[runtimeIndex + 2]!.port1, apiCallMessage("ready", {}));

    await waitFor(() => expect(screen.getByText("Test passed")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/run #2/)).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText(/Editor changed/)).not.toBeInTheDocument());
    expect(arenaBootstraps(harness, "member-1").at(-1)?.gameSource).toBe(PASTED_SOURCE);
  });

  it("mounts the arena by default and seeds it with the current source", async () => {
    const harness = createHarness();
    renderEditor(["/editor"], harness);

    // The arena is live on load — no Test-multiplayer press needed.
    const section = await openArena();
    expect(section.getByTestId("arena-grid")).toBeInTheDocument();
    expect(within(section.getByTestId("arena-grid")).getByText("Player 1")).toBeInTheDocument();
    expect(within(section.getByTestId("arena-grid")).getByText("Player 2")).toBeInTheDocument();

    // It starts loading the players' runtime frames immediately.
    await vi.waitFor(() => expect(harness.channels.length).toBeGreaterThanOrEqual(1));
    await vi.waitFor(() =>
      expect(arenaBootstraps(harness, "member-1").length).toBeGreaterThanOrEqual(1),
    );
  });
});
