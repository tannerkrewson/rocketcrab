import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PartyEngineState } from "../lib/party/engine";
import { resetPartyIdentityForTests } from "../lib/party/identity";
import { resetInviteImportForTests } from "../lib/party/invite-import";
import { clearPartyRecovery } from "../lib/party/party-recovery";
import { routeTree } from "../routeTree.gen";

/**
 * Short join URL tests (9fv.8): a four-letter code in the PATH — either
 * under /join (/join/cvvu) or at the root (rocketcrab.com/cvvu) — lands in
 * the join flow with the code prefilled. Only codes ride in the path, never
 * secrets (ADR-0004 / ADR-0011); a fragment invite on top of the path still
 * takes the direct-join path, and invalid params fall through to the 404
 * page.
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

function renderShortJoin(initialEntry: string) {
  cleanup();
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => <>{children}</>;
  return render(<RouterProvider router={router} />, { wrapper });
}

const VALID_SECRET = "A".repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  resetInviteImportForTests();
  resetPartyIdentityForTests();
  clearPartyRecovery();
  window.history.pushState({}, "", "/join");
});

describe("/join/:code (short join URL)", () => {
  it("prefills the code input from the path and joins on submit", async () => {
    renderShortJoin("/join/cvvu");
    const input = (await screen.findByLabelText("Four-letter party code")) as HTMLInputElement;
    expect(input.value).toBe("cvvu");
    fireEvent.click(screen.getByRole("button", { name: /^join$/i }));
    await waitFor(() => expect(stubEngine.joinByCode).toHaveBeenCalledWith("cvvu"));
  });

  it("normalizes an uppercase path code to lowercase", async () => {
    renderShortJoin("/join/CVVU");
    const input = (await screen.findByLabelText("Four-letter party code")) as HTMLInputElement;
    expect(input.value).toBe("cvvu");
  });

  it("falls through to the 404 page for a non-letter code", async () => {
    renderShortJoin("/join/ab1d");
    expect(await screen.findByText("Lost in space")).toBeInTheDocument();
    expect(stubEngine.joinByCode).not.toHaveBeenCalled();
  });

  it("falls through to the 404 page for a wrong-length path", async () => {
    renderShortJoin("/join/abc");
    expect(await screen.findByText("Lost in space")).toBeInTheDocument();
  });

  it("takes the direct-join path when a fragment secret sits on top of the path code", async () => {
    window.history.pushState({}, "", `/join/cvvu#secret=${VALID_SECRET}`);
    renderShortJoin("/join/cvvu");
    await waitFor(() =>
      expect(stubEngine.joinByInvite).toHaveBeenCalledWith({
        secret: VALID_SECRET,
        code: "cvvu",
      }),
    );
    // The path code is a fallback only — the fragment secret is the
    // direct-join capability (ADR-0011).
    expect(stubEngine.joinByCode).not.toHaveBeenCalled();
    await waitFor(() => expect(window.location.hash).toBe(""));
  });

  it("lets a fragment code win over the path code (/join/cvvu#code=ABCD&secret=…)", async () => {
    window.history.pushState({}, "", `/join/cvvu#code=ABCD&secret=${VALID_SECRET}`);
    renderShortJoin("/join/cvvu");
    await waitFor(() =>
      expect(stubEngine.joinByInvite).toHaveBeenCalledWith({
        secret: VALID_SECRET,
        code: "ABCD",
      }),
    );
  });
});

describe("/:code (root short join URL, rocketcrab.com/cvvu)", () => {
  it("prefills the code input from a bare four-letter path segment", async () => {
    renderShortJoin("/cvvu");
    const input = (await screen.findByLabelText("Four-letter party code")) as HTMLInputElement;
    expect(input.value).toBe("cvvu");
    expect(screen.queryByText("Lost in space")).not.toBeInTheDocument();
  });

  it("joins with the prefilled code on submit", async () => {
    renderShortJoin("/cvvu");
    await screen.findByLabelText("Four-letter party code");
    fireEvent.click(screen.getByRole("button", { name: /^join$/i }));
    await waitFor(() => expect(stubEngine.joinByCode).toHaveBeenCalledWith("cvvu"));
  });

  it("does not hijack real routes — /about still renders", async () => {
    renderShortJoin("/about");
    // The static /about route wins over the /:code catch-all: no join
    // form, no 404 — the real page renders.
    expect(screen.queryByLabelText("Four-letter party code")).not.toBeInTheDocument();
    expect(await screen.findByText("Coming soon")).toBeInTheDocument();
    expect(screen.queryByText("Lost in space")).not.toBeInTheDocument();
  });

  it("falls through to the 404 page for a non-code single segment", async () => {
    renderShortJoin("/not-a-code");
    expect(await screen.findByText("Lost in space")).toBeInTheDocument();
  });
});
