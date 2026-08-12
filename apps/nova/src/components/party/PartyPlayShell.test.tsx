import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PartyEngineState } from "../../lib/party/engine";
import { PartyPlayShell, type PartyPlayShellProps } from "./PartyPlayShell";

/**
 * In-game menu parity tests (7.29): Reload my game / Reload all (host) /
 * kick player (host) — classic's in-game menu items ported to the play
 * shell. Host-gating follows classic (reload all + kick are host-only).
 */

function makeState(overrides: Partial<PartyEngineState> = {}): PartyEngineState {
  return {
    phase: "playing",
    phaseDetail: null,
    reconnectAttempts: 0,
    role: "creator",
    code: "ABCD",
    memberId: "member-a",
    displayName: "Player A",
    game: { gameId: "game-1", title: "Rocket Rumble", mode: "state" },
    members: [
      {
        memberId: "member-a",
        displayName: "Player A",
        isSelf: true,
        connectionId: "conn-a",
        connected: true,
        isGreeter: true,
        transferState: "complete",
        transferProgress: 1,
        transferDetail: "You have the game",
        ready: true,
      },
      {
        memberId: "member-b",
        displayName: "Player B",
        isSelf: false,
        connectionId: "conn-b",
        connected: true,
        isGreeter: false,
        transferState: "complete",
        transferProgress: 1,
        transferDetail: "You have the game",
        ready: true,
      },
    ],
    pendingJoinRequests: [],
    greeterMemberId: "member-a",
    amGreeter: true,
    authorityMemberId: "member-a",
    inviteUrl: "http://localhost:5173/join#code=ABCD&secret=invite-secret",
    connectionState: "connected",
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
    ...overrides,
  };
}

function renderShell(
  state: PartyEngineState,
  handlers: Partial<Omit<PartyPlayShellProps, "state">> = {},
) {
  const props: PartyPlayShellProps = {
    state,
    onEndGame: handlers.onEndGame ?? vi.fn(),
    onLeave: handlers.onLeave ?? vi.fn(),
    onReloadMyGame: handlers.onReloadMyGame ?? vi.fn(),
    onReloadAllGames: handlers.onReloadAllGames ?? vi.fn(),
    onKickMember: handlers.onKickMember ?? vi.fn(),
  };
  return { props, ...render(<PartyPlayShell {...props} />) };
}

describe("PartyPlayShell in-game menu (7.29)", () => {
  it("shows Reload my game to everyone and Reload all to the host", async () => {
    const onReloadMyGame = vi.fn();
    const onReloadAllGames = vi.fn();
    await renderShell(makeState(), { onReloadMyGame, onReloadAllGames });
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /reload my game/i }));
    expect(onReloadMyGame).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /reload all/i }));
    expect(onReloadAllGames).toHaveBeenCalledTimes(1);
  });

  it("hides Reload all from joiners (host-only)", async () => {
    await renderShell(makeState({ role: "joiner" }));
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    expect(screen.getByRole("menuitem", { name: /reload my game/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /reload all/i })).not.toBeInTheDocument();
  });

  it("lets the host kick a member from the Players panel (7.29)", async () => {
    const onKickMember = vi.fn();
    await renderShell(makeState(), { onKickMember });
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /players/i }));
    const kick = screen.getByRole("button", { name: /kick/i });
    await userEvent.click(kick);
    expect(onKickMember).toHaveBeenCalledWith("member-b");
  });

  it("hides kick from joiners", async () => {
    await renderShell(makeState({ role: "joiner" }));
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /players/i }));
    expect(screen.queryByRole("button", { name: /kick/i })).not.toBeInTheDocument();
  });
});
