import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PartyEngineState } from "../../lib/party/engine";
import { PartyPlayShell, type PartyPlayShellProps } from "./PartyPlayShell";

/**
 * In-game play shell tests (7.29 + 7.38 + 7.45): the compact top bar (logo
 * collapse, centered party URL), the mutually-exclusive menu / players /
 * browse panels, the players popup (7.45: a compact overlay anchored below
 * the top bar - never a full-page takeover - dismissed by Back, outside
 * click, or Escape; back button + host "Browse games"), and the confirmed
 * actions - Reload all is red and asks first, "Exit to lobby" ends the
 * game for everyone.
 */

function makeState(overrides: Partial<PartyEngineState> = {}): PartyEngineState {
  return {
    phase: "playing",
    phaseDetail: null,
    reconnectAttempts: 0,
    role: "creator",
    code: "ABCD",
    memberId: "member-a",
    displayName: "Player A",
    game: { gameId: "game-1", title: "Rocket Rumble", mode: "state" },
    members: [
      {
        memberId: "member-a",
        displayName: "Player A",
        isSelf: true,
        connectionId: "conn-a",
        connected: true,
        isGreeter: true,
        transferState: "complete",
        transferProgress: 1,
        transferDetail: "You have the game",
        ready: true,
      },
      {
        memberId: "member-b",
        displayName: "Player B",
        isSelf: false,
        connectionId: "conn-b",
        connected: true,
        isGreeter: false,
        transferState: "complete",
        transferProgress: 1,
        transferDetail: "You have the game",
        ready: true,
      },
    ],
    pendingJoinRequests: [],
    greeterMemberId: "member-a",
    amGreeter: true,
    authorityMemberId: "member-a",
    inviteUrl: "http://localhost:5173/join#code=ABCD&secret=invite-secret",
    connectionState: "connected",
    canStart: false,
    canForceStart: false,
    startBlockedReason: null,
    endedReason: null,
    classicGame: null,
    removedReason: null,
    classicFrameEpoch: 0,
    diagnostics: null,
    notices: [],
    lastError: null,
    ...overrides,
  };
}

