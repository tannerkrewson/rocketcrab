import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gameRepository } from "../lib/games/instance";
import type { PartyEngineState } from "../lib/party/engine";
import { resetPartySourceForTests, storePartySource } from "../lib/party/source-handoff";
import { routeTree } from "../routeTree.gen";

/**
 * Party route tests (P4): the route creates a party from a saved game (or
 * from the editor's handed-off source) when `gameId` is present, and shows
 * an entry point when no party is active.
 */

const IDLE_STATE: PartyEngineState = {
  phase: "idle",
  phaseDetail: null,
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
  diagnostics: null,
  notices: [],
  lastError: null,
};

const { stubEngine } = vi.hoisted(() => ({
  stubEngine: {
    getState: vi.fn((): PartyEngineState => IDLE_STATE),
    onState: vi.fn(() => () => undefined),
    isActive: vi.fn(() => false),
    setContainer: vi.fn(),
    createParty: vi.fn(async () => undefined),
    joinByCode: vi.fn(async () => undefined),
    joinByInvite: vi.fn(async () => undefined),
    respondToJoinRequest: vi.fn(),
    startGame: vi.fn(),
    endGame: vi.fn(),
    leaveParty: vi.fn(async () => undefined),
    reconnect: vi.fn(async () => undefined),
    refreshDiagnostics: vi.fn(async () => undefined),
  },
}));

vi.mock("../lib/party/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/party/engine")>();
  return {
    ...actual,
    partyEngine: stubEngine,
  };
});

function renderParty(entry: string) {
  cleanup();
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => <>{children}</>;
  return render(<RouterProvider router={router} />, { wrapper });
}

const SAVED_HTML = "<!doctype html><html><body><p>rockets</p></body></html>";

beforeEach(async () => {
  vi.clearAllMocks();
  await gameRepository.clear();
  resetPartySourceForTests();
});

describe("/party", () => {
  it("shows the entry point when no party is active and no game is chosen", async () => {
    renderParty("/party");
    expect(await screen.findByText("No party here yet")).toBeInTheDocument();
    expect(stubEngine.createParty).not.toHaveBeenCalled();
  });

  it("creates a party from a saved game", async () => {
    const game = await gameRepository.create({
      title: "Rocket Rumble",
      html: SAVED_HTML,
      mode: "state",
    });
    renderParty(`/party?gameId=${game.id}&mode=state&title=${encodeURIComponent(game.title)}`);
    await waitFor(() => expect(stubEngine.createParty).toHaveBeenCalledTimes(1));
    expect(stubEngine.createParty).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId: game.id,
        title: "Rocket Rumble",
        mode: "state",
        source: SAVED_HTML,
        apiVersion: 1,
      }),
    );
  });

  it("prefers the editor's handed-off source over the saved game", async () => {
    const game = await gameRepository.create({ title: "Rocket Rumble", html: SAVED_HTML });
    const unsaved = "<!doctype html><html><body><p>unsaved</p></body></html>";
    storePartySource({ gameId: game.id, source: unsaved });
    renderParty(`/party?gameId=${game.id}`);
    await waitFor(() => expect(stubEngine.createParty).toHaveBeenCalledTimes(1));
    expect(stubEngine.createParty).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: game.id, source: unsaved }),
    );
  });
});
