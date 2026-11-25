import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { resetInviteImportForTests } from "../lib/party/invite-import";

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

const ACTIVE_STATE: PartyEngineState = {
  ...IDLE_STATE,
  phase: "lobby",
  role: "creator",
  displayName: "Ada",
  members: [
    {
      memberId: "member-a",
      displayName: "Ada",
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
    // Several components subscribe (page, site background, footer), so keep them all.
    handlers: Set<(state: PartyEngineState) => void>;
  } = { started: false, state: null, handlers: new Set() };
  const currentState = (): PartyEngineState =>
    stubs.state ?? (stubs.started ? ACTIVE_STATE : IDLE_STATE);
  return {
    stubs,
    stubEngine: {
      getState: vi.fn((): PartyEngineState => currentState()),
      onState: vi.fn((handler: (state: PartyEngineState) => void) => {
        stubs.handlers.add(handler);
        handler(currentState());
        return () => {
          stubs.handlers.delete(handler);
        };
      }),
      isActive: vi.fn(() => currentState().phase !== "idle"),
      setContainer: vi.fn(),
      setDisplayName: vi.fn(),
      selectGame: vi.fn(async () => undefined),
      retrySetup: vi.fn(),
      dismissError: vi.fn(),
      createParty: vi.fn(async () => {
        stubs.started = true;
        for (const handler of stubs.handlers) handler(ACTIVE_STATE);
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

vi.mock("../lib/catalog/nova-games", () => ({
  NOVA_GAMES: [
    {
      id: "hosted-quiz",
      name: "Hosted Quiz",
      author: "Someone",
      description: "A quiz on GitHub Pages.",
      difficulty: "easy",
      genres: ["trivia"],
      play: { kind: "nova", url: "https://someone.github.io/quiz/index.html" },
    },
  ],
}));

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
  stubs.handlers.clear();
  await gameRepository.clear();
  resetPartySourceForTests();
  clearPartyRecovery();
  resetPartyIdentityForTests();
  resetInviteImportForTests();
  window.history.pushState({}, "", "/party");
});

describe("/party", () => {
  it("asks for a name first when none was ever set; no start-party page", async () => {
    renderParty("/party");
    expect(await screen.findByRole("heading", { name: "What's your name?" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Start a party" })).not.toBeInTheDocument();
    expect(stubEngine.createParty).not.toHaveBeenCalled();
  });

  it("starts the party as soon as the name is entered", async () => {
    renderParty("/party");
    fireEvent.change(await screen.findByLabelText("Enter your name here"), {
      target: { value: "Ada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start party" }));
    expect(stubEngine.setDisplayName).toHaveBeenCalledWith("Ada");
    await waitFor(() => expect(stubEngine.createParty).toHaveBeenCalledWith());
  });

  it("skips the entry page for a returning player with a saved name", async () => {
    updatePartyDisplayName("Ada");
    renderParty("/party");
    await waitFor(() => expect(stubEngine.setDisplayName).toHaveBeenCalledWith("Ada"));
    await waitFor(() => expect(stubEngine.createParty).toHaveBeenCalledWith());
    expect(await screen.findByText("Welcome to rocketcrab!")).toBeInTheDocument();
    expect(screen.getByTestId("app-background")).toHaveAttribute("data-variant", "molten");
    expect(screen.queryByRole("heading", { name: "What's your name?" })).not.toBeInTheDocument();
  });

  it("creates a party from a saved game", async () => {
    updatePartyDisplayName("Ada");
    const game = await gameRepository.create({
      title: "Rocket Rumble",
      html: SAVED_HTML,
    });
    const router = renderParty(`/party?gameId=${game.id}&title=${encodeURIComponent(game.title)}`);
    await waitFor(() => expect(stubEngine.createParty).toHaveBeenCalledTimes(1));
    expect(stubEngine.createParty).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId: game.id,
        title: "Rocket Rumble",
        source: SAVED_HTML,
        apiVersion: 1,
      }),
    );
    // The private game leaves the URL once the party exists, so replay can record it.
    await waitFor(() => expect(router.state.location.href).toBe("/party"));
    expect(stubEngine.createParty).toHaveBeenCalledTimes(1);
  });

  it("creates a party from a hosted Nova game by downloading it", async () => {
    updatePartyDisplayName("Ada");
    const fetchMock = vi.fn(async (_url: string) => new Response(SAVED_HTML, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      renderParty("/party?gameId=hosted-quiz&title=Hosted%20Quiz");
      await waitFor(() => expect(stubEngine.createParty).toHaveBeenCalledTimes(1));
      expect(fetchMock.mock.calls[0]![0]).toBe("https://someone.github.io/quiz/index.html");
      expect(stubEngine.createParty).toHaveBeenCalledWith({
        gameId: "hosted-quiz",
        title: "Hosted Quiz",
        source: SAVED_HTML,
        apiVersion: 1,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("prefers the editor's handed-off source over the saved game", async () => {
    updatePartyDisplayName("Ada");
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
      secret,
      displayName: "Player A",
      game: { gameId: "game-1", title: "Rocket Rumble" },
    });
    renderParty("/party");
    expect(await screen.findByTestId("party-resume-banner")).toBeInTheDocument();
    expect(screen.getByText(/Rocket Rumble/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /rejoin party/i }));
    await waitFor(() => expect(stubEngine.joinByInvite).toHaveBeenCalledWith({ secret }));
  });

  it("dismissing the resume banner clears the recovery record", async () => {
    savePartyRecovery({
      role: "joiner",
      secret: "C".repeat(43),
      displayName: "Player A",
      game: null,
    });
    renderParty("/party");
    fireEvent.click(await screen.findByRole("button", { name: /not now/i }));
    expect(screen.queryByTestId("party-resume-banner")).not.toBeInTheDocument();
    expect(readPartyRecovery()).toBeNull();
  });

  it("joins a friend's party from an invite link, after the name step", async () => {
    const secret = "E".repeat(43);
    window.history.pushState({}, "", `/party#secret=${secret}`);
    renderParty("/party");
    expect(await screen.findByRole("heading", { name: "What's your name?" })).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(stubEngine.joinByInvite).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Enter your name here"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Join party" }));
    await waitFor(() => expect(stubEngine.joinByInvite).toHaveBeenCalledWith({ secret }));
    expect(stubEngine.createParty).not.toHaveBeenCalled();
  });

  it("joins straight away from an invite link when the name is saved", async () => {
    updatePartyDisplayName("Ada");
    const secret = "F".repeat(43);
    window.history.pushState({}, "", `/party#secret=${secret}`);
    renderParty("/party");
    await waitFor(() => expect(stubEngine.joinByInvite).toHaveBeenCalledWith({ secret }));
    expect(stubEngine.createParty).not.toHaveBeenCalled();
  });

  describe("host URL normalization to /<code>", () => {
    it("replaces /party with /<code> once a party is active", async () => {
      updatePartyDisplayName("Ada");
      const router = renderParty("/party");
      await vi.waitFor(() => expect(router.state.location.pathname).toBe("/party"));
      // The rewrite is a REPLACE: the /party entry is gone from history, so
      // there is no back-navigation spam into the party flow.
      expect(router.history.canGoBack()).toBe(false);
      await vi.waitFor(() =>
        expect(screen.getByText("Welcome to rocketcrab!")).toBeInTheDocument(),
      );
    });

    it("keeps /party?browse=true in browse mode (back-to-category entry)", async () => {
      stubs.started = true;
      const router = renderParty("/party?browse=true");
      // The router serializes the boolean as ?browse=true; ?browse=1 does not round-trip.
      const brand = await screen.findByTestId("browser-brand-row");
      expect(brand.querySelector("img")).toHaveAttribute("height", "56");
      expect(router.state.location.pathname).toBe("/party");
      expect(router.state.location.searchStr).toBe("?browse=true");
    });

    it("never redirects while idle or still creating", async () => {
      let router = renderParty("/party");
      expect(await screen.findByRole("heading", { name: "What's your name?" })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/party");
      stubs.state = CREATING_STATE;
      router = renderParty("/party");
      expect(await screen.findByText("Creating party…")).toBeInTheDocument();
      expect(screen.getByTestId("browser-brand-row")).toHaveTextContent("rocketcrab.com");
      expect(router.state.location.pathname).toBe("/party");
    });
  });

  // The engine classifies setup failures (engine.test.ts, fake clock); these
  // cover how each classified state reads and what its buttons do.
  describe("setup failures and outages", () => {
    const JOIN_ERROR_STATE: PartyEngineState = {
      ...IDLE_STATE,
      phase: "error",
      lastError: "Couldn't reach anyone in this party.",
      setupFailureCode: null,
    };

    it("keeps a signaling outage a warning with a Cancel button, not a failure", async () => {
      stubs.state = { ...CREATING_STATE, signalingOutage: true };
      renderParty("/party");
      expect(
        await screen.findByText(
          "Can't reach Rocketcrab's servers. Check your internet connection. We'll keep trying to connect.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText("Creating party…")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(stubEngine.leaveParty).toHaveBeenCalled());
    });

    it("shows a generic join timeout without blaming a peer report", async () => {
      stubs.state = JOIN_ERROR_STATE;
      renderParty("/party");
      expect(await screen.findByText("The party couldn't be set up")).toBeInTheDocument();
      expect(screen.getByText(/Couldn't reach anyone in this party\./)).toBeInTheDocument();
      expect(screen.queryByText(/this may not be why/)).not.toBeInTheDocument();
    });

    it.each([
      ["room-full", "A player reported the party may be full"],
      ["decrypt-failed", "A message from a player couldn't be decrypted"],
    ] as const)("qualifies a %s report as a possible cause only", async (code, message) => {
      stubs.state = { ...JOIN_ERROR_STATE, setupFailureCode: code };
      renderParty("/party");
      expect(await screen.findByText("Couldn't connect to the party")).toBeInTheDocument();
      const detail = screen.getByText(new RegExp(message));
      expect(detail).toHaveTextContent("Couldn't reach anyone in this party.");
      expect(detail).toHaveTextContent("this may not be why you couldn't connect");
    });

    it("thanks the players for the game that just ended", async () => {
      const lobby: PartyEngineState = {
        ...ACTIVE_STATE,
        game: { kind: "nova", gameId: "game-1", title: "Rocket Rumble" },
      } as PartyEngineState;
      const publish = (state: PartyEngineState) =>
        act(() => {
          stubs.state = state;
          for (const handler of stubs.handlers) handler(state);
        });
      stubs.state = lobby;
      renderParty("/party");
      expect(await screen.findByLabelText("Welcome")).toBeInTheDocument();
      publish({ ...lobby, phase: "playing" });
      publish(lobby);
      expect(await screen.findByLabelText("Thanks for playing")).toHaveTextContent(
        "Thanks for playing Rocket Rumble on rocketcrab!",
      );
      // Picking another game returns to the regular card.
      publish({
        ...lobby,
        game: { kind: "nova", gameId: "game-2", title: "Other" },
      } as PartyEngineState);
      expect(await screen.findByLabelText("Welcome")).toBeInTheDocument();
    });

    it("retries setup from Try again and dismisses the error from Back", async () => {
      stubs.state = JOIN_ERROR_STATE;
      renderParty("/party");
      fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
      expect(stubEngine.retrySetup).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(stubEngine.dismissError).toHaveBeenCalledOnce();
    });
  });
});
