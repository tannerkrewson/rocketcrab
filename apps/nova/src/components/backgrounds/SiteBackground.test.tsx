import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PartyEngine, PartyEngineState } from "../../lib/party/engine";
import { SiteFooter } from "../layout/SiteFooter";
import { SiteBackground } from "./SiteBackground";

/** Drive the shared playing-phase signal through an injectable fake party engine. */

const IDLE_STATE: PartyEngineState = {
  phase: "idle",
  phaseDetail: null,
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
  joinStage: null,
  lastError: null,
  peerLink: null,
  sharedGames: [],
  offeredGames: [],
  myOffer: null,
};

const IN_GAME_STATE: PartyEngineState = {
  ...IDLE_STATE,
  phase: "playing",
  game: { kind: "nova", gameId: "my-game", title: "My Game" },
};

interface FakeEngine {
  engine: PartyEngine;
  setState: (next: PartyEngineState) => void;
}

/** Minimal PartyEngine stub: getState + onState only (what usePartyEngine uses). */
function makeEngine(initial: PartyEngineState): FakeEngine {
  let state = initial;
  const listeners = new Set<(next: PartyEngineState) => void>();
  return {
    engine: {
      getState: () => state,
      onState: (handler: (next: PartyEngineState) => void) => {
        listeners.add(handler);
        handler(state);
        return () => {
          listeners.delete(handler);
        };
      },
    } as unknown as PartyEngine,
    setState(next: PartyEngineState) {
      state = next;
      for (const listener of listeners) {
        listener(state);
      }
    },
  };
}

function renderBackground(engine?: PartyEngine) {
  cleanup();
  return render(<SiteBackground engine={engine} />);
}

describe("SiteBackground", () => {
  it("renders the background when no party game is live (idle engine)", () => {
    const { engine } = makeEngine(IDLE_STATE);
    renderBackground(engine);
    expect(screen.getByTestId("app-background")).toBeInTheDocument();
  });

  it("renders the background while a party is in the lobby (game not yet selected)", () => {
    const { engine } = makeEngine({ ...IDLE_STATE, phase: "lobby" });
    renderBackground(engine);
    expect(screen.getByTestId("app-background")).toBeInTheDocument();
  });

  it("keeps the background visible in the lobby after a game is selected", () => {
    const { engine } = makeEngine({ ...IN_GAME_STATE, phase: "lobby" });
    renderBackground(engine);
    expect(screen.getByTestId("app-background")).toBeInTheDocument();
  });

  it("hides the background once the party is actively playing a game", () => {
    const { engine } = makeEngine(IN_GAME_STATE);
    renderBackground(engine);
    expect(screen.queryByTestId("app-background")).not.toBeInTheDocument();
  });

  it("unmounts the background reactively when a game starts (no fade logic)", async () => {
    const { engine, setState } = makeEngine(IDLE_STATE);
    renderBackground(engine);
    expect(screen.getByTestId("app-background")).toBeInTheDocument();

    setState(IN_GAME_STATE);
    await waitFor(() => {
      expect(screen.queryByTestId("app-background")).not.toBeInTheDocument();
    });
  });

  it("renders the background again when the game ends and the lobby returns", async () => {
    const { engine, setState } = makeEngine(IN_GAME_STATE);
    renderBackground(engine);
    expect(screen.queryByTestId("app-background")).not.toBeInTheDocument();

    setState({
      ...IDLE_STATE,
      phase: "lobby",
      endedReason: "host ended the game",
    });
    await waitFor(() => {
      expect(screen.getByTestId("app-background")).toBeInTheDocument();
    });
  });
});

describe("SiteFooter during play", () => {
  it("shows the credit footer outside a game and hides it while playing", async () => {
    const { engine, setState } = makeEngine(IDLE_STATE);
    cleanup();
    const router = createRouter({
      routeTree: createRootRoute({ component: () => <SiteFooter engine={engine} /> }),
      history: createMemoryHistory(),
    });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("contentinfo")).toBeInTheDocument();

    setState(IN_GAME_STATE);
    await waitFor(() => {
      expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
    });
  });
});
