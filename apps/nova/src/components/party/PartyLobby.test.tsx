import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRouter,
  createRootRoute,
  createRoute,
} from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gameRepository } from "../../lib/games/instance";
import type { PartyEngineState } from "../../lib/party/engine";
import { resetPartyIdentityForTests, setSavedPlayerName } from "../../lib/party/identity";
import { saveBrowseContext } from "../../lib/browse/back-context";
import { PartyLobby, type PartyLobbyProps } from "./PartyLobby";
import type { PartyMemberView } from "../../lib/party/engine";

const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), danger: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("../../lib/toast", () => ({ toast: toastMock }));

const INVITE_URL = "http://localhost:2722/join#code=abcd&secret=invite-secret";

function makeState(overrides: Partial<PartyEngineState> = {}): PartyEngineState {
  return {
    phase: "lobby",
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
        transferState: "transferring",
        transferProgress: 0.5,
        transferDetail: "32 KB of 64 KB",
        ready: false,
      },
    ],
    hostMemberId: "member-a",
    amHost: overrides.amHost ?? overrides.role !== "joiner",
    authorityMemberId: "member-a",
    inviteUrl: INVITE_URL,
    partyCode: null,
    connectionState: "connected",
    canStart: false,
    startBlockedReason: "Waiting for every player's game to load and register.",
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

beforeEach(async () => {
  await gameRepository.clear();
  // Seed a name to hide the prompt by default; the prompt-specific test clears it.
  resetPartyIdentityForTests();
  setSavedPlayerName("Player A");
  toastMock.success.mockClear();
  toastMock.danger.mockClear();
  toastMock.warning.mockClear();
  toastMock.info.mockClear();
});

