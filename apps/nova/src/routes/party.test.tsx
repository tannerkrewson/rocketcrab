import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gameRepository } from "../lib/games/instance";
import type { PartyEngineState } from "../lib/party/engine";
import { resetPartyIdentityForTests, updatePartyDisplayName } from "../lib/party/identity";
import {
  clearPartyRecovery,
  readPartyRecovery,
  savePartyRecovery,
} from "../lib/party/party-recovery";
import { resetPartySourceForTests, storePartySource } from "../lib/party/source-handoff";
import { routeTree } from "../routeTree.gen";

/**
 * Party route tests (P4): the route creates a party from a saved game (or
 * from the editor's handed-off source) when `gameId` is present, shows an
 * entry point when no party is active (7.37: name + Start a party only,
 * and a saved name skips the entry page entirely), and renders the party
 * experience once a party is active.
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

/** A live lobby (game not yet picked), used once `createParty` runs. */
const ACTIVE_STATE: PartyEngineState = {
  ...IDLE_STATE,
  phase: "lobby",
  role: "creator",
  code: "RCRB",
  displayName: "Ada",
  members: [
    {
      memberId: "member-a",
      displayName: "Ada",
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

const { stubEngine, stubs } = vi.hoisted(() => {
  const stubs: {
    started: boolean;
    handler: ((state: PartyEngineState) => void) | null;
  } = { started: false, handler: null };
  return {
    stubs,
    stubEngine: {
      getState: vi.fn((): PartyEngineState => (stubs.started ? ACTIVE_STATE : IDLE_STATE)),
      onState: vi.fn((handler: (state: PartyEngineState) => void) => {
        stubs.handler = handler;
        handler(stubs.started ? ACTIVE_STATE : IDLE_STATE);
        return () => undefined;
      }),
      isActive: vi.fn(() => stubs.started),
      setContainer: vi.fn(),
      setDisplayName: vi.fn(),
      selectGame: vi.fn(async () => undefined),
      retrySetup: vi.fn(),
      dismissError: vi.fn(),
      createParty: vi.fn(async () => {
        stubs.started = true;
        stubs.handler?.(ACTIVE_STATE);
      }),
      joinByCode: vi.fn(async () => undefined),
      joinByInvite: vi.fn(async () => undefined),
      respondToJoinRequest: vi.fn(),
      startGame: vi.fn(),
      endGame: vi.fn(),
      leaveParty: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      refreshDiagnostics: vi.fn(async () => undefined),
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
  stubs.started = false;
  stubs.handler = null;
  await gameRepository.clear();
  resetPartySourceForTests();
  clearPartyRecovery();
  // 7.37: a saved player name changes the entry behavior — start fresh.
  resetPartyIdentityForTests();
});

describe("/party", () => {
  it("shows the entry point when no party is active and no game is chosen", async () => {
    renderParty("/party");
    expect(await screen.findByRole("heading", { name: "Start a party" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your player name")).toBeInTheDocument();
    expect(stubEngine.createParty).not.toHaveBeenCalled();
  });

  it("shows no secondary actions on the start-party page (7.37)", async () => {
    renderParty("/party");
    await screen.findByRole("heading", { name: "Start a party" });
    expect(screen.queryByRole("link", { name: /start with a game/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /join a party/i })).not.toBeInTheDocument();
  });

  it("starts a party without a game, applying the entered name first (7.5/7.6)", async () => {
    renderParty("/party");
    await screen.findByRole("heading", { name: "Start a party" });
    const nameInput = await screen.findByLabelText("Your player name");
    fireEvent.change(nameInput, { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: /start a party/i }));
    await waitFor(() => expect(stubEngine.setDisplayName).toHaveBeenCalledWith("Ada"));
    await waitFor(() => expect(stubEngine.createParty).toHaveBeenCalledWith());
  });

  it("skips the entry page for a returning player with a saved name (7.37)", async () => {
    // The player set a name before; the next visit lands straight in the
    // party without showing the name prompt.
    updatePartyDisplayName("Ada");
    renderParty("/party");
    await waitFor(() => expect(stubEngine.setDisplayName).toHaveBeenCalledWith("Ada"));
    await waitFor(() => expect(stubEngine.createParty).toHaveBeenCalledWith());
    // The party experience renders the lobby instead of the entry page.
    expect(await screen.findByText("Welcome to rocketcrab!")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Start a party" })).not.toBeInTheDocument();
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
