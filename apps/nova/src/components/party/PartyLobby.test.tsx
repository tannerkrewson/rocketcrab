import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRouter,
  createRootRoute,
  createRoute,
} from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gameRepository } from "../../lib/games/instance";
import type { PartyEngineState } from "../../lib/party/engine";
import { PartyLobby, type PartyLobbyProps } from "./PartyLobby";
import type { PartyMemberView } from "../../lib/party/engine";

/**
 * Party lobby UI tests (P4): the lobby renders the classic status card,
 * the QR invite and copyable invite link, the player list distinguishing
 * waiting / transferring / ready / failed states, the greeter and the
 * diagnostic authority labels, start / force-start / leave controls, and
 * the greeter's join-request approval row.
 */

const INVITE_URL = "http://localhost:5173/join#code=ABCD&secret=invite-secret";

function makeState(overrides: Partial<PartyEngineState> = {}): PartyEngineState {
  return {
    phase: "lobby",
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
        transferState: "transferring",
        transferProgress: 0.5,
        transferDetail: "32 KB of 64 KB",
        ready: false,
      },
    ],
    pendingJoinRequests: [],
    greeterMemberId: "member-a",
    amGreeter: true,
    authorityMemberId: "member-a",
    inviteUrl: INVITE_URL,
    connectionState: "connected",
    canStart: false,
    canForceStart: false,
    startBlockedReason: "Waiting for every player's game to load and register.",
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

beforeEach(async () => {
  await gameRepository.clear();
});

