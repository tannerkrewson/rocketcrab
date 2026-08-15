import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gameRepository } from "../lib/games/instance";
import type { PartyEngineState } from "../lib/party/engine";
import { routeTree } from "../routeTree.gen";

/**
 * Game detail page party tests (10.9 / 2t1.10): the shared /game/:gameId
 * page also serves saved games (title, description, mode from the IndexedDB
 * repository). The CTA is contextual: when a party is waiting in its lobby
 * the creator gets a "Select game" action that hands the game to the party
 * engine and returns to /party; when no party is active the page offers
 * "Start party" (with the game preselected for saved/Nova games, plain
 * /party for classic). There is no standalone "play game" view anymore.
 */

const IDLE_STATE: PartyEngineState = {
  phase: "idle",
  phaseDetail: null,
  reconnectAttempts: 0,
  role: null,
  code: null,
  memberId: "member-a",
  displayName: "Player A",
  game: null,
  members: [],
  pendingJoinRequests: [],
  greeterMemberId: null,
  amGreeter: false,
  authorityMemberId: null,
  inviteUrl: null,
  shortInviteUrl: null,
  connectionState: "idle",
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
};

/** A party waiting in its lobby (creator, no game picked yet). */
const LOBBY_STATE: PartyEngineState = {
  ...IDLE_STATE,
  phase: "lobby",
  role: "creator",
  code: "RCRB",
  memberId: "member-a",
  members: [
    {
      memberId: "member-a",
      displayName: "Player A",
      isSelf: true,
      connectionId: "conn-a",
      connected: true,
      isGreeter: true,
      transferState: "waiting",
      transferProgress: null,
      transferDetail: null,
      ready: false,
    },
  ],
  greeterMemberId: "member-a",
  amGreeter: true,
  authorityMemberId: "member-a",
  inviteUrl: "http://localhost:5173/join#code=RCRB&secret=invite-secret",
  shortInviteUrl: "http://localhost:5173/rcrb",
  connectionState: "connected",
  canStart: false,
  canForceStart: false,
  startBlockedReason: "Pick a game before starting the party.",
};

/** A guest sitting in a party's lobby (no pick rights). */
const GUEST_STATE: PartyEngineState = {
  ...LOBBY_STATE,
  role: "joiner",
  memberId: "member-b",
  displayName: "Player B",
  greeterMemberId: null,
  amGreeter: false,
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
      selectClassicGame: vi.fn(async () => undefined),
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
  await gameRepository.clear();
});

describe("/game/:gameId — saved games and party selection (10.9/2t1.10)", () => {
  it("renders saved-game details from the repository (title, mode, description)", async () => {
    const game = await gameRepository.create({
      title: "Rocket Rumble",
      description: "Blast off with friends.",
      html: SAVED_HTML,
      mode: "simulation",
    });
    renderAt(`/game/${game.id}`);

    expect(await screen.findByRole("heading", { name: "Rocket Rumble" })).toBeInTheDocument();
    expect(screen.getByText(/simulation mode · saved/)).toBeInTheDocument();
    expect(screen.getByText("Blast off with friends.")).toBeInTheDocument();
    // Without an active party there is no select action — but a "Start
    // party" CTA that preseeds this game (2t1.10).
    expect(screen.queryByRole("button", { name: /select game/i })).not.toBeInTheDocument();
    const start = screen.getByRole("link", { name: /Start party/ });
    expect(start.getAttribute("href")).toBe(
      `/party?gameId=${game.id}&mode=simulation&title=Rocket+Rumble`,
    );
    // The back link is a compact soft button, not a full-width bar.
    const back = screen.getByRole("link", { name: "Back to games" });
    expect(back.className).toContain("btn-soft");
    expect(back.className).toContain("self-start");
    // The brand row stays visible on the details page (2t1.1).
    expect(screen.getByRole("link", { name: /rocketcrab\.com/ })).toBeInTheDocument();
  });

  it("selects a saved game for the active party and returns to the lobby (10.9)", async () => {
    stubs.mode = "lobby";
    const game = await gameRepository.create({
      title: "Rocket Rumble",
      html: SAVED_HTML,
      mode: "state",
    });
    const router = renderAt(`/game/${game.id}`);

    const select = await screen.findByRole("button", { name: /select game/i });
    await userEvent.click(select);

    await vi.waitFor(() =>
      expect(stubEngine.selectGame).toHaveBeenCalledWith({
        gameId: game.id,
        title: "Rocket Rumble",
        mode: "state",
        source: SAVED_HTML,
        apiVersion: 1,
      }),
    );
    // Back in the party lobby.
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/party"));
    expect(screen.queryByRole("button", { name: /select game/i })).not.toBeInTheDocument();
  });

  it("selects a classic game for the active party via selectClassicGame (10.9)", async () => {
    stubs.mode = "lobby";
    const router = renderAt("/game/drawphone");

    const select = await screen.findByRole("button", { name: /select game/i });
    await userEvent.click(select);

    await vi.waitFor(() => expect(stubEngine.selectClassicGame).toHaveBeenCalledWith("drawphone"));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/party"));
  });

  it("keeps the editor action alongside the party select (10.9/2t1.10)", async () => {
    stubs.mode = "lobby";
    renderAt("/game/nova-quiz");

    const select = await screen.findByRole("button", { name: /select game/i });
    // The back link returns to the party, not the browse page.
    const back = screen.getByRole("link", { name: "Back to party" });
    expect(back.getAttribute("href")).toBe("/party");
    expect(back.className).toContain("self-start");

    // Nova prebuilt games keep their editor action.
    const editor = screen.getByRole("button", { name: /open in the editor/i });
    // "Select game" and "Open in the editor" share the same size so
    // the centered action group renders two identical-height buttons.
    expect(select.className).toContain("btn-lg");
    expect(editor.className).toContain("btn-lg");
    expect(editor.className).toContain("btn-primary");
    expect(select.className).toContain("btn-primary");
  });

  it("shows no CTA to a guest in a party — the host picks (2t1.10)", async () => {
    stubs.mode = "guest";
    renderAt("/game/nova-quiz");

    await screen.findByRole("heading", { name: "Nova Quiz" });
    expect(screen.queryByRole("button", { name: /select game/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Start party/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start party/ })).not.toBeInTheDocument();
  });

  it("offers a same-size primary Start-party CTA for classic games outside a party (2t1.10)", async () => {
    renderAt("/game/drawphone");

    const start = await screen.findByRole("link", { name: "Start party" });
    expect(start.className).toContain("btn-primary");
    expect(start.className).toContain("btn-lg");
    // Classic games can't be preselected over the URL — plain /party entry.
    expect(start.getAttribute("href")).toBe("/party");
    // And the old standalone play-game view is gone.
    expect(screen.queryByRole("link", { name: /Play game/ })).not.toBeInTheDocument();
  });
});
