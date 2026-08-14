import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PartyEngineState } from "../lib/party/engine";
import { resetInviteImportForTests } from "../lib/party/invite-import";
import { clearPartyRecovery, savePartyRecovery } from "../lib/party/party-recovery";
import { routeTree } from "../routeTree.gen";

/**
 * Join route tests (P4/7.47): the two-step join flow — room code first
 * (tall mono input, Continue gated on four letters), then the player name
 * with a code confirmation — plus the invite-fragment import (ADR-0011 —
 * the secret is read into session memory and the fragment is stripped from
 * the URL before the party experience renders) and the code-submit wiring
 * into the party engine.
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

const { stubEngine, stubs } = vi.hoisted(() => {
  const stubs = { joinCalled: false };
  return {
    stubs,
    stubEngine: {
      getState: vi.fn((): PartyEngineState => (stubs.joinCalled ? ERROR_STATE : IDLE_STATE)),
      onState: vi.fn(() => () => undefined),
      isActive: vi.fn(() => false),
      setContainer: vi.fn(),
      setDisplayName: vi.fn(),
      selectGame: vi.fn(async () => undefined),
      retrySetup: vi.fn(),
      dismissError: vi.fn(),
      createParty: vi.fn(async () => undefined),
      joinByCode: vi.fn(async () => {
        stubs.joinCalled = true;
      }),
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

const ERROR_STATE: PartyEngineState = {
  ...IDLE_STATE,
  phase: "error",
  lastError:
    "No party is advertising code ZZZZ. Double-check the code with your friend and that they are waiting in their lobby.",
};

beforeEach(() => {
  vi.clearAllMocks();
  stubs.joinCalled = false;
  resetInviteImportForTests();
  clearPartyRecovery();
  window.history.pushState({}, "", "/join");
});

describe("/join", () => {
  it("starts with only the room-code input; the name step comes after a code", async () => {
    renderJoin();
    expect(await screen.findByText("Join a party")).toBeInTheDocument();
    expect(screen.getByLabelText("Four-letter party code")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your player name")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Four-letter party code"), {
      target: { value: "abcd" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(await screen.findByLabelText("Your player name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^join$/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Four-letter party code")).not.toBeInTheDocument();
  });

  it("submits the normalized code and the player name to the engine", async () => {
    renderJoin();
    const input = await screen.findByLabelText("Four-letter party code");
    fireEvent.change(input, { target: { value: " abcd " } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    const nameInput = await screen.findByLabelText("Your player name");
    fireEvent.change(nameInput, { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: /^join$/i }));
    await waitFor(() => expect(stubEngine.setDisplayName).toHaveBeenCalledWith("Ada"));
    await waitFor(() => expect(stubEngine.joinByCode).toHaveBeenCalledWith("ABCD"));
  });

  it("shows the code with its lowercase phonetic spelling on the name step", async () => {
    renderJoin();
    const input = await screen.findByLabelText("Four-letter party code");
    fireEvent.change(input, { target: { value: "xaby" } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(await screen.findByText(/\(xray alpha bravo yankee\)/)).toBeInTheDocument();
  });

  it("keeps the typed code when going Back from the name step", async () => {
    renderJoin();
    const input = await screen.findByLabelText("Four-letter party code");
    fireEvent.change(input, { target: { value: "abcd" } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await screen.findByLabelText("Your player name");
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    const backInput = await screen.findByLabelText("Four-letter party code");
    expect((backInput as HTMLInputElement).value).toBe("ABCD");
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

  it("keeps Continue disabled until the code is four letters", async () => {
    renderJoin();
    const input = await screen.findByLabelText("Four-letter party code");
    const continueButton = screen.getByRole("button", { name: /^continue$/i });
    expect(continueButton).toBeDisabled();
    fireEvent.change(input, { target: { value: "abc" } });
    expect(continueButton).toBeDisabled();
    fireEvent.change(input, { target: { value: "abcd" } });
    expect(continueButton).toBeEnabled();
  });

  it("filters non-letter key presses on the code input", async () => {
    renderJoin();
    const input = await screen.findByLabelText("Four-letter party code");
    expect(fireEvent.keyDown(input, { key: "1" })).toBe(false); // defaultPrevented
    expect(fireEvent.keyDown(input, { key: "a" })).toBe(true);
  });

  it("shows a classic 'does not exist' inline error for an unadvertised code", async () => {
    renderJoin();
    const input = await screen.findByLabelText("Four-letter party code");
    fireEvent.change(input, { target: { value: "zzzz" } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await screen.findByLabelText("Your player name");
    fireEvent.click(screen.getByRole("button", { name: /^join$/i }));
    await waitFor(() => expect(stubEngine.joinByCode).toHaveBeenCalledWith("ZZZZ"));
    expect(await screen.findByText(/ZZZZ does not exist/)).toBeInTheDocument();
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
