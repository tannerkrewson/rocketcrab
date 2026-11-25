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

/** Play-shell controls and overlays must keep the running frame mounted. */

function makeState(overrides: Partial<PartyEngineState> = {}): PartyEngineState {
  return {
    phase: "playing",
    phaseDetail: null,
    joinStage: null,
    reconnectAttempts: 0,
    role: "creator",
    memberId: "member-a",
    displayName: "Player A",
    game: { kind: "nova", gameId: "game-1", title: "Rocket Rumble" },
    playerLimitNotice: null,
    members: [
      {
        memberId: "member-a",
        displayName: "Player A",
        isSelf: true,
        connectionId: "conn-a",
        connected: true,
        isHost: true,
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
        isHost: false,
        transferState: "complete",
        transferProgress: 1,
        transferDetail: "You have the game",
        ready: true,
      },
    ],
    hostMemberId: "member-a",
    amHost: overrides.amHost ?? overrides.role !== "joiner",
    authorityMemberId: "member-a",
    inviteUrl: "http://localhost:2722/join#code=abcd&secret=invite-secret",
    partyCode: null,
    connectionState: "connected",
    canStart: false,
    startBlockedReason: null,
    endedReason: null,
    removedReason: null,
    diagnostics: null,
    notices: [],
    runtimeLogs: [],
    lastError: null,
    peerLink: null,
    sharedGames: [],
    offeredGames: [],
    myOffer: null,
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
    onSwitchGame: handlers.onSwitchGame ?? vi.fn(async () => {}),
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // GameBrowser renders router links, so the shell needs a real router context.
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
  // Router matching is asynchronous; wait for the bar before assertions.
  await screen.findByRole("button", { name: /menu/i });
  return { props, ...result };
}

describe("PartyPlayShell in-game chrome", () => {
  it("lets every player open the invite card from the menu", async () => {
    await renderShell(makeState({ role: "joiner", amHost: false }));
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /invite friends/i }));
    const dialog = await screen.findByRole("dialog", { name: "Get your friends to join!" });
    expect(within(dialog).getByRole("button", { name: /copy url/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /qr code/i })).toBeInTheDocument();
  });

  it("shows the rocketcrab wordmark in the top bar", async () => {
    await renderShell(makeState());
    expect(screen.getByRole("button", { name: "Copy the invite link" })).toHaveTextContent(
      "rocketcrab.com",
    );
    expect(screen.queryByText("Rocket Rumble")).not.toBeInTheDocument();
    expect(screen.queryByText("connected")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Party code ABCD")).not.toBeInTheDocument();
  });

  it("collapses and reopens the top bar using its toggle", async () => {
    await renderShell(makeState());
    await userEvent.click(screen.getByRole("button", { name: /hide the top bar/i }));
    expect(screen.getByRole("button", { name: /show the top bar/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /menu/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy the invite link" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /show the top bar/i }));
    expect(screen.getByRole("button", { name: /menu/i })).toBeInTheDocument();
  });

  it("confirms both reload actions for the host", async () => {
    const onReloadMyGame = vi.fn();
    const onReloadAllGames = vi.fn();
    await renderShell(makeState(), { onReloadMyGame, onReloadAllGames });
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /reload my game/i }));
    const reloadMine = await screen.findByRole("dialog", { name: "Reload my game?" });
    expect(within(reloadMine).getByText(/lose unsaved progress/i)).toBeInTheDocument();
    expect(onReloadMyGame).not.toHaveBeenCalled();
    await userEvent.click(within(reloadMine).getByRole("button", { name: "Cancel" }));
    expect(onReloadMyGame).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /reload my game/i }));
    await userEvent.click(
      within(await screen.findByRole("dialog", { name: "Reload my game?" })).getByRole("button", {
        name: "Reload my game",
      }),
    );
    expect(onReloadMyGame).toHaveBeenCalledTimes(1);
    expect(onReloadAllGames).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /reload all/i }));
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
    await renderShell(makeState({ role: "joiner", amHost: false }));
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    expect(screen.getByRole("menuitem", { name: /reload my game/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /reload all/i })).not.toBeInTheDocument();
  });

  it("renames the emergency teardown to Exit to lobby and confirms", async () => {
    const onEndGame = vi.fn();
    await renderShell(makeState(), { onEndGame });
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /exit to lobby/i }));
    const dialog = screen.getByRole("dialog", { name: /end the game for everyone/i });
    expect(within(dialog).getByText(/exit to the lobby/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /exit to lobby/i }));
    expect(onEndGame).toHaveBeenCalledTimes(1);
  });

  it("lets the host kick a member from the Players popup after confirming", async () => {
    const onKickMember = vi.fn();
    await renderShell(makeState(), { onKickMember });
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /players/i }));
    const players = screen.getByRole("dialog", { name: "Players" });
    // Session replay masks page text but records attributes as-is.
    const attributes = [...document.body.querySelectorAll("*")].flatMap((element) =>
      [...element.attributes].map((attribute) => attribute.value),
    );
    expect(attributes.filter((value) => /Player [AB]/.test(value))).toEqual([]);
    const kick = within(players).getByRole("button", { name: /kick/i });
    await userEvent.click(kick);
    expect(onKickMember).not.toHaveBeenCalled();
    const confirm = screen.getByRole("dialog", { name: /kick a player/i });
    expect(within(confirm).getByText(/Kick Player B from the party\?/)).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole("button", { name: /^kick player$/i }));
    expect(onKickMember).toHaveBeenCalledWith("member-b");
  });

  it("cancels the kick confirmation without removing anyone", async () => {
    const onKickMember = vi.fn();
    await renderShell(makeState(), { onKickMember });
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /players/i }));
    const players = screen.getByRole("dialog", { name: "Players" });
    await userEvent.click(within(players).getByRole("button", { name: /kick/i }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: /kick a player/i })).getByRole("button", {
        name: /^cancel$/i,
      }),
    );
    expect(onKickMember).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Players" })).toBeInTheDocument();
  });

  it("shows the players list as a compact popup that never covers the game frame", async () => {
    await renderShell(makeState());
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /players/i }));
    const popup = screen.getByRole("dialog", { name: "Players" });
    expect(within(popup).getByText(/^Players \(\d+\)$/)).toBeInTheDocument();
    expect(within(popup).getByRole("button", { name: /back to the game/i })).toBeInTheDocument();
    expect(screen.getByTestId("game-frame")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /menu/i })).toBeInTheDocument();
  });

  it("dismisses the players popup on outside click, Escape, and Back", async () => {
    await renderShell(makeState());
    const openPopup = async () => {
      await userEvent.click(screen.getByRole("button", { name: /menu/i }));
      await userEvent.click(screen.getByRole("menuitem", { name: /players/i }));
    };
    await openPopup();
    expect(screen.getByRole("dialog", { name: "Players" })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("players-popup-backdrop"));
    expect(screen.queryByRole("dialog", { name: "Players" })).not.toBeInTheDocument();
    await openPopup();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Players" })).not.toBeInTheDocument();
    await openPopup();
    await userEvent.click(screen.getByRole("button", { name: /back to the game/i }));
    expect(screen.queryByRole("dialog", { name: "Players" })).not.toBeInTheDocument();
  });

  it("lets joiners browse and hides kick controls", async () => {
    await renderShell(makeState({ role: "joiner", amHost: false }));
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    expect(screen.getByRole("menuitem", { name: /browse games/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: /players/i }));
    const players = screen.getByRole("dialog", { name: "Players" });
    expect(within(players).queryByRole("button", { name: /kick/i })).not.toBeInTheDocument();
    expect(
      within(players).queryByRole("button", { name: /browse games/i }),
    ).not.toBeInTheDocument();
  });

  it("opens only one panel at a time", async () => {
    await renderShell(makeState());
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    expect(screen.getByRole("menu", { name: /game menu/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: /players/i }));
    expect(screen.queryByRole("menu", { name: /game menu/i })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Players" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /back to the game/i }));
    expect(screen.queryByRole("dialog", { name: "Players" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /browse games/i }));
    expect(screen.queryByRole("menu", { name: /game menu/i })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Pick a game" })).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Pick a game" })).getByRole("button", {
        name: "Back",
      }),
    );
    expect(screen.queryByRole("dialog", { name: "Pick a game" })).not.toBeInTheDocument();
  });

  it("opens a game's details and switches only after the host confirms", async () => {
    const onSwitchGame = vi.fn(async () => {});
    await renderShell(makeState(), { onSwitchGame });
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /browse games/i }));
    const browse = screen.getByRole("dialog", { name: "Pick a game" });
    await userEvent.click(within(browse).getByRole("button", { name: /Trivia/ }));
    await userEvent.click(within(browse).getByRole("button", { name: /Protobowl/ }));

    const details = screen.getByRole("dialog", { name: "About Protobowl" });
    expect(onSwitchGame).not.toHaveBeenCalled();
    await userEvent.click(within(details).getByRole("button", { name: "Switch game" }));
    const confirmation = screen.getByRole("dialog", { name: "Switch to Protobowl?" });
    expect(onSwitchGame).not.toHaveBeenCalled();
    await userEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "About Protobowl" })).toBeInTheDocument();
    expect(onSwitchGame).not.toHaveBeenCalled();

    await userEvent.click(within(details).getByRole("button", { name: "Switch game" }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Switch to Protobowl?" })).getByRole("button", {
        name: "Switch game",
      }),
    );
    expect(onSwitchGame).toHaveBeenCalledWith("protobowl");
  });

  it("lets a guest open a game from the in-game library", async () => {
    await renderShell(makeState({ amHost: false }));
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /browse games/i }));
    const browse = screen.getByRole("dialog", { name: "Pick a game" });
    await userEvent.click(within(browse).getByRole("button", { name: /Trivia/ }));
    await userEvent.click(within(browse).getByRole("button", { name: /Protobowl/ }));
    const details = screen.getByRole("dialog", { name: "About Protobowl" });
    expect(within(details).queryByRole("button", { name: "Switch game" })).not.toBeInTheDocument();
  });

  it("closes the in-game browse panel from the browser's unified back", async () => {
    await renderShell(makeState());
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /browse games/i }));
    const browse = screen.getByRole("dialog", { name: "Pick a game" });
    await userEvent.click(within(browse).getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("dialog", { name: "Pick a game" })).not.toBeInTheDocument();
  });

  it("opens About this game from the menu", async () => {
    const state = makeState({ game: { kind: "nova", gameId: "drawphone", title: "Drawphone" } });
    await renderShell(state);
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /about this game/i }));
    const dialog = screen.getByRole("dialog", { name: "About Drawphone" });
    expect(within(dialog).getByText(/In Drawphone, there are no winners/)).toBeInTheDocument();
    expect(screen.getByTestId("game-frame")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /close dialog/i }));
    expect(screen.queryByRole("dialog", { name: "About Drawphone" })).not.toBeInTheDocument();
  });

  it("copies the invite URL from the wordmark", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await renderShell(makeState());
    await userEvent.click(screen.getByRole("button", { name: "Copy the invite link" }));
    expect(writeText).toHaveBeenCalledWith(
      "http://localhost:2722/join#code=abcd&secret=invite-secret",
    );
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  it("shows and copies the party's short address once it has a code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await renderShell(makeState({ partyCode: "rcxq" }));
    const address = screen.getByRole("button", { name: "Copy the party link" });
    expect(address).toHaveTextContent("rocketcrab.com/rcxq");
    const attributes = [...document.body.querySelectorAll("*")].flatMap((element) =>
      [...element.attributes].map((attribute) => attribute.value),
    );
    expect(attributes.filter((value) => value.includes("rcxq"))).toEqual([]);
    await userEvent.click(address);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/rcxq`);
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
});
