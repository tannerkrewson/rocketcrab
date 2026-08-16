import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
 * entry point when no party is active (7.37: a single "Start a party"
 * action — rocketcrab-9j3 removed the entry's name step so /join?edit=name
 * is the ONLY name page; a saved name still skips the entry page
 * entirely), renders the party experience once a party is active, and
 * normalizes the host's address bar to /<code> in place once a party is
 * active (rocketcrab-r0f — except on /party?browse=true, 5cl.7).
 */

const IDLE_STATE: PartyEngineState = {
  phase: "idle",
  phaseDetail: null,
  joinStage: null,
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
  runtimeLogs: [],
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

/** A party still being created: engine active but no code known yet. */
const CREATING_STATE: PartyEngineState = {
  ...IDLE_STATE,
  phase: "creating",
  phaseDetail: "Creating party…",
  connectionState: "joining",
};

const { stubEngine, stubs } = vi.hoisted(() => {
  const stubs: {
    started: boolean;
    state: PartyEngineState | null;
    handler: ((state: PartyEngineState) => void) | null;
  } = { started: false, state: null, handler: null };
  const currentState = (): PartyEngineState =>
    stubs.state ?? (stubs.started ? ACTIVE_STATE : IDLE_STATE);
  return {
    stubs,
    stubEngine: {
      getState: vi.fn((): PartyEngineState => currentState()),
      onState: vi.fn((handler: (state: PartyEngineState) => void) => {
        stubs.handler = handler;
        handler(currentState());
        return () => undefined;
      }),
      isActive: vi.fn(() => currentState().phase !== "idle"),
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
  // The lobby's game browser (browse mode, initialBrowse) queries saved
  // games, so give every render a fresh query client.
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(<RouterProvider router={router} />, { wrapper });
  return router;
}

const SAVED_HTML = "<!doctype html><html><body><p>rockets</p></body></html>";

beforeEach(async () => {
  vi.clearAllMocks();
  stubs.started = false;
  stubs.state = null;
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
    // 9j3: the entry has NO name step (that's /join?edit=name's job) and
    // 5kz: no placeholder copy about picking a game in the lobby.
    expect(await screen.findByRole("heading", { name: "Start a party" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Your player name")).not.toBeInTheDocument();
    expect(screen.queryByText(/your party starts in the lobby/i)).not.toBeInTheDocument();
    expect(stubEngine.createParty).not.toHaveBeenCalled();
  });

  it("shows no secondary actions on the start-party page (7.37)", async () => {
    renderParty("/party");
    await screen.findByRole("heading", { name: "Start a party" });
    expect(screen.queryByRole("link", { name: /start with a game/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /join a party/i })).not.toBeInTheDocument();
  });

  it("starts a party without a game directly from the entry (rocketcrab-9j3)", async () => {
    renderParty("/party");
    await screen.findByRole("heading", { name: "Start a party" });
    // 9j3: the party starts with the saved/generated name — there is no
    // name input to fill in and nothing applied before createParty.
    fireEvent.click(screen.getByRole("button", { name: /start a party/i }));
    await waitFor(() => expect(stubEngine.createParty).toHaveBeenCalledWith());
    expect(stubEngine.setDisplayName).not.toHaveBeenCalled();
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

  describe("host URL normalization to /<code> (rocketcrab-r0f)", () => {
    it("replaces /party with /<code> once a party is active", async () => {
      const router = renderParty("/party");
      // Start a party from the entry; once the engine is active with a code
      // the address bar must read the party code instead of /party.
      fireEvent.click(await screen.findByRole("button", { name: /start a party/i }));
      await vi.waitFor(() => expect(router.state.location.pathname).toBe("/RCRB"));
      // The rewrite is a REPLACE: the /party entry is gone from history, so
      // there is no back-navigation spam into the party flow.
      expect(router.history.canGoBack()).toBe(false);
      // The party experience (not the join flow) is what renders on /<code>.
      await vi.waitFor(() =>
        expect(screen.getByText("Welcome to rocketcrab!")).toBeInTheDocument(),
      );
    });

    it("keeps /party?browse=true in browse mode (5cl.7 back-to-category entry)", async () => {
      stubs.started = true;
      const router = renderParty("/party?browse=true");
      // The lobby (in browse mode) renders and the URL stays untouched — the
      // game-details 'back to category' link must keep delivering
      // initialBrowse to the lobby. (The router serializes search browse:true
      // as ?browse=true and validateSearch restores the boolean, so this is
      // the real URL form the app produces; plain ?browse=1 never
      // round-trips to the /party route's boolean.)
      expect(await screen.findByTestId("party-title")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/party");
      expect(router.state.location.searchStr).toBe("?browse=true");
    });

    it("never redirects while idle or still creating", async () => {
      // Idle: no party — the entry page stays put.
      let router = renderParty("/party");
      expect(await screen.findByRole("heading", { name: "Start a party" })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/party");
      // Creating: engine active but no code yet — the address bar must not
      // jump anywhere until a code exists.
      stubs.state = CREATING_STATE;
      router = renderParty("/party");
      expect(await screen.findByText("Creating party…")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/party");
    });
  });
});
