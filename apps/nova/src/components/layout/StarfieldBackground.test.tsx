import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PartyEngine, PartyEngineState } from "../../lib/party/engine";
import { StarfieldBackground } from "./StarfieldBackground";

/**
 * Starfield tests (rocketcrab-22n): the site-wide star layer renders on
 * every page and unmounts only while a party is actively playing a game
 * (`state.game !== null`). The in-game signal comes off the shared party
 * engine, so these tests drive an injectable fake engine instead of a real
 * party.
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
  runtimeLogs: [],
  lastError: null,
};

/** A party that just started playing a Nova game (22n in-game signal). */
const IN_GAME_STATE: PartyEngineState = {
  ...IDLE_STATE,
  phase: "lobby",
  game: { gameId: "my-game", title: "My Game", mode: "state" },
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

function renderStarfield(engine?: PartyEngine) {
  cleanup();
  return render(<StarfieldBackground engine={engine} />);
}

describe("StarfieldBackground (22n)", () => {
  it("renders the starfield when no party game is live (idle engine)", () => {
    const { engine } = makeEngine(IDLE_STATE);
    renderStarfield(engine);
    expect(screen.getByTestId("app-starfield")).toBeInTheDocument();
  });

  it("renders the starfield while a party is in the lobby (game not yet selected)", () => {
    const { engine } = makeEngine({ ...IDLE_STATE, phase: "lobby" });
    renderStarfield(engine);
    expect(screen.getByTestId("app-starfield")).toBeInTheDocument();
  });

  it("hides the starfield once the party is actively playing a game", () => {
    const { engine } = makeEngine(IN_GAME_STATE);
    renderStarfield(engine);
    expect(screen.queryByTestId("app-starfield")).not.toBeInTheDocument();
  });

  it("unmounts the starfield reactively when a game starts (no fade logic)", async () => {
    const { engine, setState } = makeEngine(IDLE_STATE);
    renderStarfield(engine);
    expect(screen.getByTestId("app-starfield")).toBeInTheDocument();

    setState(IN_GAME_STATE);
    await waitFor(() => {
      expect(screen.queryByTestId("app-starfield")).not.toBeInTheDocument();
    });
  });

  it("renders the starfield again when the game ends and the lobby returns", async () => {
    const { engine, setState } = makeEngine(IN_GAME_STATE);
    renderStarfield(engine);
    expect(screen.queryByTestId("app-starfield")).not.toBeInTheDocument();

    setState({
      ...IDLE_STATE,
      phase: "lobby",
      endedReason: "host ended the game",
    });
    await waitFor(() => {
      expect(screen.getByTestId("app-starfield")).toBeInTheDocument();
    });
  });
});