async function renderLobby(state: PartyEngineState, handlers: Partial<PartyLobbyProps> = {}) {
  cleanup(); // isolate: some tests render the lobby twice
  const queryClient = new QueryClient();
  const lobby = (props: PartyLobbyProps) => (
    <PartyLobby
      {...props}
      onApprove={handlers.onApprove ?? props.onApprove}
      onReject={handlers.onReject ?? props.onReject}
      onStart={handlers.onStart ?? props.onStart}
      onLeave={handlers.onLeave ?? props.onLeave}
      onRefreshDiagnostics={handlers.onRefreshDiagnostics ?? props.onRefreshDiagnostics}
      onPickGame={handlers.onPickGame ?? props.onPickGame}
      onPickPrebuilt={handlers.onPickPrebuilt ?? props.onPickPrebuilt}
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
  const lobbyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => lobby({ state, ...handlers } as PartyLobbyProps),
  });
  const routeTree = rootRoute.addChildren([libraryRoute, lobbyRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const result = render(<RouterProvider router={router} />, { wrapper });
  await result.findByRole("button", { name: /start game/i });
  return result;
}

describe("PartyLobby", () => {
  it("lists players in the classic grid with transfer and ready states (10.8)", async () => {
    await renderLobby(makeState());
    const rowA = screen.getByTestId("party-member-member-a");
    const rowB = screen.getByTestId("party-member-member-b");
    // Own tile: centered name, "You, Host" role label (creator + self),
    // connected + ready indicators, transfer complete, and the pencil.
    expect(within(rowA).getByText("Player A")).toBeInTheDocument();
    expect(within(rowA).getByText("You, Host")).toBeInTheDocument();
    expect(within(rowA).getByTitle("Connected")).toBeInTheDocument();
    expect(within(rowA).getByTitle("Ready")).toBeInTheDocument();
    expect(within(rowA).getByText("Game ready")).toBeInTheDocument();
    expect(within(rowA).getByRole("button", { name: /edit your name/i })).toBeInTheDocument();
    // The dense badge rows are gone.
    expect(within(rowA).queryByText("(you)")).not.toBeInTheDocument();
    expect(within(rowA).queryByText("Greeter")).not.toBeInTheDocument();

    // Peer tile: name, transferring progress bar with byte detail.
    expect(within(rowB).getByText("Player B")).toBeInTheDocument();
    expect(within(rowB).getByRole("progressbar")).toBeInTheDocument();
    expect(within(rowB).getByText("32 KB of 64 KB")).toBeInTheDocument();
    expect(within(rowB).getByTitle("Not ready")).toBeInTheDocument();
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
          isGreeter: false,
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

  it("hides the greeter and authority badges but keeps them in diagnostics (10.7)", async () => {
    const state = makeState({
      diagnostics: {
        connectionState: "connected",
        selfConnectionId: "conn-a",
        room: "room-1",
        sessionId: "session-1",
        relays: null,
        joinErrors: null,
        peers: [],
        lastQuality: [],
      },
    });
    await renderLobby(state);
    // Gone from the lobby itself.
    expect(screen.queryByText(/Greeter:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Authority \(diagnostic\)/)).not.toBeInTheDocument();
    // Still accessible in the diagnostics panel.
    await userEvent.click(screen.getByText("Connection diagnostics"));
    expect(screen.getByText(/greeter: Player A/)).toBeInTheDocument();
    expect(screen.getByText(/authority: Player A/)).toBeInTheDocument();
  });

  it("does not show the pick-a-game blocker text near the buttons (10.7)", async () => {
    const state = makeState({
      game: null,
      canStart: false,
      canForceStart: false,
      startBlockedReason: "Pick a game before starting the party.",
    });
    await renderLobby(state);
    expect(screen.queryByText(/pick a game before starting/i)).not.toBeInTheDocument();
  });

  it("shows the start-blocked reason as a styled alert when a game is selected (10.7)", async () => {
    const state = makeState({
      startBlockedReason: "Waiting for every player's game to load and register.",
    });
    await renderLobby(state);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("alert-warning");
    expect(within(alert).getByText(/waiting for every player/i)).toBeInTheDocument();
  });

  it("styles lobby notices as alerts instead of bare text (10.7)", async () => {
    const state = makeState({
      canStart: true,
      startBlockedReason: null,
      notices: [
        { id: "notice-1", level: "error", message: "Player B could not receive the game." },
        { id: "notice-2", level: "warn", message: "Player C is reconnecting." },
        { id: "notice-3", level: "info", message: "Your game loaded and registered." },
      ],
    });
    await renderLobby(state);
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(3);
    expect(alerts[0]).toHaveClass("alert-error");
    expect(alerts[1]).toHaveClass("alert-warning");
    expect(alerts[2]).toHaveClass("alert-info");
    expect(within(alerts[0]).getByText("Player B could not receive the game.")).toBeInTheDocument();
  });

  it("places the action row above the players box and leave at the bottom (10.7)", async () => {
    await renderLobby(makeState());
    const browse = screen.getByRole("button", { name: /browse games/i });
    const start = screen.getByRole("button", { name: /start game/i });
    const players = screen.getByText(/Players \(2\)/);
    const leave = screen.getByRole("button", { name: /leave party/i });
    // Browse (left) and start (right) sit side by side ABOVE the players box.
    expect(browse.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(start.compareDocumentPosition(players) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Leave sits below the players box.
    expect(players.compareDocumentPosition(leave) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("disables start while players are not ready and enables it when they are", async () => {
    const blocked = await renderLobby(makeState());
    expect(blocked.getByRole("button", { name: /start game/i })).toBeDisabled();
    expect(blocked.getByText(/waiting for every player/i)).toBeInTheDocument();

    const ready = makeState({
      members: [
        makeState().members[0] as PartyMemberView,
        {
          memberId: "member-b",
          displayName: "Player B",
          isSelf: false,
          connectionId: "conn-b",
          connected: true,
          isGreeter: false,
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
    expect(onStart).toHaveBeenCalledWith(false);
  });

  it("offers force-start once the source is verified and confirms first", async () => {
    const state = makeState({ canForceStart: true });
    const onStart = vi.fn();
    await renderLobby(state, { onStart });
    await userEvent.click(screen.getByRole("button", { name: /start anyway/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/start before everyone is ready/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Start anyway" }));
    expect(onStart).toHaveBeenCalledWith(true);
  });

  it("lets the greeter approve or reject pending join requests", async () => {
    const state = makeState({
      pendingJoinRequests: [
        {
          memberId: "member-c",
          displayName: "Player C",
          connectionId: "conn-c",
          partyCode: "ABCD",
          id: "join-request-member-c",
        },
      ],
    });
    const onApprove = vi.fn();
    const onReject = vi.fn();
    await renderLobby(state, { onApprove, onReject });
    const section = screen.getByLabelText("Join requests");
    await userEvent.click(within(section).getByRole("button", { name: /^Approve$/ }));
    expect(onApprove).toHaveBeenCalledWith("member-c");
    await userEvent.click(within(section).getByRole("button", { name: /^Reject$/ }));
    expect(onReject).toHaveBeenCalledWith("member-c");
  });

  it("calls the leave callback", async () => {
    const onLeave = vi.fn();
    await renderLobby(makeState(), { onLeave });
    await userEvent.click(screen.getByRole("button", { name: /leave party/i }));
    expect(onLeave).toHaveBeenCalled();
  });

  it("browses games with the shared browse UI when the party has none (7.6/7.43)", async () => {
    const state = makeState({
      game: null,
      canStart: false,
      canForceStart: false,
      startBlockedReason: "Pick a game before starting the party.",
    });
    const onPickGame = vi.fn();
    await renderLobby(state, { onPickGame });
    // 10.6: the welcome card replaces the old empty-state sentence.
    expect(screen.getByText("No game selected yet")).toBeInTheDocument();
    expect(screen.queryByText(/no game yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you must select the game/i)).not.toBeInTheDocument();
    const browseButton = screen.getByRole("button", { name: /browse games/i });
    expect(browseButton).toBeInTheDocument();
    await userEvent.click(browseButton);
    // The shared browse UI (same as /browse) opens inline: search + the
    // player's own saved games section (empty library in tests).
    expect(screen.getByRole("searchbox", { name: "Search games" })).toBeInTheDocument();
    expect(screen.getByText("My games")).toBeInTheDocument();
    expect(onPickGame).not.toHaveBeenCalled();
    // Back returns to the lobby.
    await userEvent.click(screen.getByRole("button", { name: /back to lobby/i }));
    expect(screen.getByRole("button", { name: /start game/i })).toBeInTheDocument();
  });

  it("picks a saved game from the shared browse UI (7.43)", async () => {
    const state = makeState({ game: null, canStart: false, canForceStart: false });
    const game = await gameRepository.create({
      title: "Rocket Rumble",
      html: "<!doctype html><html><body><p>rockets</p></body></html>",
      mode: "state",
    });
    const onPickGame = vi.fn();
    await renderLobby(state, { onPickGame });
    await userEvent.click(screen.getByRole("button", { name: /browse games/i }));
    const saved = await screen.findByRole("button", { name: /Rocket Rumble/ });
    await userEvent.click(saved);
    expect(onPickGame).toHaveBeenCalledWith(game.id);
    // Picking returns to the lobby.
    expect(screen.getByRole("button", { name: /start game/i })).toBeInTheDocument();
  });

  it("picks a classic game from the shared browse UI (7.7.4/7.43)", async () => {
    const state = makeState({ game: null, canStart: false, canForceStart: false });
    const onPickPrebuilt = vi.fn();
    await renderLobby(state, { onPickPrebuilt });
    await userEvent.click(screen.getByRole("button", { name: /browse games/i }));
    // Classic games are listed together with (empty) saved games.
    expect(await screen.findByRole("searchbox", { name: "Search games" })).toBeInTheDocument();
    const protobowl = screen.getByRole("button", { name: /Protobowl/ });
    await userEvent.click(protobowl);
    expect(onPickPrebuilt).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "classic", id: "protobowl" }),
    );
  });

  it("tells joiners the party is waiting when it has no game (10.6)", async () => {
    const state = makeState({ role: "joiner", game: null });
    await renderLobby(state);
    expect(screen.getByText("No game selected yet")).toBeInTheDocument();
    expect(screen.queryByText(/waiting for the host to pick a game/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /browse games/i })).not.toBeInTheDocument();
  });

  it("edits the player name from the player's own tile pencil (7.5/10.8)", async () => {
    const onEditName = vi.fn();
    await renderLobby(makeState(), { onEditName });
    // The "You are playing as" line and its separate Edit name button are gone.
    expect(screen.queryByText(/you are playing as/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit name$/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /edit your name/i }));
    const input = screen.getByLabelText("Your player name");
    await userEvent.clear(input);
    await userEvent.type(input, "Grace");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onEditName).toHaveBeenCalledWith("Grace");
  });

  it("shows the ended-game banner and disables start after a game ends", async () => {
    const state = makeState({
      endedReason: "host_closed",
      canStart: false,
      canForceStart: false,
      startBlockedReason: "The game ended; leave the party to play again.",
    });
    await renderLobby(state);
    expect(screen.getAllByText(/the game ended/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /start game/i })).toBeDisabled();
  });

  it("shows a host-only kick button that removes the member (7.29)", async () => {
    const state = makeState({
      members: [
        {
          memberId: "member-a",
          displayName: "Alex",
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
          displayName: "Bree",
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
    });
    const onKickMember = vi.fn();
    await renderLobby(state, { onKickMember });
    const kick = screen.getByRole("button", { name: /kick/i });
    await userEvent.click(kick);
    expect(onKickMember).toHaveBeenCalledWith("member-b");
  });

  it("hides the kick button from joiners (7.29)", async () => {
    const state = makeState({
      role: "joiner",
      members: [
        {
          memberId: "member-a",
          displayName: "Alex",
          isSelf: false,
          connectionId: "conn-a",
          connected: true,
          isGreeter: false,
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
          isGreeter: true,
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

  it("shows the invite card with Copy URL + QR Code and an origin+code title (10.5)", async () => {
    await renderLobby(makeState());
    expect(screen.getByText("Get your friends to join!")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy url/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /qr code/i })).toBeInTheDocument();
    // The lobby page title is origin + code — the full invite URL is never
    // rendered (ADR-0011).
    expect(screen.getByText(`${window.location.host}/abcd`)).toBeInTheDocument();
    expect(screen.queryByText(INVITE_URL)).not.toBeInTheDocument();
    expect(screen.queryByText(/invite-secret/)).not.toBeInTheDocument();
    // The QR is not shown directly on the lobby.
    expect(screen.queryByLabelText("Party invite QR code")).not.toBeInTheDocument();
  });

  it("copies the invite URL from the Copy URL button (10.5)", async () => {
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

  it("opens the QR code in a modal with the safe label (10.5)", async () => {
    await renderLobby(makeState());
    await userEvent.click(screen.getByRole("button", { name: /qr code/i }));
    const dialog = screen.getByRole("dialog", { name: "Party QR code" });
    expect(within(dialog).getByLabelText("Party invite QR code")).toBeInTheDocument();
    expect(within(dialog).getByText(`${window.location.host}/abcd`)).toBeInTheDocument();
    // The secret never appears as text anywhere on the page.
    expect(screen.queryByText(/invite-secret/)).not.toBeInTheDocument();
    // Closing the modal hides the QR again.
    await userEvent.click(within(dialog).getByRole("button", { name: /close/i }));
    expect(screen.queryByLabelText("Party invite QR code")).not.toBeInTheDocument();
  });

  it("shows the welcome card with the selected game for the host (10.6)", async () => {
    await renderLobby(makeState());
    const welcome = screen.getByLabelText("Welcome");
    expect(within(welcome).getByText("Welcome to rocketcrab!")).toBeInTheDocument();
    expect(within(welcome).getByText("You've selected")).toBeInTheDocument();
    expect(within(welcome).getByText("Rocket Rumble")).toBeInTheDocument();
    expect(
      within(welcome).getByText("As the host, you have to start the game!"),
    ).toBeInTheDocument();
    expect(
      within(welcome).getByRole("button", { name: /what is rocket rumble\?/i }),
    ).toBeInTheDocument();
  });

  it("shows the guest welcome copy when a game is selected (10.6)", async () => {
    const state = makeState({ role: "joiner" });
    await renderLobby(state);
    const welcome = screen.getByLabelText("Welcome");
    expect(
      within(welcome).getByText("Waiting for the host to start the game…"),
    ).toBeInTheDocument();
    expect(within(welcome).queryByText(/as the host/i)).not.toBeInTheDocument();
  });

  it("shows the welcome card without a game selected (10.6)", async () => {
    const state = makeState({ game: null });
    await renderLobby(state);
    const welcome = screen.getByLabelText("Welcome");
    expect(within(welcome).getByText("Welcome to rocketcrab!")).toBeInTheDocument();
    expect(within(welcome).getByText("No game selected yet")).toBeInTheDocument();
    expect(within(welcome).queryByText("You've selected")).not.toBeInTheDocument();
  });

  it("opens the game details overlay from What is GameName? (10.6)", async () => {
    const game = await gameRepository.create({
      title: "Rocket Rumble",
      description: "Blast off with friends.",
      html: "<!doctype html><html><body><p>rockets</p></body></html>",
      mode: "state",
    });
    const state = makeState({ game: { gameId: game.id, title: game.title, mode: "state" } });
    await renderLobby(state);
    await userEvent.click(screen.getByRole("button", { name: /what is rocket rumble\?/i }));
    const dialog = screen.getByRole("dialog", { name: "About Rocket Rumble" });
    expect(within(dialog).getByText("Blast off with friends.")).toBeInTheDocument();
    // Closing the overlay returns to the untouched lobby underneath.
    await userEvent.click(within(dialog).getByRole("button", { name: /close game details/i }));
    expect(screen.queryByRole("dialog", { name: "About Rocket Rumble" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start game/i })).toBeInTheDocument();
  });

  it("shows prebuilt game info in the details overlay (10.6)", async () => {
    // Drawphone is a prebuilt classic game with a guide.
    const state = makeState({ game: { gameId: "drawphone", title: "Drawphone", mode: "state" } });
    await renderLobby(state);
    await userEvent.click(screen.getByRole("button", { name: /what is drawphone\?/i }));
    const dialog = screen.getByRole("dialog", { name: "About Drawphone" });
    expect(within(dialog).getByText(/In Drawphone, there are no winners/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: /read the official guide/i }),
    ).toBeInTheDocument();
  });
});
