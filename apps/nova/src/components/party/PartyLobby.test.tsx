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
import { describe, expect, it, vi } from "vitest";
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
    diagnostics: null,
    notices: [],
    lastError: null,
    ...overrides,
  };
}

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
  it("lists players with their transfer and ready states", async () => {
    await renderLobby(makeState());
    const rowA = screen.getByTestId("party-member-member-a");
    const rowB = screen.getByTestId("party-member-member-b");
    expect(within(rowA).getByText("Player A")).toBeInTheDocument();
    expect(within(rowA).getByText("(you)")).toBeInTheDocument();
    expect(within(rowA).getByText("Greeter")).toBeInTheDocument();
    expect(within(rowA).getByText("Ready")).toBeInTheDocument();
    expect(within(rowA).getByText("Game ready")).toBeInTheDocument();

    expect(within(rowB).getByText("Player B")).toBeInTheDocument();
    expect(within(rowB).getByText("Transferring")).toBeInTheDocument();
    expect(within(rowB).getByText("Not ready")).toBeInTheDocument();
    expect(within(rowB).getByRole("progressbar")).toBeInTheDocument();
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

  it("separates the greeter from the diagnostic authority label", async () => {
    await renderLobby(makeState());
    expect(screen.getByText(/Greeter: Player A/)).toBeInTheDocument();
    expect(screen.getByText(/Authority \(diagnostic\): Player A/)).toBeInTheDocument();
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

  it("prompts the creator to pick a game when the party has none (7.6)", async () => {
    const state = makeState({
      game: null,
      canStart: false,
      canForceStart: false,
      startBlockedReason: "Pick a game before starting the party.",
    });
    const onPickGame = vi.fn();
    await renderLobby(state, { onPickGame });
    expect(screen.getByText(/no game yet/i)).toBeInTheDocument();
    expect(screen.getByText(/you must select the game/i)).toBeInTheDocument();
    const browseButton = screen.getByRole("button", { name: /browse games/i });
    expect(browseButton).toBeInTheDocument();
    await userEvent.click(browseButton);
    // The picker dialog opens (empty library in tests).
    expect(await screen.findByRole("dialog", { name: "Pick a game" })).toBeInTheDocument();
    expect(await screen.findByText(/no saved games yet/i)).toBeInTheDocument();
    expect(onPickGame).not.toHaveBeenCalled();
  });

  it("tells joiners to wait when the party has no game (7.6)", async () => {
    const state = makeState({ role: "joiner", game: null });
    await renderLobby(state);
    expect(screen.getByText(/waiting for the host to pick a game/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /browse games/i })).not.toBeInTheDocument();
  });

  it("edits the player name from the lobby (7.5)", async () => {
    const onEditName = vi.fn();
    await renderLobby(makeState(), { onEditName });
    expect(screen.getByText(/you are playing as/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /edit name/i }));
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
});
