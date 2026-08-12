import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gameRepository } from "../lib/games/instance";
import type { PartyEngineState } from "../lib/party/engine";
import {
  clearPartyRecovery,
  readPartyRecovery,
  savePartyRecovery,
} from "../lib/party/party-recovery";
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

const { stubEngine } = vi.hoisted(() => ({
  stubEngine: {
    getState: vi.fn((): PartyEngineState => IDLE_STATE),
    onState: vi.fn(() => () => undefined),
    isActive: vi.fn(() => false),
    setContainer: vi.fn(),
    setDisplayName: vi.fn(),
    selectGame: vi.fn(async () => undefined),
    retrySetup: vi.fn(),
    dismissError: vi.fn(),
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
  clearPartyRecovery();
});

describe("/party", () => {
  it("shows the entry point when no party is active and no game is chosen", async () => {
    renderParty("/party");
    expect(await screen.findByText("No party here yet")).toBeInTheDocument();
    expect(stubEngine.createParty).not.toHaveBeenCalled();
  });

  it("starts a party without a game, applying the entered name first (7.5/7.6)", async () => {
    renderParty("/party");
    await screen.findByText("No party here yet");
    const nameInput = await screen.findByLabelText("Your player name");
    fireEvent.change(nameInput, { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: /start a party/i }));
    await waitFor(() => expect(stubEngine.setDisplayName).toHaveBeenCalledWith("Ada"));
    await waitFor(() => expect(stubEngine.createParty).toHaveBeenCalledWith());
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

  it("offers a one-tap rejoin from a saved recovery record after a reload (M1)", async () => {
    const secret = "B".repeat(43);
    savePartyRecovery({
      role: "joiner",
      code: "ABCD",
      secret,
      memberId: "member-a",
      displayName: "Player A",
      game: { gameId: "game-1", title: "Rocket Rumble", mode: "state" },
    });
    renderParty("/party");
    expect(await screen.findByTestId("party-resume-banner")).toBeInTheDocument();
    expect(screen.getByText(/Rocket Rumble/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /rejoin party/i }));
    await waitFor(() =>
      expect(stubEngine.joinByInvite).toHaveBeenCalledWith({ secret, code: "ABCD" }),
    );
  });

  it("dismissing the resume banner clears the recovery record", async () => {
    savePartyRecovery({
      role: "joiner",
      code: "ABCD",
      secret: "C".repeat(43),
      memberId: "member-a",
      displayName: "Player A",
      game: null,
    });
    renderParty("/party");
    fireEvent.click(await screen.findByRole("button", { name: /not now/i }));
    expect(screen.queryByTestId("party-resume-banner")).not.toBeInTheDocument();
    expect(readPartyRecovery()).toBeNull();
  });
});
