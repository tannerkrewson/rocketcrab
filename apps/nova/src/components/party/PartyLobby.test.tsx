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
 * the greeter's join-request approval row. rocketcrab-b73: start controls
 * are HOST-ONLY — joiners see no start buttons or blocked-reason alert.
 */

const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: toastMock }));

const INVITE_URL = "http://localhost:5173/join#code=ABCD&secret=invite-secret";

function makeState(overrides: Partial<PartyEngineState> = {}): PartyEngineState {
  return {
    phase: "lobby",
    phaseDetail: null,
    joinStage: null,
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
    shortInviteUrl: "http://localhost:5173/abcd",
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
    runtimeLogs: [],
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
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.warning.mockClear();
  toastMock.info.mockClear();
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
  // The invite card is always present in the lobby (even for joiners, and
  // even when the host-only start controls are hidden — b73).
  await result.findByRole("button", { name: /copy url/i });
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

  it("hides the start controls from joiners — start is host-only (rocketcrab-b73)", async () => {
    const state = makeState({ role: "joiner", canForceStart: true });
    await renderLobby(state);
    // A joiner never sees the start buttons or the host's blocked-reason
    // alert (Browse games is host-only too, so there is no pick path).
    expect(screen.queryByRole("button", { name: /start game/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start anyway/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /browse games/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The joiner still sees the lobby: invite card, players, leave.
    expect(screen.getByRole("button", { name: /copy url/i })).toBeInTheDocument();
    expect(screen.getByText(/Players \(2\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /leave party/i })).toBeInTheDocument();
  });

  it("shows the start controls to the host only when the party is in the lobby (b73)", async () => {
    await renderLobby(makeState());
    // No "The party is not in the lobby yet." message exists anymore — the
    // start button is simply absent outside the lobby (hidden for non-hosts)
    // or disabled-with-reason inside it.
    expect(screen.queryByText(/not in the lobby yet/i)).not.toBeInTheDocument();
  });

  it("labels a host peer's tile 'Host', never 'Greeter' (rocketcrab-rfk)", async () => {
    const state = makeState({
      role: "joiner",
      members: [
        { ...makeState().members[0]!, isGreeter: false },
        {
          memberId: "member-b",
          displayName: "Player B",
          isSelf: false,
          connectionId: "conn-b",
          connected: true,
          isGreeter: true,
          transferState: "complete",
          transferProgress: 1,
          transferDetail: "Game received",
          ready: true,
        },
      ],
      greeterMemberId: "member-b",
      amGreeter: false,
    });
    await renderLobby(state);
    // The joiner's own tile is just "You"; the host peer reads "Host".
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
        relayHealth: null,
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

  it("shows usable vs rejecting relays and a degraded warning (rocketcrab-ont.1)", async () => {
    const state = makeState({
      diagnostics: {
        connectionState: "connected",
        selfConnectionId: "conn-a",
        room: "room-1",
        sessionId: "session-1",
        relays: [
          { url: "wss://nos.lol", readyState: 1, connected: true, degraded: false },
          { url: "wss://relay.damus.io", readyState: 1, connected: true, degraded: true },
          { url: "wss://relay.nostr.info", readyState: 1, connected: true, degraded: true },
          { url: "wss://dead.example", readyState: 3, connected: false, degraded: false },
        ],
        relayHealth: {
          total: 4,
          connected: 3,
          usable: 1,
          degradedCount: 2,
          signalingDown: false,
          degraded: true,
        },
        joinErrors: null,
        peers: [],
        lastQuality: [],
        turn: null,
      },
    });
    await renderLobby(state);
    await userEvent.click(screen.getByText("Connection diagnostics"));
    // Usable count badge + the per-relay statuses.
    expect(screen.getByText("1/4 relays")).toBeInTheDocument();
    expect(screen.getAllByText("usable")).toHaveLength(1);
    expect(screen.getAllByText("rejecting")).toHaveLength(2);
    expect(screen.getByText("readyState 3")).toBeInTheDocument();
    // The degraded warning names the rejecters without blaming the closed one.
    // (The lobby's start-blocked notice also has role="alert" — scope to the
    // diagnostics panel's warning.)
    const alerts = screen.getAllByRole("alert");
    const warning = alerts.find((alert) => within(alert).queryByText(/Signaling degraded/));
    expect(warning).toBeDefined();
    expect(warning).toHaveClass("alert-warning");
    expect(
      within(warning as HTMLElement).getByText(/Signaling degraded: 1 of 4 relays usable/),
    ).toBeInTheDocument();
    // A degraded badge on the summary row.
    expect(screen.getByTitle("Usable relays below redundancy")).toHaveTextContent("degraded");
  });

  it("warns when no relay socket is open (signaling down)", async () => {
    const state = makeState({
      diagnostics: {
        connectionState: "joining",
        selfConnectionId: "conn-a",
        room: "room-1",
        sessionId: "session-1",
        relays: [{ url: "wss://nos.lol", readyState: 0, connected: false, degraded: false }],
        relayHealth: {
          total: 1,
          connected: 0,
          usable: 0,
          degradedCount: 0,
          signalingDown: true,
          degraded: true,
        },
        joinErrors: null,
        peers: [],
        lastQuality: [],
        turn: null,
      },
    });
    await renderLobby(state);
    await userEvent.click(screen.getByText("Connection diagnostics"));
    expect(screen.getByText(/No relay socket is open/)).toBeInTheDocument();
    expect(screen.getByText(/readyState 0/)).toBeInTheDocument();
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

  it("shows ONE compact notice banner with the latest non-membership notice (11.8/2z9)", async () => {
    const state = makeState({
      canStart: true,
      startBlockedReason: null,
      notices: [
        { id: "notice-1", level: "error", message: "Player B could not receive the game." },
        { id: "notice-2", level: "warn", message: "Player C is reconnecting." },
        { id: "notice-3", level: "info", message: "Player B joined the party." },
      ],
    });
    await renderLobby(state);
    // One status banner, not a growing list of identical alerts.
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    // 2z9: membership notices ("joined the party.") are smart toasts, NOT
    // banner alerts — the banner shows the latest REMAINING notice and the
    // joined message is toasted exactly once (deduped by notice id).
    expect(within(alerts[0]!).getByText("Player C is reconnecting.")).toBeInTheDocument();
    expect(screen.queryByText("Player B joined the party.")).not.toBeInTheDocument();
    expect(toastMock.info).toHaveBeenCalledWith("Player B joined the party.");
    expect(toastMock.warning).not.toHaveBeenCalled();
  });

  it("toasts a removed-notice instead of showing it as a banner alert (2z9)", async () => {
    const state = makeState({
      canStart: true,
      startBlockedReason: null,
      notices: [
        { id: "notice-1", level: "warn", message: "Player B was removed from the party." },
        { id: "notice-2", level: "info", message: "The game started." },
      ],
    });
    await renderLobby(state);
    expect(screen.queryByText("Player B was removed from the party.")).not.toBeInTheDocument();
    expect(toastMock.warning).toHaveBeenCalledWith("Player B was removed from the party.");
    // The banner still shows the remaining notice.
    expect(within(screen.getByRole("alert")).getByText("The game started.")).toBeInTheDocument();
  });

  it("does not re-toast a membership notice on ordinary re-renders (2z9 dedupe)", async () => {
    const state = makeState({
      canStart: true,
      startBlockedReason: null,
      notices: [{ id: "notice-1", level: "info", message: "Player B joined the party." }],
    });
    await renderLobby(state);
    expect(toastMock.info).toHaveBeenCalledTimes(1);
    // A local re-render (opening and closing the QR modal) must not fire
    // the smart toast again — the toast effect is keyed by the notices
    // array and deduped by notice id.
    await userEvent.click(screen.getByRole("button", { name: /qr code/i }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Party QR code" })).getByRole("button", {
        name: /close/i,
      }),
    );
    expect(toastMock.info).toHaveBeenCalledTimes(1);
  });

  it("shows NO game-ended alert after a game ends — the ended banner is gone (5cl.9)", async () => {
    const state = makeState({
      endedReason: "host_closed",
      canStart: false,
      canForceStart: false,
      startBlockedReason: "The game ended; leave the party to play again.",
      notices: [
        { id: "notice-1", level: "info", message: "Player B joined the party." },
        { id: "notice-2", level: "info", message: "The game started." },
        { id: "notice-3", level: "info", message: "The game ended (host_closed)." },
      ],
    });
    await renderLobby(state);
    // 5cl.9: no "game ended" alert at all in the lobby — the ended-state
    // banner is gone, the raw ended notice stays filtered out, and the
    // notice banner hides entirely once the game ended.
    expect(screen.queryByText(/the game ended\./i)).not.toBeInTheDocument();
    expect(screen.queryByText(/the host closed it/i)).not.toBeInTheDocument();
    expect(screen.queryByText("The game ended (host_closed).")).not.toBeInTheDocument();
    expect(screen.queryByText("Player B joined the party.")).not.toBeInTheDocument();
    expect(screen.queryByText("The game started.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
    expect(screen.getByText("As the host, you must select a game.")).toBeInTheDocument();
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
    // 5cl.8: the browser no longer renders its own brand row — the shared
    // party shell header stays mounted (compact + faded) while browsing.
    expect(screen.queryByTestId("browser-brand-row")).not.toBeInTheDocument();
    // No "All games" box (2t1.1): Protobowl lives in the Trivia box.
    await userEvent.click(screen.getByRole("button", { name: /Trivia/ }));
    const protobowl = await screen.findByRole("link", { name: /Protobowl/ });
    expect(protobowl.getAttribute("href")).toBe("/game/protobowl");
  });

  it("tells joiners the party is waiting when it has no game — naming the host (2t1.9/5cl.9)", async () => {
    const state = makeState({ role: "joiner", game: null });
    await renderLobby(state);
    // 5cl.9: the message names the HOST — the greeter member (the creator
    // is installed as the initial greeter, so greeterMemberId is the best
    // available signal for who the host is).
    expect(screen.getByText("Waiting for Player A to select a game")).toBeInTheDocument();
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

  it("shows NO ended banner and disables start after a game ends (5cl.9)", async () => {
    const state = makeState({
      endedReason: "host_closed",
      canStart: false,
      canForceStart: false,
      startBlockedReason: "The game ended; leave the party to play again.",
    });
    await renderLobby(state);
    // 5cl.9: the ended-state banner is gone entirely — no "game ended"
    // text anywhere in the lobby; the blocked-reason alert is suppressed
    // once a game ends. Start stays disabled.
    expect(screen.queryByText(/the game ended\./i)).not.toBeInTheDocument();
    expect(screen.queryByText(/the host closed it/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText("The game ended; leave the party to play again."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start game/i })).toBeDisabled();
  });

  it("shows a host-only kick button that confirms before removing the member (7.29/2z9)", async () => {
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
    // 2z9: the first tap only opens the confirmation — the member is not
    // removed until the host confirms (a mis-tap would boot them).
    await userEvent.click(kick);
    expect(onKickMember).not.toHaveBeenCalled();
    const confirm = screen.getByRole("dialog", { name: /kick a player/i });
    expect(within(confirm).getByText(/Kick Bree from the party\?/)).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole("button", { name: /^kick player$/i }));
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
    // rocketcrab-ucz: without native share support (jsdom) the Share
    // button is not rendered at all.
    expect(screen.queryByRole("button", { name: /^share$/i })).not.toBeInTheDocument();
    // The origin+code title lives in the party shell header (11.6) — the
    // lobby card never re-renders it. The code is never shown separately
    // from the title, and the full invite URL is never rendered (ADR-0011).
    expect(screen.queryByText(`${window.location.host}/abcd`)).not.toBeInTheDocument();
    expect(screen.queryByText(INVITE_URL)).not.toBeInTheDocument();
    expect(screen.queryByText(/invite-secret/)).not.toBeInTheDocument();
    // The QR is not shown directly on the lobby.
    expect(screen.queryByLabelText("Party invite QR code")).not.toBeInTheDocument();
  });

  it("shares the invite URL through the native share sheet when supported (rocketcrab-ucz)", async () => {
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
    // Copy URL and QR stay alongside the native share affordance.
    expect(screen.getByRole("button", { name: /copy url/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /qr code/i })).toBeInTheDocument();
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });

  it("hides the native Share button when canShare rejects the URL (rocketcrab-ucz)", async () => {
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

  it("offers no separate Copy short link affordance — copying is always the long URL (5cl.2)", async () => {
    await renderLobby(makeState());
    // 5cl.2: the short-link button and its "Easy to type or read aloud"
    // label are gone; the primary Copy URL button remains.
    expect(screen.queryByRole("button", { name: /copy short link/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/easy to type or read aloud/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy url/i })).toBeInTheDocument();
    // The short URL is never rendered as text (it equals the header title,
    // 10.5/11.6) and no secret appears anywhere.
    expect(screen.queryByText("http://localhost:5173/abcd")).not.toBeInTheDocument();
    expect(screen.queryByText(/invite-secret/)).not.toBeInTheDocument();
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

  it("shows the guest welcome copy when a game is selected — naming the host (10.6/rocketcrab-ack)", async () => {
    const state = makeState({
      role: "joiner",
      members: [
        { ...makeState().members[0]!, isGreeter: false },
        {
          memberId: "member-b",
          displayName: "Bob",
          isSelf: false,
          connectionId: "conn-b",
          connected: true,
          isGreeter: true,
          transferState: "complete",
          transferProgress: 1,
          transferDetail: "Game received",
          ready: true,
        },
      ],
      greeterMemberId: "member-b",
      amGreeter: false,
    });
    await renderLobby(state);
    const welcome = screen.getByLabelText("Welcome");
    // rocketcrab-ack: guests see WHO selected the game ("Bob has
    // selected") — only the host's own view says "You've selected".
    expect(within(welcome).getByText("Bob has selected")).toBeInTheDocument();
    expect(within(welcome).queryByText("You've selected")).not.toBeInTheDocument();
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
    expect(within(welcome).getByText("As the host, you must select a game.")).toBeInTheDocument();
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
