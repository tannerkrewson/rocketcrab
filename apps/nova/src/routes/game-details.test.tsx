import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gameRepository } from "../lib/games/instance";
import type { PartyEngineState } from "../lib/party/engine";
import { toast } from "../lib/toast";
import { routeTree } from "../routeTree.gen";

const IDLE_STATE: PartyEngineState = {
  phase: "idle",
  phaseDetail: null,
  joinStage: null,
  reconnectAttempts: 0,
  role: null,
  memberId: "member-a",
  displayName: "Player A",
  game: null,
  playerLimitNotice: null,
  members: [],
  hostMemberId: null,
  amHost: false,
  authorityMemberId: null,
  inviteUrl: null,
  partyCode: null,
  connectionState: "idle",
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
};

const LOBBY_STATE: PartyEngineState = {
  ...IDLE_STATE,
  phase: "lobby",
  role: "creator",
  memberId: "member-a",
  members: [
    {
      memberId: "member-a",
      displayName: "Player A",
      isSelf: true,
      connectionId: "conn-a",
      connected: true,
      isHost: true,
      transferState: "waiting",
      transferProgress: null,
      transferDetail: null,
      ready: false,
    },
  ],
  hostMemberId: "member-a",
  amHost: true,
  authorityMemberId: "member-a",
  inviteUrl: "http://localhost:2722/join#code=rcrb&secret=invite-secret",
  connectionState: "connected",
  canStart: false,
  startBlockedReason: "Pick a game before starting the party.",
};

const GUEST_STATE: PartyEngineState = {
  ...LOBBY_STATE,
  role: "joiner",
  memberId: "member-b",
  displayName: "Player B",
  hostMemberId: null,
  amHost: false,
  authorityMemberId: "member-a",
};

const { stubEngine, stubs } = vi.hoisted(() => {
  const stubs: { mode: "idle" | "lobby" | "guest" } = { mode: "idle" };
  const stateFor = (): PartyEngineState => {
    switch (stubs.mode) {
      case "lobby":
        return LOBBY_STATE;
      case "guest":
        return GUEST_STATE;
      default:
        return IDLE_STATE;
    }
  };
  return {
    stubs,
    stubEngine: {
      getState: vi.fn(stateFor),
      onState: vi.fn((handler: (state: PartyEngineState) => void) => {
        handler(stateFor());
        return () => undefined;
      }),
      isActive: vi.fn(() => stubs.mode !== "idle"),
      setContainer: vi.fn(),
      selectGame: vi.fn(async () => undefined),
      leaveParty: vi.fn(async () => undefined),
    },
  };
});

vi.mock("../lib/party/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/party/engine")>();
  return {
    ...actual,
    partyEngine: stubEngine,
  };
});

function renderAt(entry: string) {
  cleanup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(<RouterProvider router={router} />, { wrapper });
  return router;
}

const SAVED_HTML = "<!doctype html><html><body><p>rockets</p></body></html>";

beforeEach(async () => {
  vi.clearAllMocks();
  stubs.mode = "idle";
  window.sessionStorage.clear();
  await gameRepository.clear();
});

