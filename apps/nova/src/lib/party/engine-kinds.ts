import type { MemberId } from "@rocketcrab/protocol";
import type { PartyEngineContext } from "./engine-context";
import type { PartyEngineServices } from "./engine-services";
import type { PartyMemberView } from "./engine-types";

/** One member's progress toward playing the selected game. */
export type MemberGameStatus = Pick<
  PartyMemberView,
  "transferState" | "transferProgress" | "transferDetail" | "ready"
>;

/**
 * What differs between Nova and external games for readiness and reload.
 * The snapshot and start gates ask the current game's adapter instead of
 * checking which kind of game is selected.
 */
export interface GameKindAdapter {
  memberStatus(memberId: MemberId): MemberGameStatus;
  /** Every member has the game (the start gate). */
  allSourcesVerified(members: readonly PartyMemberView[]): boolean;
  /** Restart this player's game frame. */
  reload(): void;
}

/** Picks the adapter for the selected game; Nova's when none is selected. */
export class PartyGameKinds {
  private readonly nova: GameKindAdapter;
  private readonly external: GameKindAdapter;

  constructor(
    private readonly state: PartyEngineContext,
    services: () => Pick<PartyEngineServices, "source" | "runtime">,
  ) {
    this.nova = {
      memberStatus(memberId) {
        const ready = state.session?.readyOf(memberId) ?? false;
        const isSelf = memberId === state.identity.memberId;
        if (isSelf && services().source.isSourceVerified(memberId)) {
          return {
            transferState: "complete",
            transferProgress: 1,
            transferDetail: "You have the game",
            ready,
          };
        }
        const transfer = state.transfers.get(memberId);
        if (transfer !== undefined) {
          return {
            transferState: transfer.state,
            transferProgress: transfer.fraction,
            transferDetail: transfer.detail,
            ready,
          };
        }
        return { transferState: "waiting", transferProgress: null, transferDetail: null, ready };
      },
      allSourcesVerified(members) {
        return (
          members.length > 0 &&
          members.every((member) => services().source.isSourceVerified(member.memberId))
        );
      },
      reload() {
        services().runtime.reloadRuntimeFrame();
      },
    };
    // The room announcement is all an external game needs; its own server does the rest.
    this.external = {
      memberStatus: () => ({
        transferState: "complete",
        transferProgress: 1,
        transferDetail: "Game ready",
        ready: true,
      }),
      allSourcesVerified: () => true,
      reload() {
        if (state.game?.kind === "external") {
          state.game = { ...state.game, frameEpoch: state.game.frameEpoch + 1 };
        }
      },
    };
  }

  current(): GameKindAdapter {
    return this.state.game?.kind === "external" ? this.external : this.nova;
  }
}