async function renderShell(
  state: PartyEngineState,
  handlers: Partial<Omit<PartyPlayShellProps, "state" | "children">> = {},
) {
  const props: PartyPlayShellProps = {
    state,
    children: <div data-testid="game-frame" />,
    onEndGame: handlers.onEndGame ?? vi.fn(),
    onLeave: handlers.onLeave ?? vi.fn(),
    onReloadMyGame: handlers.onReloadMyGame ?? vi.fn(),
    onReloadAllGames: handlers.onReloadAllGames ?? vi.fn(),
    onKickMember: handlers.onKickMember ?? vi.fn(),
    onPickGame: handlers.onPickGame ?? vi.fn(),
    onPickPrebuilt: handlers.onPickPrebuilt ?? vi.fn(),
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // The shared GameBrowser renders router Links (e.g. "Build a game"); give
  // the shell a real router context like the lobby tests do.
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const buildRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/build",
    component: () => null,
  });
  const shellRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <PartyPlayShell {...props} />,
  });
  const routeTree = rootRoute.addChildren([buildRoute, shellRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const wrapper = ({ children: node }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
  );
  const result = render(<RouterProvider router={router} />, { wrapper });
  // The router matches asynchronously; wait for the top bar before
  // asserting (the same pattern the lobby tests use).
  await screen.findByRole("button", { name: /menu/i });
  return { props, ...result };
}

describe("PartyPlayShell in-game chrome (7.38)", () => {
  it("shows the centered rocketcrab.com party URL instead of the game name", async () => {
    await renderShell(makeState());
    expect(screen.getByLabelText("Party link rocketcrab.com/abcd")).toBeInTheDocument();
    expect(screen.queryByText("Rocket Rumble")).not.toBeInTheDocument();
    // No connected badge or game-code badge in the top bar anymore.
    expect(screen.queryByText("connected")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Party code ABCD")).not.toBeInTheDocument();
  });

  it("collapses the top bar to a floating logo on logo tap and reopens it (7.38)", async () => {
    await renderShell(makeState());
    await userEvent.click(screen.getByRole("button", { name: /hide the top bar/i }));
    // Only the floating logo remains; the bar (URL + menu) is gone.
    expect(screen.getByRole("button", { name: /show the top bar/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /menu/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Party link rocketcrab.com/abcd")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /show the top bar/i }));
    expect(screen.getByRole("button", { name: /menu/i })).toBeInTheDocument();
  });

  it("shows Reload my game to everyone and asks before Reload all (host, 7.38)", async () => {
    const onReloadMyGame = vi.fn();
    const onReloadAllGames = vi.fn();
    await renderShell(makeState(), { onReloadMyGame, onReloadAllGames });
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /reload my game/i }));
    expect(onReloadMyGame).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /reload all/i }));
    // Reload all warns first (players' games will be lost).
    const dialog = screen.getByRole("dialog", { name: /reload every player/i });
    expect(within(dialog).getByText(/will be lost/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    expect(onReloadAllGames).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /reload all/i }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: /reload every player/i })).getByRole("button", {
        name: /^reload all$/i,
      }),
    );
    expect(onReloadAllGames).toHaveBeenCalledTimes(1);
  });

  it("hides Reload all from joiners (host-only)", async () => {
    await renderShell(makeState({ role: "joiner" }));
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    expect(screen.getByRole("menuitem", { name: /reload my game/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /reload all/i })).not.toBeInTheDocument();
  });

  it("renames the emergency teardown to Exit to lobby and confirms (7.38)", async () => {
    const onEndGame = vi.fn();
    await renderShell(makeState(), { onEndGame });
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /exit to lobby/i }));
    const dialog = screen.getByRole("dialog", { name: /end the game for everyone/i });
    expect(within(dialog).getByText(/exit to the lobby/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /exit to lobby/i }));
    expect(onEndGame).toHaveBeenCalledTimes(1);
  });

  it("lets the host kick a member from the Players popup (7.29/7.38)", async () => {
    const onKickMember = vi.fn();
    await renderShell(makeState(), { onKickMember });
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /players/i }));
    const players = screen.getByRole("dialog", { name: "Players" });
    const kick = within(players).getByRole("button", { name: /kick/i });
    await userEvent.click(kick);
    expect(onKickMember).toHaveBeenCalledWith("member-b");
  });

  it("shows the players list as a compact popup that never covers the game frame (7.45)", async () => {
    await renderShell(makeState());
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /players/i }));
    const popup = screen.getByRole("dialog", { name: "Players" });
    // The popup carries its own title + Back row, so it never relies on the
    // fixed top bar for its header (no invisible controls under the bar).
    expect(within(popup).getByText(/^Players \(\d+\)$/)).toBeInTheDocument();
    expect(within(popup).getByRole("button", { name: /back to the game/i })).toBeInTheDocument();
    // The game frame stays mounted underneath and the top bar stays usable.
    expect(screen.getByTestId("game-frame")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /menu/i })).toBeInTheDocument();
  });

  it("dismisses the players popup on outside click, Escape, and Back (7.45)", async () => {
    await renderShell(makeState());
    const openPopup = async () => {
      await userEvent.click(screen.getByRole("button", { name: /menu/i }));
      await userEvent.click(screen.getByRole("menuitem", { name: /players/i }));
    };
    // Clicking outside (the invisible backdrop) closes it.
    await openPopup();
    expect(screen.getByRole("dialog", { name: "Players" })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("players-popup-backdrop"));
    expect(screen.queryByRole("dialog", { name: "Players" })).not.toBeInTheDocument();
    // Escape closes it.
    await openPopup();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Players" })).not.toBeInTheDocument();
    // The Back button closes it.
    await openPopup();
    await userEvent.click(screen.getByRole("button", { name: /back to the game/i }));
    expect(screen.queryByRole("dialog", { name: "Players" })).not.toBeInTheDocument();
  });

  it("hides kick and Browse games from joiners", async () => {
    await renderShell(makeState({ role: "joiner" }));
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /players/i }));
    const players = screen.getByRole("dialog", { name: "Players" });
    expect(within(players).queryByRole("button", { name: /kick/i })).not.toBeInTheDocument();
    expect(
      within(players).queryByRole("button", { name: /browse games/i }),
    ).not.toBeInTheDocument();
  });

  it("opens only one panel at a time (7.38)", async () => {
    await renderShell(makeState());
    // Menu opens first.
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    expect(screen.getByRole("menu", { name: /game menu/i })).toBeInTheDocument();
    // Opening Players closes the menu.
    await userEvent.click(screen.getByRole("menuitem", { name: /players/i }));
    expect(screen.queryByRole("menu", { name: /game menu/i })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Players" })).toBeInTheDocument();
    // The popup's Back button closes the panel.
    await userEvent.click(screen.getByRole("button", { name: /back to the game/i }));
    expect(screen.queryByRole("dialog", { name: "Players" })).not.toBeInTheDocument();
    // Browse (host) replaces Players — never both at once.
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /players/i }));
    await userEvent.click(screen.getByRole("button", { name: /browse games/i }));
    expect(screen.queryByRole("dialog", { name: "Players" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Pick a game" })).toBeInTheDocument();
  });

  it("browses games with the shared browse UI and picks from it (7.43)", async () => {
    const onPickGame = vi.fn();
    const onPickPrebuilt = vi.fn();
    await renderShell(makeState(), { onPickGame, onPickPrebuilt });
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /players/i }));
    await userEvent.click(screen.getByRole("button", { name: /browse games/i }));
    const browse = screen.getByRole("dialog", { name: "Pick a game" });
    // The SAME shared browse UI as /browse: search + category cards; the
    // list only shows once a category opens (10.9).
    expect(within(browse).getByRole("searchbox", { name: "Search games" })).toBeInTheDocument();
    await userEvent.click(within(browse).getByRole("button", { name: /All games/ }));
    const protobowl = within(browse).getByRole("button", { name: /Protobowl/ });
    await userEvent.click(protobowl);
    expect(onPickPrebuilt).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "classic", id: "protobowl" }),
    );
    // Back returns to the players popup.
    await userEvent.click(screen.getByRole("button", { name: /back to players/i }));
    expect(screen.getByRole("dialog", { name: "Players" })).toBeInTheDocument();
  });
});
