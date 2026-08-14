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
 * Game detail page party-pick tests (10.9): the shared /game/:gameId page
 * also serves saved games (title, description, mode from the IndexedDB
 * repository), and when a party is waiting in its lobby the creator gets a
 * "Select for party" action that hands the game to the party engine and
 * returns to /party — the lobby never sets the game directly.
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
  connectionState: "connected",
  canStart: false,
  canForceStart: false,
  startBlockedReason: "Pick a game before starting the party.",
};

const { stubEngine, stubs } = vi.hoisted(() => {
  const stubs: { active: boolean } = { active: false };
  return {
    stubs,
    stubEngine: {
      getState: vi.fn((): PartyEngineState => (stubs.active ? LOBBY_STATE : IDLE_STATE)),
      onState: vi.fn((handler: (state: PartyEngineState) => void) => {
        handler(stubs.active ? LOBBY_STATE : IDLE_STATE);
        return () => undefined;
      }),
      isActive: vi.fn(() => stubs.active),
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
  stubs.active = false;
  await gameRepository.clear();
});

describe("/game/:gameId — saved games and party selection (10.9)", () => {
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
    // Without an active party there is no select action.
    expect(screen.queryByRole("button", { name: /select for party/i })).not.toBeInTheDocument();
    // The back link is a compact outline button, not a full-width bar.
    const back = screen.getByRole("link", { name: "Back to games" });
    expect(back.className).toContain("btn-outline");
    expect(back.className).toContain("self-start");
  });

  it("selects a saved game for the active party and returns to the lobby (10.9)", async () => {
    stubs.active = true;
    const game = await gameRepository.create({
      title: "Rocket Rumble",
      html: SAVED_HTML,
      mode: "state",
    });
    const router = renderAt(`/game/${game.id}`);

    const select = await screen.findByRole("button", { name: /select for party/i });
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
    expect(screen.queryByRole("button", { name: /select for party/i })).not.toBeInTheDocument();
  });

  it("selects a classic game for the active party via selectClassicGame (10.9)", async () => {
    stubs.active = true;
    const router = renderAt("/game/drawphone");

    const select = await screen.findByRole("button", { name: /select for party/i });
    await userEvent.click(select);

    await vi.waitFor(() => expect(stubEngine.selectClassicGame).toHaveBeenCalledWith("drawphone"));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/party"));
  });

  it("keeps the play/open actions alongside the party select (10.9)", async () => {
    stubs.active = true;
    renderAt("/game/nova-quiz");

    const select = await screen.findByRole("button", { name: /select for party/i });
    // The back link returns to the party, not the browse page.
    const back = screen.getByRole("link", { name: "Back to party" });
    expect(back.getAttribute("href")).toBe("/party");
    expect(back.className).toContain("self-start");

    // Nova prebuilt games keep their editor action.
    const editor = screen.getByRole("button", { name: /open in the editor/i });
    // "Select for party" and "Open in the editor" share the same size so
    // the centered action group renders two identical-height buttons
    // (rocketcrab-9fv.11.12).
    expect(select.className).toContain("btn-lg");
    expect(editor.className).toContain("btn-lg");
    expect(editor.className).toContain("btn-primary");
    expect(select.className).toContain("btn-primary");
  });

  it("renders the classic play action as a same-size primary button", async () => {
    renderAt("/game/drawphone");

    const play = await screen.findByRole("link", { name: "Play game" });
    expect(play.className).toContain("btn-primary");
    expect(play.className).toContain("btn-lg");
  });
});
