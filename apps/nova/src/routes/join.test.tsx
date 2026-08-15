import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PartyEngineState } from "../lib/party/engine";
import { resetPartyIdentityForTests, setSavedPlayerName } from "../lib/party/identity";
import { resetInviteImportForTests } from "../lib/party/invite-import";
import { clearPartyRecovery, savePartyRecovery } from "../lib/party/party-recovery";
import { routeTree } from "../routeTree.gen";

/**
 * Join route tests (P4/7.47, reworked 2t1.9): the join is a SINGLE step —
 * enter the room code (tall mono input, Join gated on four letters) and
 * join straight away; the player's name is never asked up front. The
 * phonetic spelling confirms the code inline once it is complete, the
 * invite-fragment import (ADR-0011) still strips the secret from the URL,
 * and `/join?edit=name` renders the shared name-editing page (the same
 * name step the lobby's pencil / no-name prompt open).
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

function renderJoin(initialEntry = "/join") {
  cleanup();
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
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
  resetPartyIdentityForTests();
  clearPartyRecovery();
  window.history.pushState({}, "", "/join");
});

describe("/join", () => {
  it("joins directly from the room-code step and never asks for a name up front (2t1.9)", async () => {
    renderJoin();
    expect(await screen.findByText("Join a party")).toBeInTheDocument();
    expect(screen.getByLabelText("Four-letter party code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^join$/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Your player name")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Four-letter party code"), {
      target: { value: "abcd" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^join$/i }));
    await waitFor(() => expect(stubEngine.joinByCode).toHaveBeenCalledWith("abcd"));
    // No name step appears after submitting either — the name is asked in
    // the lobby, not during the join.
    expect(screen.queryByLabelText("Your player name")).not.toBeInTheDocument();
  });

  it("joins with the normalized code and does not set a name during the join (2t1.9)", async () => {
    renderJoin();
    const input = await screen.findByLabelText("Four-letter party code");
    fireEvent.change(input, { target: { value: " abcd " } });
    fireEvent.click(screen.getByRole("button", { name: /^join$/i }));
    await waitFor(() => expect(stubEngine.joinByCode).toHaveBeenCalledWith("abcd"));
    // The name is only asked once the player is in the lobby.
    expect(stubEngine.setDisplayName).not.toHaveBeenCalled();
  });

  it("shows the code with its lowercase phonetic spelling once it is complete", async () => {
    renderJoin();
    const input = await screen.findByLabelText("Four-letter party code");
    fireEvent.change(input, { target: { value: "xaby" } });
    expect(await screen.findByText(/\(xray alpha bravo yankee\)/)).toBeInTheDocument();
  });

  it("links Back to the homepage from the code step", async () => {
    renderJoin();
    await screen.findByLabelText("Four-letter party code");
    const back = screen.getByRole("link", { name: /^back$/i });
    expect(back.getAttribute("href")).toBe("/");
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

  it("keeps Join disabled until the code is four letters", async () => {
    renderJoin();
    const input = await screen.findByLabelText("Four-letter party code");
    const joinButton = screen.getByRole("button", { name: /^join$/i });
    expect(joinButton).toBeDisabled();
    fireEvent.change(input, { target: { value: "abc" } });
    expect(joinButton).toBeDisabled();
    fireEvent.change(input, { target: { value: "abcd" } });
    expect(joinButton).toBeEnabled();
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
    fireEvent.click(screen.getByRole("button", { name: /^join$/i }));
    await waitFor(() => expect(stubEngine.joinByCode).toHaveBeenCalledWith("zzzz"));
    expect(await screen.findByText(/zzzz does not exist/)).toBeInTheDocument();
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

  it("renders the name-editing page at /join?edit=name (2t1.9)", async () => {
    renderJoin("/join?edit=name");
    expect(await screen.findByRole("heading", { name: "Your name" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your player name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Four-letter party code")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  it("prefills the name page from the saved name (7.5)", async () => {
    setSavedPlayerName("Ada");
    renderJoin("/join?edit=name");
    const input = (await screen.findByLabelText("Your player name")) as HTMLInputElement;
    expect(input.value).toBe("Ada");
  });

  it("saves the edited name and returns to the join page (2t1.9)", async () => {
    renderJoin("/join?edit=name");
    const input = await screen.findByLabelText("Your player name");
    fireEvent.change(input, { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(stubEngine.setDisplayName).toHaveBeenCalledWith("Ada"));
    // Back on the join page (engine idle → the code form), edit mode off.
    expect(await screen.findByText("Join a party")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your player name")).not.toBeInTheDocument();
  });

  it("Back on the name page returns to the join page without saving (2t1.9)", async () => {
    renderJoin("/join?edit=name");
    await screen.findByLabelText("Your player name");
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(await screen.findByText("Join a party")).toBeInTheDocument();
    expect(stubEngine.setDisplayName).not.toHaveBeenCalled();
  });
});
