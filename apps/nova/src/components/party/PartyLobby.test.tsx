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
import { resetPartyIdentityForTests, setSavedPlayerName } from "../../lib/party/identity";
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
  // 2t1.9: seed a saved player name so the lobby's no-name prompt stays
  // hidden in most tests; the dedicated prompt test clears it first.
  resetPartyIdentityForTests();
  setSavedPlayerName("Player A");
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
  // 2t1.9: the pencil / no-name prompt link to the shared name-editing page.
  const joinRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/join",
    component: () => null,
  });
  const lobbyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => lobby({ state, ...handlers } as PartyLobbyProps),
  });
  const routeTree = rootRoute.addChildren([libraryRoute, joinRoute, lobbyRoute]);
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
  it("lists players with connection + transfer states only (10.8/11.9)", async () => {
    await renderLobby(makeState());
    const rowA = screen.getByTestId("party-member-member-a");
    const rowB = screen.getByTestId("party-member-member-b");
    // Own tile: centered name, "You, Host" role label (creator + self),
    // connected indicator, and the pencil. The always-green "Game ready"
    // badge and the standalone ready check are gone (11.9) — readiness is
    // the start flow's job.
    expect(within(rowA).getByText("Player A")).toBeInTheDocument();
    expect(within(rowA).getByText("You, Host")).toBeInTheDocument();
    expect(within(rowA).getByTitle("Connected")).toBeInTheDocument();
    expect(within(rowA).queryByText("Game ready")).not.toBeInTheDocument();
    expect(within(rowA).queryByTitle("Ready")).not.toBeInTheDocument();
    // 2t1.9: the pencil is a link to the shared name-editing page, not a
    // button that opens an inline form.
    expect(within(rowA).getByRole("link", { name: /edit your name/i })).toBeInTheDocument();
    // The dense badge rows are gone.
    expect(within(rowA).queryByText("(you)")).not.toBeInTheDocument();
    expect(within(rowA).queryByText("Greeter")).not.toBeInTheDocument();

    // Peer tile: name, transferring progress bar with byte detail — and no
    // ready check next to it.
    expect(within(rowB).getByText("Player B")).toBeInTheDocument();
    expect(within(rowB).getByRole("progressbar")).toBeInTheDocument();
    expect(within(rowB).getByText("32 KB of 64 KB")).toBeInTheDocument();
    expect(within(rowB).queryByTitle("Not ready")).not.toBeInTheDocument();
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
        turn: null,
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

  it("shows the start-blocked reason as a styled outline alert when a game is selected (10.7)", async () => {
    const state = makeState({
      startBlockedReason: "Waiting for every player's game to load and register.",
    });
    await renderLobby(state);
    const alert = screen.getByRole("alert");
    // Colored alerts in the lobby are outline-styled, never solid (9fv.11.3).
    expect(alert).toHaveClass("alert-outline");
    expect(alert).toHaveClass("alert-warning");
    expect(within(alert).getByText(/waiting for every player/i)).toBeInTheDocument();
  });

  it("shows ONE compact notice banner with the latest notice (11.8)", async () => {
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
    // One status banner, not a growing list of identical alerts.
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    // The latest notice wins and colored alerts are outline-styled (9fv.11.3).
    expect(alerts[0]).toHaveClass("alert-outline");
    expect(alerts[0]).toHaveClass("alert-info");
    expect(within(alerts[0]!).getByText("Your game loaded and registered.")).toBeInTheDocument();
  });

  it("hides older notices once a game-ended notice is owned by the ended banner (11.8)", async () => {
    const state = makeState({
      endedReason: "host_closed",
      canStart: false,
      canForceStart: false,
      startBlockedReason: "The game ended; leave the party to play again.",
      notices: [
        { id: "notice-1", level: "info", message: "Your game loaded and registered." },
        { id: "notice-2", level: "info", message: "The game started." },
        { id: "notice-3", level: "info", message: "The game ended (host_closed)." },
      ],
    });
    await renderLobby(state);
    // The ended banner owns the ended state; the raw ended notice and the
    // older transient notices are not re-shown. 2t1.9: host_closed reads
    // the generic ended copy (the host_closed sentence was removed).
    expect(screen.getByRole("alert")).toHaveClass("alert-outline");
    expect(screen.getByText(/the game ended\./i)).toBeInTheDocument();
    expect(screen.queryByText(/the host closed it/i)).not.toBeInTheDocument();
    expect(screen.queryByText("The game ended (host_closed).")).not.toBeInTheDocument();
    expect(screen.queryByText("Your game loaded and registered.")).not.toBeInTheDocument();
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
    await renderLobby(state);
    // 10.6 + 2t1.9: the welcome card covers the no-game case with a
    // role-aware message (host = must select).
    expect(screen.getByText("As the host you must select a game")).toBeInTheDocument();
    expect(screen.queryByText(/no game yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you must select the game/i)).not.toBeInTheDocument();
    const browseButton = screen.getByRole("button", { name: /browse games/i });
    expect(browseButton).toBeInTheDocument();
    await userEvent.click(browseButton);
    // The shared browse UI (same as /browse) opens inline: search + the
    // category cards ("My games" among them); the list is hidden until a
    // category opens or the user searches (10.9).
    expect(screen.getByRole("searchbox", { name: "Search games" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /My games/ })).toBeInTheDocument();
    expect(screen.queryByText("Nova Quiz")).not.toBeInTheDocument();
    // 2t1.9: the lobby's redundant "Back to lobby" button is gone — the
    // shared GameBrowser owns its own back navigation.
    expect(screen.queryByRole("button", { name: /back to lobby/i })).not.toBeInTheDocument();
  });

  it("links a saved game to its details page instead of picking it (10.9)", async () => {
    const state = makeState({ game: null, canStart: false, canForceStart: false });
    const game = await gameRepository.create({
      title: "Rocket Rumble",
      html: "<!doctype html><html><body><p>rockets</p></body></html>",
      mode: "state",
    });
    await renderLobby(state);
    await userEvent.click(screen.getByRole("button", { name: /browse games/i }));
    // "My games" is a category card now; opening it shows the saved list.
    await userEvent.click(screen.getByRole("button", { name: /My games/ }));
    const savedLink = await screen.findByRole("link", { name: /Rocket Rumble/ });
    expect(savedLink.getAttribute("href")).toBe(`/game/${game.id}`);
    // Selecting never sets the lobby's game directly — it's a details link.
    expect(savedLink.tagName.toLowerCase()).toBe("a");
  });

  it("links a classic game to its details page instead of picking it (10.9)", async () => {
    const state = makeState({ game: null, canStart: false, canForceStart: false });
    await renderLobby(state);
    await userEvent.click(screen.getByRole("button", { name: /browse games/i }));
    await userEvent.click(screen.getByRole("button", { name: /All games/ }));
    const protobowl = await screen.findByRole("link", { name: /Protobowl/ });
    expect(protobowl.getAttribute("href")).toBe("/game/protobowl");
  });

  it("tells joiners the party is waiting when it has no game (2t1.9)", async () => {
    const state = makeState({ role: "joiner", game: null });
    await renderLobby(state);
    expect(screen.getByText("Waiting for the host to select a game")).toBeInTheDocument();
    expect(screen.queryByText("No game selected yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /browse games/i })).not.toBeInTheDocument();
  });

  it("opens the shared name-editing page from the pencil (2t1.9)", async () => {
    const onEditName = vi.fn();
    await renderLobby(makeState(), { onEditName });
    // The "You are playing as" line and its separate Edit name button are gone.
    expect(screen.queryByText(/you are playing as/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit name$/i })).not.toBeInTheDocument();
    // The pencil links to the shared name-editing page instead of opening
    // an inline form in the tile.
    const pencil = screen.getByRole("link", { name: /edit your name/i });
    expect(pencil.getAttribute("href")).toBe("/join?edit=name");
    expect(screen.queryByLabelText("Your player name")).not.toBeInTheDocument();
    expect(onEditName).not.toHaveBeenCalled();
  });

  it("prompts for a name once in the lobby when none was ever set (2t1.9)", async () => {
    resetPartyIdentityForTests();
    await renderLobby(makeState());
    const prompt = screen.getByLabelText("Set your name");
    expect(within(prompt).getByText(/you haven't set a name yet/i)).toBeInTheDocument();
    expect(within(prompt).getByRole("link", { name: /set your name/i })).toBeInTheDocument();
    expect(within(prompt).getByRole("link").getAttribute("href")).toBe("/join?edit=name");
  });

  it("does not prompt for a name once one is saved (2t1.9)", async () => {
    await renderLobby(makeState());
    expect(screen.queryByLabelText("Set your name")).not.toBeInTheDocument();
  });

  it("labels the leave button End party when alone in the party (2t1.9)", async () => {
    const state = makeState({
      members: [makeState().members[0] as PartyMemberView],
    });
    await renderLobby(state);
    expect(screen.getByRole("button", { name: /end party/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /leave party/i })).not.toBeInTheDocument();
  });

  it("shows ONE unified ended-game banner and disables start after a game ends (11.8)", async () => {
    const state = makeState({
      endedReason: "host_closed",
      canStart: false,
      canForceStart: false,
      startBlockedReason: "The game ended; leave the party to play again.",
    });
    await renderLobby(state);
    // One unified ended banner with the generic ended copy — the separate
    // "game ended; leave the party to play again" warning alert is gone,
    // and host_closed no longer has its own sentence (2t1.9).
    expect(screen.getByText(/the game ended\./i)).toBeInTheDocument();
    expect(screen.queryByText(/the host closed it/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText("The game ended; leave the party to play again."),
    ).not.toBeInTheDocument();
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

  it("shows the invite card with Copy URL + QR and no code/URL text (10.5/11.6)", async () => {
    await renderLobby(makeState());
    expect(screen.getByText("Get your friends to join!")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy url/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /qr code/i })).toBeInTheDocument();
    // The origin+code title lives in the party shell header (11.6) — the
    // lobby card never re-renders it. The code is never shown separately
    // from the title, and the full invite URL is never rendered (ADR-0011).
    expect(screen.queryByText(`${window.location.host}/abcd`)).not.toBeInTheDocument();
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

  it("shows the welcome card without a game selected (2t1.9)", async () => {
    const state = makeState({ game: null });
    await renderLobby(state);
    const welcome = screen.getByLabelText("Welcome");
    expect(within(welcome).getByText("Welcome to rocketcrab!")).toBeInTheDocument();
    expect(within(welcome).getByText("As the host you must select a game")).toBeInTheDocument();
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
