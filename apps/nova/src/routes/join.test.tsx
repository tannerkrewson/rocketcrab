import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
 * phonetic spelling lives in the party shell header (7.22), not the join
 * form (rocketcrab-if2) — the invite-fragment import (ADR-0011) still
 * strips the secret from the URL, and `/join?edit=name` renders the
 * shared name-editing page (the same name step the lobby's pencil /
 * no-name prompt open).
 */

const IDLE_STATE: PartyEngineState = {
  phase: "idle",
  phaseDetail: null,
  joinStage: null,
  reconnectAttempts: 0,
  role: null,
  memberId: "member-a",
  displayName: "Player A",
  game: null,
  members: [],
  hostMemberId: null,
  amHost: false,
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
  runtimeLogs: [],
  lastError: null,
};

const { stubEngine, stubs } = vi.hoisted(() => {
  const handlers: Array<(state: PartyEngineState) => void> = [];
  const stubs = {
    joinCalled: false,
    failedJoin: false,
    // The in-flight join's promise resolver: tests hold the join pending
    // until they flip the failure flag, mirroring the real engine (which
    // only settles after the network round-trip fails).
    resolveJoin: null as null | (() => void),
    notify: () => {
      const state = stubEngine.getState();
      // Copy so a handler that unsubscribes (e.g. PartyExperience unmounting
      // when JoinFlow flips back to the form) never skips a sibling.
      for (const handler of handlers.slice()) {
        handler(state);
      }
    },
  };
  return {
    stubs,
    stubEngine: {
      getState: vi.fn((): PartyEngineState =>
        stubs.failedJoin ? ERROR_STATE : stubs.joinCalled ? JOINING_STATE : IDLE_STATE,
      ),
      // 5cl.3: the stub mirrors the real engine's emit-on-change: it calls
      // every subscriber at subscribe time and remembers the handlers so
      // tests can push a fresh snapshot (joining → error) and re-render
      // all subscribers (JoinFlow + the PartyExperience it renders).
      onState: vi.fn((handler: (state: PartyEngineState) => void) => {
        handlers.push(handler);
        handler(stubEngine.getState());
        return () => {
          const index = handlers.indexOf(handler);
          if (index >= 0) {
            handlers.splice(index, 1);
          }
        };
      }),
      isActive: vi.fn(() => false),
      setContainer: vi.fn(),
      setDisplayName: vi.fn(),
      selectGame: vi.fn(async () => undefined),
      retrySetup: vi.fn(),
      dismissError: vi.fn(),
      createParty: vi.fn(async () => undefined),
      joinByInvite: vi.fn(async () => {
        stubs.joinCalled = true;
        stubs.notify();
        await new Promise<void>((resolve) => {
          stubs.resolveJoin = resolve;
        });
      }),
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
  lastError: "This party may have ended. Ask a friend for an invite.",
};

/** 5cl.3: the engine reports the join in flight → the loading screen. */
const JOINING_STATE: PartyEngineState = {
  ...IDLE_STATE,
  phase: "joining",
  phaseDetail: "Joining party abcd…",
};

beforeEach(() => {
  vi.clearAllMocks();
  stubs.joinCalled = false;
  stubs.failedJoin = false;
  resetInviteImportForTests();
  resetPartyIdentityForTests();
  clearPartyRecovery();
  window.history.pushState({}, "", "/join");
});

describe("/join", () => {
  it("offers private invite instructions without code entry or a name prompt", async () => {
    renderJoin();
    expect(
      await screen.findByRole("heading", { name: "Join a private party" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a party" })).toHaveAttribute("href", "/party");
  });

  it("imports an invite fragment secret and strips it from the URL", async () => {
    window.history.pushState({}, "", `/join#code=ABCD&secret=${VALID_SECRET}`);
    renderJoin();
    await waitFor(() => expect(stubEngine.joinByInvite).toHaveBeenCalledTimes(1));
    expect(stubEngine.joinByInvite).toHaveBeenCalledWith({
      secret: VALID_SECRET,
    });
    await waitFor(() => expect(window.location.hash).toBe(""));
  });

  it("strips a fragment with no valid invite data", async () => {
    window.history.pushState({}, "", "/join#garbage");
    renderJoin();
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(stubEngine.joinByInvite).not.toHaveBeenCalled();
  });

  it("shows the loading screen for a URL-driven invite join (5cl.3)", async () => {
    window.history.pushState({}, "", `/join#code=ABCD&secret=${VALID_SECRET}`);
    renderJoin();
    // The fragment import fires joinByInvite → "joining" → loading screen.
    await waitFor(() => expect(stubEngine.joinByInvite).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Connecting to the private party/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Four-letter party code")).not.toBeInTheDocument();
  });

  it("surfaces a failed URL-driven join on the form (5cl.3)", async () => {
    window.history.pushState({}, "", `/join#code=ZZZZ&secret=${VALID_SECRET}`);
    renderJoin();
    await waitFor(() => expect(stubEngine.joinByInvite).toHaveBeenCalledTimes(1));
    // The engine failed the join: the flow returns to the form with the
    // error inline instead of silently sitting on a dead form.
    stubs.failedJoin = true;
    act(() => stubs.notify());
    stubs.resolveJoin?.();
    // The code form is back with the engine's error inline (the fragment's
    // code went to the engine, so the form shows the generic phrasing).
    expect(await screen.findByText(/This party may have ended/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("offers a one-tap rejoin from a saved recovery record (M1)", async () => {
    const secret = "D".repeat(43);
    savePartyRecovery({
      role: "joiner",
      secret,
      memberId: "member-a",
      displayName: "Player A",
      game: { gameId: "game-1", title: "Rocket Rumble", mode: "state" },
    });
    renderJoin();
    expect(await screen.findByTestId("party-resume-banner")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /rejoin party/i }));
    await waitFor(() => expect(stubEngine.joinByInvite).toHaveBeenCalledWith({ secret }));
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
    expect(await screen.findByText("Join a private party")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your player name")).not.toBeInTheDocument();
  });

  it("Back on the name page returns to the join page without saving (2t1.9)", async () => {
    renderJoin("/join?edit=name");
    await screen.findByLabelText("Your player name");
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(await screen.findByText("Join a private party")).toBeInTheDocument();
    expect(stubEngine.setDisplayName).not.toHaveBeenCalled();
  });
});