describe("/game/:gameId — saved games and party selection", () => {
  it("renders saved-game details from the repository (title, description)", async () => {
    const game = await gameRepository.create({
      title: "Rocket Rumble",
      description: "Blast off with friends.",
      html: SAVED_HTML,
    });
    renderAt(`/game/${game.id}`);

    expect(await screen.findByRole("heading", { name: "Rocket Rumble" })).toBeInTheDocument();
    expect(screen.getByText("My game")).toBeInTheDocument();
    expect(screen.getByText("Blast off with friends.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /select game/i })).not.toBeInTheDocument();
    const start = screen.getByRole("link", { name: /Start party/ });
    expect(start.getAttribute("href")).toBe(`/party?gameId=${game.id}&title=Rocket+Rumble`);
    const edit = screen.getByRole("link", { name: "Edit game" });
    expect(edit.getAttribute("href")).toBe(`/games/${game.id}/edit`);
    const back = screen.getByRole("link", { name: "Back to games" });
    expect(back.className).toContain("button--tertiary");
    expect(back.className).toContain("self-start");
    expect(screen.getByTestId("browser-brand-row")).toHaveTextContent("rocketcrab.com");
  });

  it("selects a saved game for the active party and returns to the lobby", async () => {
    stubs.mode = "lobby";
    const game = await gameRepository.create({
      title: "Rocket Rumble",
      html: SAVED_HTML,
    });
    const router = renderAt(`/game/${game.id}`);

    const select = await screen.findByRole("button", { name: /select game/i });
    const edit = screen.getByRole("button", { name: "Edit game" });
    expect(edit.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(select);

    await vi.waitFor(() =>
      expect(stubEngine.selectGame).toHaveBeenCalledWith({
        gameId: game.id,
        title: "Rocket Rumble",
        source: SAVED_HTML,
        apiVersion: 1,
      }),
    );
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/party"));
    expect(screen.queryByRole("button", { name: /select game/i })).not.toBeInTheDocument();
  });

  it("selects an external game for the active party", async () => {
    stubs.mode = "lobby";
    const router = renderAt("/game/drawphone");

    const select = await screen.findByRole("button", { name: /select game/i });
    await userEvent.click(select);

    await vi.waitFor(() =>
      expect(stubEngine.selectGame).toHaveBeenCalledWith({ kind: "external", gameId: "drawphone" }),
    );
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/party"));
  });

  it("shows a temporary error and stays in game details when selection fails", async () => {
    stubs.mode = "lobby";
    const notify = vi.spyOn(toast, "danger").mockImplementation(() => "");
    stubEngine.selectGame.mockRejectedValueOnce(new Error("The game service is unavailable."));
    try {
      const router = renderAt("/game/drawphone?from=party-browse");
      const select = await screen.findByRole("button", { name: "Select game" });
      await userEvent.click(select);
      expect(notify).toHaveBeenCalledWith(
        "Couldn't select that game: The game service is unavailable.",
      );
      expect(router.state.location.pathname).toBe("/game/drawphone");
      expect(select).toBeEnabled();
      expect(screen.getByRole("link", { name: "Back to category" })).toBeInTheDocument();
    } finally {
      notify.mockRestore();
    }
  });

  it("shares the party shell header (unlinked brand row) while in a lobby", async () => {
    stubs.mode = "lobby";
    renderAt("/game/drawphone?from=party-browse");

    const brand = await screen.findByTestId("browser-brand-row");
    expect(brand.textContent).toBe("rocketcrab.com");
    expect(screen.queryByRole("link", { name: /rocketcrab\.com/ })).not.toBeInTheDocument();
    const back = screen.getByRole("link", { name: "Back to category" });
    expect(back.getAttribute("href")).toBe("/party?browse=true");
    expect(back.className).toContain("self-start");
    const select = screen.getByRole("button", { name: /select game/i });
    expect(select.className).toContain("button--lg");
    expect(select.className).toContain("button--primary");
  });

  it("tells a guest that the host picks when they press Select game", async () => {
    stubs.mode = "guest";
    renderAt("/game/drawphone");

    await screen.findByRole("heading", { name: "Drawphone" });
    expect(screen.queryByRole("link", { name: /Start party/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /select game/i }));
    const dialog = screen.getByRole("dialog", { name: "Only the host picks" });
    expect(dialog).toHaveTextContent("Drawphone");
    expect(stubEngine.selectGame).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
  });

  it("returns from lobby What is details to the live party without leaving", async () => {
    stubs.mode = "lobby";
    const game = await gameRepository.create({
      title: "Rocket Rumble",
      description: "Blast off with friends.",
      html: SAVED_HTML,
    });
    const router = renderAt(`/game/${game.id}?from=party`);

    expect(await screen.findByRole("heading", { name: "Rocket Rumble" })).toBeInTheDocument();
    const back = screen.getByRole("link", { name: "Back to party" });
    expect(back.getAttribute("href")).toBe("/party");
    await userEvent.click(back);

    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/party"));
    expect(screen.getByTestId("browser-brand-row")).toHaveTextContent("rocketcrab.com");
    expect(stubEngine.leaveParty).not.toHaveBeenCalled();
  });

  it("guards saved-game editing by leaving an active party first", async () => {
    stubs.mode = "lobby";
    const game = await gameRepository.create({
      title: "Rocket Rumble",
      html: SAVED_HTML,
    });
    const router = renderAt(`/game/${game.id}?from=party`);

    await userEvent.click(await screen.findByRole("button", { name: "Edit game" }));
    expect(screen.getByRole("dialog", { name: "Leave the party?" })).toBeInTheDocument();
    expect(stubEngine.leaveParty).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Leave party" }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/games/${game.id}/edit`));
    expect(stubEngine.leaveParty).toHaveBeenCalledTimes(1);
  });

  it("offers a same-size primary Start-party CTA for external games outside a party", async () => {
    renderAt("/game/drawphone");

    const start = await screen.findByRole("link", { name: "Start party" });
    expect(start.className).toContain("button--primary");
    expect(start.className).toContain("button--lg");
    expect(start.getAttribute("href")).toBe("/party");
    expect(screen.queryByRole("link", { name: /Play game/ })).not.toBeInTheDocument();
  });
});