async function renderLobby(state: PartyEngineState, handlers: Partial<PartyLobbyProps> = {}) {
  cleanup(); // isolate: some tests render the lobby twice
  let setLobbyState: (next: PartyEngineState) => void = () => undefined;
  const queryClient = new QueryClient();
  const lobby = (props: PartyLobbyProps) => (
    <PartyLobby
      {...props}
      onStart={handlers.onStart ?? props.onStart}
      onLeave={handlers.onLeave ?? props.onLeave}
      onKickMember={handlers.onKickMember ?? props.onKickMember}
      onEditName={handlers.onEditName ?? props.onEditName}
    />
  );
  // PartyLobby renders router Links; give it a real router context.
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const libraryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/library",
    component: () => null,
  });
  const joinRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/join",
    component: () => null,
  });
  const gameDetailsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/game/$gameId",
    component: () => <p>Game details</p>,
  });
  const lobbyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: function LobbyWithState() {
      const [current, setCurrent] = useState(state);
      setLobbyState = setCurrent;
      return lobby({ ...handlers, state: current } as PartyLobbyProps);
    },
  });
  const routeTree = rootRoute.addChildren([libraryRoute, joinRoute, gameDetailsRoute, lobbyRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const result = render(<RouterProvider router={router} />, { wrapper });
  await result.findByRole("button", { name: /copy url/i });
  const update = (next: PartyEngineState) => act(() => setLobbyState(next));
  return { ...result, router, update };
}

describe("PartyLobby", () => {
  it("keeps player names and the invite secret out of attributes", async () => {
    // Session replay masks page text but records attributes as-is.
    const { container } = await renderLobby(makeState());
    const attributes = [...container.querySelectorAll("*")].flatMap((element) =>
      [...element.attributes].map((attribute) => attribute.value),
    );
    expect(attributes.filter((value) => /Player [AB]|invite-secret/.test(value))).toEqual([]);
  });

  it("lists players with connection + transfer states only", async () => {
    await renderLobby(makeState());
    const rowA = screen.getByTestId("party-member-member-a");
    const rowB = screen.getByTestId("party-member-member-b");
    expect(within(rowA).getByText("Player A")).toBeInTheDocument();
    expect(within(rowA).getByText("You, Host")).toBeInTheDocument();
    expect(within(rowA).getByTitle("Connected")).toBeInTheDocument();
    expect(within(rowA).queryByText("Game ready")).not.toBeInTheDocument();
    expect(within(rowA).queryByTitle("Ready")).not.toBeInTheDocument();
    expect(within(rowA).getByRole("button", { name: /edit your name/i })).toBeInTheDocument();
    expect(within(rowA).queryByText("(you)")).not.toBeInTheDocument();
    expect(within(rowA).queryByText("Greeter")).not.toBeInTheDocument();

    expect(within(rowB).getByText("Player B")).toBeInTheDocument();
    expect(within(rowB).getByRole("progressbar")).toBeInTheDocument();
    expect(within(rowB).getByText("32 KB of 64 KB")).toBeInTheDocument();
    expect(within(rowB).queryByTitle("Not ready")).not.toBeInTheDocument();
  });

  it("hides the start controls from joiners — start is host-only", async () => {
    const state = makeState({ role: "joiner", amHost: false });
    await renderLobby(state);
    expect(screen.queryByRole("button", { name: /start game/i })).not.toBeInTheDocument();
    // Guests can still browse; picking is explained on the game's page.
    expect(screen.getByRole("button", { name: /browse games/i })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy url/i })).toBeInTheDocument();
    expect(screen.getByText(/Players \(2\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /leave party/i })).toBeInTheDocument();
  });

  it("tells everyone when the party is outside the game's player range", async () => {
    const notice = "This game needs at least 3 players. Invite 1 more.";
    await renderLobby(
      makeState({ role: "joiner", amHost: false, playerLimitNotice: notice, canStart: true }),
    );
    expect(screen.getByTestId("player-limit-notice")).toHaveTextContent(notice);
  });

  it("leaves start enabled when the player range is not met", async () => {
    await renderLobby(
      makeState({ playerLimitNotice: "This game needs at least 3 players.", canStart: true }),
    );
    expect(screen.getByRole("button", { name: /start game/i })).toBeEnabled();
  });

  it("shows the start controls to the host only when the party is in the lobby", async () => {
    await renderLobby(makeState());
    expect(screen.queryByText(/not in the lobby yet/i)).not.toBeInTheDocument();
  });

  it("labels a host peer's tile 'Host', never 'Greeter'", async () => {
    const state = makeState({
      role: "joiner",
      members: [
        { ...makeState().members[0]!, isHost: false },
        {
          memberId: "member-b",
          displayName: "Player B",
          isSelf: false,
          connectionId: "conn-b",
          connected: true,
          isHost: true,
          transferState: "complete",
          transferProgress: 1,
          transferDetail: "Game received",
          ready: true,
        },
      ],
      hostMemberId: "member-b",
      amHost: false,
    });
    await renderLobby(state);
    const rowA = screen.getByTestId("party-member-member-a");
    const rowB = screen.getByTestId("party-member-member-b");
    expect(within(rowA).getByText("You")).toBeInTheDocument();
    expect(within(rowA).queryByText("Host")).not.toBeInTheDocument();
    expect(within(rowB).getByText("Host")).toBeInTheDocument();
    expect(within(rowB).queryByText("Greeter")).not.toBeInTheDocument();
  });

  it("distinguishes failed and incompatible transfer states", async () => {
    const state = makeState({
      members: [
        makeState().members[0] as PartyMemberView,
        {
          memberId: "member-b",
          displayName: "Player B",
          isSelf: false,
          connectionId: "conn-b",
          connected: true,
          isHost: false,
          transferState: "failed",
          transferProgress: null,
          transferDetail: "retries exhausted",
          ready: false,
        },
      ],
      startBlockedReason: "Player B could not receive the game.",
    });
    await renderLobby(state);
    const rowB = screen.getByTestId("party-member-member-b");
    expect(within(rowB).getByText("Failed")).toBeInTheDocument();
    expect(within(rowB).getByText("retries exhausted")).toBeInTheDocument();
  });

  it("shows no greeter/authority badges and no connection diagnostics", async () => {
    await renderLobby(makeState());
    expect(screen.queryByText(/Greeter:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Authority \(diagnostic\)/)).not.toBeInTheDocument();
    expect(screen.queryByText("Connection diagnostics")).not.toBeInTheDocument();
  });

  it("does not show the pick-a-game blocker text near the buttons", async () => {
    const state = makeState({
      game: null,
      canStart: false,
      startBlockedReason: "Pick a game before starting the party.",
    });
    await renderLobby(state);
    expect(screen.queryByText(/pick a game before starting/i)).not.toBeInTheDocument();
  });

  it("explains why starting is blocked without starting the game", async () => {
    const onStart = vi.fn();
    await renderLobby(makeState(), { onStart });
    expect(screen.queryByText(/waiting for every player/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /start game/i }));
    const dialog = await screen.findByRole("dialog", { name: "Can't start yet" });
    expect(within(dialog).getByText(/waiting for every player/i)).toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("toasts only the latest notice when the lobby opens, with no banner", async () => {
    const state = makeState({
      canStart: true,
      startBlockedReason: null,
      notices: [
        {
          id: "notice-1",
          level: "error",
          code: "test",
          message: "Player B could not receive the game.",
        },
        { id: "notice-2", level: "warn", code: "test", message: "Player C is reconnecting." },
      ],
    });
    await renderLobby(state);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(toastMock.warning).toHaveBeenCalledExactlyOnceWith("Player C is reconnecting.");
    expect(toastMock.danger).not.toHaveBeenCalled();
  });

  it("toasts each new notice at its level", async () => {
    const state = makeState({ canStart: true, startBlockedReason: null, notices: [] });
    const { update } = await renderLobby(state);
    update({
      ...state,
      notices: [
        {
          id: "notice-1",
          level: "warn",
          code: "test",
          message: "Player B was removed from the party.",
        },
        { id: "notice-2", level: "info", code: "test", message: "Player C joined the party." },
      ],
    });
    expect(toastMock.warning).toHaveBeenCalledWith("Player B was removed from the party.");
    expect(toastMock.info).toHaveBeenCalledWith("Player C joined the party.");
  });

  it("does not re-toast a membership notice on ordinary re-renders (dedupe)", async () => {
    const state = makeState({
      canStart: true,
      startBlockedReason: null,
      notices: [
        { id: "notice-1", level: "info", code: "test", message: "Player B joined the party." },
      ],
    });
    await renderLobby(state);
    expect(toastMock.info).toHaveBeenCalledTimes(1);
    // Toggling a local modal must not retrigger an already-seen membership toast.
    await userEvent.click(screen.getByRole("button", { name: /qr code/i }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Scan to join the party" })).getByRole("button", {
        name: /close/i,
      }),
    );
    expect(toastMock.info).toHaveBeenCalledTimes(1);
  });

  it("shows NO game-ended alert after a game ends — the ended banner is gone", async () => {
    const state = makeState({
      endedReason: "host_closed",
      canStart: false,
      startBlockedReason: "The game ended; leave the party to play again.",
      notices: [
        { id: "notice-1", level: "info", code: "test", message: "Player B joined the party." },
        { id: "notice-2", level: "info", code: "test", message: "The game started." },
        { id: "notice-3", level: "info", code: "test", message: "The game ended (host_closed)." },
      ],
    });
    await renderLobby(state);
    expect(screen.queryByText(/the game ended\./i)).not.toBeInTheDocument();
    expect(screen.queryByText(/the host closed it/i)).not.toBeInTheDocument();
    expect(screen.queryByText("The game ended (host_closed).")).not.toBeInTheDocument();
    expect(screen.queryByText("Player B joined the party.")).not.toBeInTheDocument();
    expect(screen.queryByText("The game started.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("places the action row above the players box and leave at the bottom", async () => {
    await renderLobby(makeState());
    const browse = screen.getByRole("button", { name: /browse games/i });
    const start = screen.getByRole("button", { name: /start game/i });
    const players = screen.getByText(/Players \(2\)/);
    const leave = screen.getByRole("button", { name: /leave party/i });
    expect(browse.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(start.compareDocumentPosition(players) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(players.compareDocumentPosition(leave) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers start requirements while players are waiting and starts once they are ready", async () => {
    const blocked = await renderLobby(makeState());
    expect(blocked.getByRole("button", { name: /start game/i })).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );

    const ready = makeState({
      members: [
        makeState().members[0] as PartyMemberView,
        {
          memberId: "member-b",
          displayName: "Player B",
          isSelf: false,
          connectionId: "conn-b",
          connected: true,
          isHost: false,
          transferState: "complete",
          transferProgress: 1,
          transferDetail: "Game received",
          ready: true,
        },
      ],
      canStart: true,
      startBlockedReason: null,
    });
    const onStart = vi.fn();
    const readyLobby = await renderLobby(ready, { onStart });
    const start = readyLobby.getByRole("button", { name: /start game/i });
    expect(start).not.toBeDisabled();
    await userEvent.click(start);
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("calls the leave callback", async () => {
    const onLeave = vi.fn();
    await renderLobby(makeState(), { onLeave });
    await userEvent.click(screen.getByRole("button", { name: /leave party/i }));
    expect(onLeave).toHaveBeenCalled();
  });

  it("browses games with the shared browse UI when the party has none", async () => {
    const state = makeState({
      game: null,
      canStart: false,
      startBlockedReason: "Pick a game before starting the party.",
    });
    await renderLobby(state);
    expect(screen.getByText("As the host, you must select a game.")).toBeInTheDocument();
    expect(screen.queryByText(/no game yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you must select the game/i)).not.toBeInTheDocument();
    const browseButton = screen.getByRole("button", { name: /browse games/i });
    expect(browseButton).toBeInTheDocument();
    await userEvent.click(browseButton);
    expect(screen.getByRole("searchbox", { name: "Search games" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /My games/ })).toBeInTheDocument();
    expect(screen.queryByText("Nova Quiz")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /back to lobby/i })).not.toBeInTheDocument();
  });

  it("links a saved game to its details page instead of picking it", async () => {
    const state = makeState({ game: null, canStart: false });
    const game = await gameRepository.create({
      title: "Rocket Rumble",
      html: "<!doctype html><html><body><p>rockets</p></body></html>",
    });
    await renderLobby(state);
    await userEvent.click(screen.getByRole("button", { name: /browse games/i }));
    await userEvent.click(screen.getByRole("button", { name: /My games/ }));
    const savedLink = await screen.findByRole("link", { name: /Rocket Rumble/ });
    expect(savedLink.getAttribute("href")).toBe(`/game/${game.id}?from=party-browse`);
    expect(savedLink.tagName.toLowerCase()).toBe("a");
  });

  it("links a listed game to its details page instead of picking it", async () => {
    const state = makeState({ game: null, canStart: false });
    await renderLobby(state);
    await userEvent.click(screen.getByRole("button", { name: /browse games/i }));
    expect(screen.queryByTestId("browser-brand-row")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Trivia/ }));
    const protobowl = await screen.findByRole("link", { name: /Protobowl/ });
    expect(protobowl.getAttribute("href")).toBe("/game/protobowl?from=party-browse");
  });

  it("tells joiners the party is waiting when it has no game — naming the host", async () => {
    const state = makeState({ role: "joiner", amHost: false, game: null });
    await renderLobby(state);
    expect(screen.getByText("Waiting for Player A to select a game")).toBeInTheDocument();
    expect(screen.queryByText("No game selected yet")).not.toBeInTheDocument();
  });

  it("renames on the same name screen as first entry, without leaving the lobby", async () => {
    const onEditName = vi.fn();
    await renderLobby(makeState(), { onEditName });
    expect(screen.queryByLabelText("Enter your name here")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /edit your name/i }));
    const input = await screen.findByLabelText("Enter your name here");
    expect(screen.getByRole("heading", { name: "What's your name?" })).toBeInTheDocument();
    expect(input).toHaveValue("Player A");
    await userEvent.clear(input);
    await userEvent.type(input, "Ada");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onEditName).toHaveBeenCalledWith("Ada");
    await waitFor(() =>
      expect(screen.queryByLabelText("Enter your name here")).not.toBeInTheDocument(),
    );
  });

  it("Browse games always opens the top-level menu, not the last category", async () => {
    saveBrowseContext("drawing", "");
    await renderLobby(makeState());
    await userEvent.click(screen.getByRole("button", { name: /browse games/i }));
    expect(await screen.findByRole("region", { name: "Categories" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Games" })).not.toBeInTheDocument();
  });

  it("never nags about a missing name in the lobby (names are set before joining)", async () => {
    resetPartyIdentityForTests();
    await renderLobby(makeState());
    expect(screen.queryByLabelText("Set your name")).not.toBeInTheDocument();
    expect(screen.queryByText(/you haven't set a name yet/i)).not.toBeInTheDocument();
  });

  it("does not prompt for a name once one is saved", async () => {
    await renderLobby(makeState());
    expect(screen.queryByLabelText("Set your name")).not.toBeInTheDocument();
  });

  it("labels the leave button End party when alone in the party", async () => {
    const state = makeState({
      members: [makeState().members[0] as PartyMemberView],
    });
    await renderLobby(state);
    expect(screen.getByRole("button", { name: /end party/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /leave party/i })).not.toBeInTheDocument();
  });

  it("offers start requirements after a game ends", async () => {
    const state = makeState({
      endedReason: "host_closed",
      canStart: false,
      startBlockedReason: "The game ended; leave the party to play again.",
    });
    await renderLobby(state);
    expect(screen.queryByText(/the game ended\./i)).not.toBeInTheDocument();
    expect(screen.queryByText(/the host closed it/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText("The game ended; leave the party to play again."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start game/i })).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );
  });

  it("shows a host-only kick button that confirms before removing the member", async () => {
    const state = makeState({
      members: [
        {
          memberId: "member-a",
          displayName: "Alex",
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
          displayName: "Bree",
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
    });
    const onKickMember = vi.fn();
    await renderLobby(state, { onKickMember });
    const kick = screen.getByRole("button", { name: /kick/i });
    await userEvent.click(kick);
    expect(onKickMember).not.toHaveBeenCalled();
    const confirm = await screen.findByRole("dialog", { name: "Kick Bree from the party?" });
    await userEvent.click(within(confirm).getByRole("button", { name: /^kick player$/i }));
    expect(onKickMember).toHaveBeenCalledWith("member-b");
  });

  it("hides the kick button from joiners", async () => {
    const state = makeState({
      role: "joiner",
      members: [
        {
          memberId: "member-a",
          displayName: "Alex",
          isSelf: false,
          connectionId: "conn-a",
          connected: true,
          isHost: false,
          transferState: "complete",
          transferProgress: 1,
          transferDetail: "You have the game",
          ready: true,
        },
        {
          memberId: "member-b",
          displayName: "Bree",
          isSelf: true,
          connectionId: "conn-b",
          connected: true,
          isHost: true,
          transferState: "complete",
          transferProgress: 1,
          transferDetail: "You have the game",
          ready: true,
        },
      ],
    });
    await renderLobby(state);
    expect(screen.queryByRole("button", { name: /kick/i })).not.toBeInTheDocument();
  });

  it("shows the invite card with Copy URL + QR and no code/URL text", async () => {
    await renderLobby(makeState());
    expect(screen.getByText("Get your friends to join!")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy url/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /qr code/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^share$/i })).not.toBeInTheDocument();
    // Do not render the full secret-bearing invite URL.
    expect(screen.queryByText(`${window.location.host}/abcd`)).not.toBeInTheDocument();
    expect(screen.queryByText(INVITE_URL)).not.toBeInTheDocument();
    expect(screen.queryByText(/invite-secret/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Party invite QR code")).not.toBeInTheDocument();
  });

  it("shares the invite URL through the native share sheet when supported", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "canShare", {
      value: vi.fn(() => true),
      configurable: true,
    });
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    await renderLobby(makeState());
    const shareButton = screen.getByRole("button", { name: /^share$/i });
    await userEvent.click(shareButton);
    expect(share).toHaveBeenCalledWith({
      title: "Play rocketcrab with me!",
      url: INVITE_URL,
    });
    expect(screen.getByRole("button", { name: /copy url/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /qr code/i })).toBeInTheDocument();
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });

  it("hides the native Share button when canShare rejects the URL", async () => {
    Object.defineProperty(navigator, "canShare", {
      value: vi.fn(() => false),
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: vi.fn().mockResolvedValue(undefined),
      configurable: true,
    });
    await renderLobby(makeState());
    expect(screen.queryByRole("button", { name: /^share$/i })).not.toBeInTheDocument();
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });

  it("copies the invite URL from the Copy URL button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await renderLobby(makeState());
    await userEvent.click(screen.getByRole("button", { name: /copy url/i }));
    expect(writeText).toHaveBeenCalledWith(INVITE_URL);
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  it("offers no separate Copy short link affordance — copying is always the long URL", async () => {
    await renderLobby(makeState());
    expect(screen.queryByRole("button", { name: /copy short link/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/easy to type or read aloud/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy url/i })).toBeInTheDocument();
    expect(screen.queryByText("http://localhost:2722/abcd")).not.toBeInTheDocument();
    expect(screen.queryByText(/invite-secret/)).not.toBeInTheDocument();
  });

  it("opens the QR code in a modal without the invite secret", async () => {
    await renderLobby(makeState());
    await userEvent.click(screen.getByRole("button", { name: /qr code/i }));
    const dialog = screen.getByRole("dialog", { name: "Scan to join the party" });
    expect(within(dialog).getByLabelText("Party invite QR code")).toBeInTheDocument();
    expect(screen.queryByText(/invite-secret/)).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /close/i }));
    expect(screen.queryByLabelText("Party invite QR code")).not.toBeInTheDocument();
  });

  it("shows the selected game for the host without the welcome heading", async () => {
    await renderLobby(makeState());
    const welcome = screen.getByLabelText("Welcome");
    expect(within(welcome).queryByText("Welcome to rocketcrab!")).not.toBeInTheDocument();
    expect(within(welcome).getByText("You've selected")).toBeInTheDocument();
    expect(within(welcome).getByText("Rocket Rumble")).toBeInTheDocument();
    expect(
      within(welcome).getByText("As the host, you have to start the game!"),
    ).toBeInTheDocument();
    expect(
      within(welcome).getByRole("link", { name: /what is rocket rumble\?/i }),
    ).toBeInTheDocument();
  });

  it("thanks the players after a game and offers what to do next", async () => {
    await renderLobby(makeState(), { playedTitle: "Rocket Rumble" });
    const thanks = screen.getByLabelText("Thanks for playing");
    expect(thanks).toHaveTextContent("Thanks for playing Rocket Rumble on rocketcrab!");
    expect(thanks).toHaveTextContent("Play it again, or browse for your next game.");
    expect(screen.queryByLabelText("Welcome")).not.toBeInTheDocument();
  });

  it("shows the guest welcome copy when a game is selected — naming the host", async () => {
    const state = makeState({
      role: "joiner",
      members: [
        { ...makeState().members[0]!, isHost: false },
        {
          memberId: "member-b",
          displayName: "Bob",
          isSelf: false,
          connectionId: "conn-b",
          connected: true,
          isHost: true,
          transferState: "complete",
          transferProgress: 1,
          transferDetail: "Game received",
          ready: true,
        },
      ],
      hostMemberId: "member-b",
      amHost: false,
    });
    await renderLobby(state);
    const welcome = screen.getByLabelText("Welcome");
    expect(within(welcome).getByText("Bob has selected")).toBeInTheDocument();
    expect(within(welcome).queryByText("You've selected")).not.toBeInTheDocument();
    expect(
      within(welcome).getByText("Waiting for the host to start the game…"),
    ).toBeInTheDocument();
    expect(within(welcome).queryByText(/as the host/i)).not.toBeInTheDocument();
  });

  it("shows the welcome card without a game selected", async () => {
    const state = makeState({ game: null });
    await renderLobby(state);
    const welcome = screen.getByLabelText("Welcome");
    expect(within(welcome).getByText("Welcome to rocketcrab!")).toBeInTheDocument();
    expect(within(welcome).getByText("As the host, you must select a game.")).toBeInTheDocument();
    expect(within(welcome).queryByText("You've selected")).not.toBeInTheDocument();
  });

  it("navigates to the shared saved-game details page from What is GameName?", async () => {
    const game = await gameRepository.create({
      title: "Rocket Rumble",
      description: "Blast off with friends.",
      html: "<!doctype html><html><body><p>rockets</p></body></html>",
    });
    const state = makeState({ game: { kind: "nova", gameId: game.id, title: game.title } });
    const onLeave = vi.fn();
    const { router } = await renderLobby(state, { onLeave });
    const detailsLink = screen.getByRole("link", { name: /what is rocket rumble\?/i });
    expect(detailsLink.getAttribute("href")).toBe(`/game/${game.id}?from=party`);
    await userEvent.click(detailsLink);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/game/${game.id}`));
    expect(screen.getByText("Game details")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("navigates prebuilt games from What is GameName? to shared details", async () => {
    const state = makeState({ game: { kind: "nova", gameId: "drawphone", title: "Drawphone" } });
    const { router } = await renderLobby(state);
    const detailsLink = screen.getByRole("link", { name: /what is drawphone\?/i });
    expect(detailsLink.getAttribute("href")).toBe("/game/drawphone?from=party");
    await userEvent.click(detailsLink);
    await waitFor(() => expect(router.state.location.pathname).toBe("/game/drawphone"));
    expect(screen.getByText("Game details")).toBeInTheDocument();
  });
});
