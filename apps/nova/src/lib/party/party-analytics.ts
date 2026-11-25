import { analyticsEnabled, track } from "../analytics";
import { findCatalogGame } from "../catalog";
import type { PartyEngineState } from "./engine-types";

export function observePartyAnalytics(engine: {
  onState: (handler: (state: PartyEngineState) => void) => () => void;
}): void {
  if (!analyticsEnabled) return;
  let previousPhase: PartyEngineState["phase"] = "idle";
  let round: { game: string; kind: "nova" | "external"; startedAt: number | null } | null = null;
  const finish = () => {
    const ended = round;
    round = null;
    if (ended?.startedAt == null) return;
    track("game_end", {
      game_id: findCatalogGame(ended.game)?.id ?? "custom",
      game_kind: ended.kind,
      play_seconds: Math.round((performance.now() - ended.startedAt) / 1000),
    });
  };

  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) finish();
  });

  engine.onState((state) => {
    const { phase, game } = state;
    if (phase !== previousPhase) {
      if (phase === "lobby" && previousPhase === "creating") track("party_create");
      if (phase === "lobby" && previousPhase === "joining") track("party_join");
      if (phase === "reconnecting" || phase === "error") {
        track("party_issue", {
          outcome: phase,
          error_code: state.setupFailureCode ?? "",
        });
      }
    }

    if (
      round !== null &&
      (round.game !== game?.gameId || (phase !== "playing" && phase !== "reconnecting"))
    ) {
      finish();
    }
    if (round === null && phase === "playing" && game !== null) {
      // Remember the round on followers too, so promotion during a reconnect doesn't count it again.
      round = {
        game: game.gameId,
        kind: game.kind,
        startedAt: state.amHost ? performance.now() : null,
      };
      if (state.amHost) {
        track("game_start", {
          game_id: findCatalogGame(game.gameId)?.id ?? "custom",
          game_kind: game.kind,
          party_size: state.members.filter((member) => member.connected || member.isSelf).length,
        });
      }
    }
    previousPhase = phase;
  });
}
