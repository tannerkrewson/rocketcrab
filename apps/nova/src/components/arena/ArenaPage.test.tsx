/**
 * Arena UI tests (U6): the /games/:id/test and /test routes render the
 * multi-player arena through the real router + fake runtime hosts (the same
 * seams RuntimeHostClient exposes). Covers the responsive player grid,
 * mobile player tabs, shared toolbar controls, per-player logs, the
 * back-to-editor action, test-result persistence (U2 recordTestResults),
 * and the launch-into-party action.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameRepository } from "../../lib/games/instance";
import { routeTree } from "../../routeTree.gen";
import { storeArenaSource } from "../../lib/arena/draft-source";
import {
  apiCallMessage,
  createHarness,
  deliver,
  registrationMessage,
  readyMessage,
  runtimeErrorMessage,
  runToStart,
  type ArenaHarness,
} from "../../lib/arena/test-harness";
import { ArenaRuntimeSeamsContext } from "./ArenaPage";

const SOURCE =
  "<!doctype html><html><head><title>Rocket Rumble</title></head><body><p>rockets</p></body></html>";

/** Render through the real router on one of the arena routes. */
function renderRoute(initialEntries: string[], harness: ArenaHarness) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ArenaRuntimeSeamsContext.Provider value={harness.seams}>
        {children}
      </ArenaRuntimeSeamsContext.Provider>
    </QueryClientProvider>
  );
  return render(<RouterProvider router={router} />, { wrapper });
}

async function desktopLayout() {
  return within(await screen.findByTestId("arena-desktop"));
}

async function gridLayout() {
  return within(await screen.findByTestId("arena-grid"));
}

beforeEach(async () => {
  await gameRepository.clear();
  sessionStorage.clear();
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ArenaPage — desktop grid", () => {
  it("runs two simulated players to a passing test and persists the result", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    const harness = createHarness();
    renderRoute([`/games/${game.id}/test`], harness);

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

  it("shows per-player connection badges and per-player controls", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    const harness = createHarness();
    renderRoute([`/games/${game.id}/test`], harness);
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
    renderRoute([`/games/${game.id}/test`], harness);
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
    renderRoute([`/games/${game.id}/test`], harness);
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
    renderRoute([`/games/${game.id}/test`], harness);
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

  it("links back to the game's editor instead of replacing the source", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    const harness = createHarness();
    renderRoute([`/games/${game.id}/test`], harness);
    const desktop = await desktopLayout();

    expect(desktop.queryByRole("button", { name: /Replace source/ })).not.toBeInTheDocument();
    const link = desktop.getByRole("link", { name: /Back to editor/ });
    expect(link.getAttribute("href")).toContain(`/games/${encodeURIComponent(game.id)}/edit`);
  });

  it("links back to the editor for an unsaved draft arena", async () => {
    storeArenaSource({ gameId: "draft-abc", source: SOURCE });
    const harness = createHarness();
    renderRoute(["/test"], harness);
    const desktop = await desktopLayout();

    const link = desktop.getByRole("link", { name: /Back to editor/ });
    expect(link.getAttribute("href")).toBe("/editor");
  });

  it("offers the launch-into-party action for saved games", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    const harness = createHarness();
    renderRoute([`/games/${game.id}/test`], harness);
    const link = await screen.findByRole("link", { name: /Play with friends/ });
    expect(link.getAttribute("href")).toContain("/party");
    expect(link.getAttribute("href")).toContain(encodeURIComponent(game.id));
  });

  it("applies the shared latency and drop-message controls (behind the debug menu)", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    const harness = createHarness();
    renderRoute([`/games/${game.id}/test`], harness);
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
});

describe("ArenaPage — phone layout", () => {
  it("switches among four simulated players with tabs, all frames mounted", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    const harness = createHarness();
    renderRoute([`/games/${game.id}/test`], harness);
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

describe("ArenaPage — draft mode and source handoff", () => {
  it("runs an unsaved editor source in draft mode without a saved game", async () => {
    storeArenaSource({ gameId: "draft-abc", source: SOURCE });
    const harness = createHarness();
    renderRoute(["/test"], harness);
    await runToStart(harness.channels, 2);
    await waitFor(() => expect(screen.getByText("Test passed")).toBeInTheDocument());
    // No party launch for drafts (nothing saved to launch).
    expect(screen.queryByRole("link", { name: /Play with friends/ })).not.toBeInTheDocument();
    // Nothing was persisted (drafts have no saved-game row).
    expect(await gameRepository.list()).toHaveLength(0);
  });

  it("shows an empty state when no draft source was stored", async () => {
    const harness = createHarness();
    renderRoute(["/test"], harness);
    expect(await screen.findByText("Nothing to test yet")).toBeInTheDocument();
    expect(harness.channels).toHaveLength(0);
  });

  it("tests the editor's current source for a saved game when handed over", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SOURCE });
    const editedSource =
      "<!doctype html><html><head><title>Edited</title></head><body><p>edited</p></body></html>";
    storeArenaSource({ gameId: game.id, source: editedSource });
    const harness = createHarness();
    renderRoute([`/games/${game.id}/test`], harness);
    await desktopLayout();
    await runToStart(harness.channels, 2);
    const bootstraps = harness.windowMessages
      .map((message) => message.data as Record<string, unknown>)
      .filter((message) => message.type === "runtime.bootstrap");
    expect(bootstraps[0]?.gameSource).toBe(editedSource);
    // The saved source is untouched.
    const saved = await gameRepository.read(game.id);
    expect(saved.html).toBe(SOURCE);
  });
});
