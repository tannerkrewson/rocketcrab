import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PartyEngineState } from "../lib/party/engine";
import { resetInviteImportForTests } from "../lib/party/invite-import";
import { clearPartyRecovery, savePartyRecovery } from "../lib/party/party-recovery";
import { routeTree } from "../routeTree.gen";

/**
 * Join route tests (P4): the four-letter entry form, the invite-fragment
 * import (ADR-0011 — the secret is read into session memory and the
 * fragment is stripped from the URL before the party experience renders),
 * and the code-submit wiring into the party engine.
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

function renderJoin() {
  cleanup();
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/join"] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => <>{children}</>;
  return render(<RouterProvider router={router} />, { wrapper });
}

const VALID_SECRET = "A".repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  resetInviteImportForTests();
  clearPartyRecovery();
  window.history.pushState({}, "", "/join");
});

describe("/join", () => {
  it("shows the four-letter join form when no party is active", async () => {
    renderJoin();
    expect(await screen.findByText("Join a party")).toBeInTheDocument();
    expect(screen.getByLabelText("Four-letter party code")).toBeInTheDocument();
  });

  it("submits the normalized code to the engine", async () => {
    renderJoin();
    const input = await screen.findByLabelText("Four-letter party code");
    fireEvent.change(input, { target: { value: " abcd " } });
    fireEvent.click(screen.getByRole("button", { name: /join party/i }));
    await waitFor(() => expect(stubEngine.joinByCode).toHaveBeenCalledWith("ABCD"));
  });

  it("imports an invite fragment secret and strips it from the URL", async () => {
    window.history.pushState({}, "", `/join#code=ABCD&secret=${VALID_SECRET}`);
    renderJoin();
    await waitFor(() => expect(stubEngine.joinByInvite).toHaveBeenCalledTimes(1));
    expect(stubEngine.joinByInvite).toHaveBeenCalledWith({
      secret: VALID_SECRET,
      code: "ABCD",
    });
    await waitFor(() => expect(window.location.hash).toBe(""));
  });

  it("strips a fragment with no valid invite data", async () => {
    window.history.pushState({}, "", "/join#garbage");
    renderJoin();
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(stubEngine.joinByInvite).not.toHaveBeenCalled();
    expect(stubEngine.joinByCode).not.toHaveBeenCalled();
  });

  it("offers a one-tap rejoin from a saved recovery record (M1)", async () => {
    const secret = "D".repeat(43);
    savePartyRecovery({
      role: "joiner",
      code: "EFGH",
      secret,
      memberId: "member-a",
      displayName: "Player A",
      game: { gameId: "game-1", title: "Rocket Rumble", mode: "state" },
    });
    renderJoin();
    expect(await screen.findByTestId("party-resume-banner")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /rejoin party/i }));
    await waitFor(() =>
      expect(stubEngine.joinByInvite).toHaveBeenCalledWith({ secret, code: "EFGH" }),
    );
  });
});
