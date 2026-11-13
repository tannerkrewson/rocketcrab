// Test-only entry point: real party engine, real runtime and real edge signaling.
import { PartyEngine } from "../apps/nova/src/lib/party/engine";
import game from "./state-game.html?raw";
import { parseInviteFragment } from "@rocketcrab/party";

const identity = new URL(location.href).searchParams.get("player") ?? "0";
const engine = new PartyEngine({
  identity: { memberId: `load-player-${identity}`, displayName: `Player ${identity}` },
  runtimeOrigin: "http://localhost:5274",
  peerConnectTimeoutMs: 120_000,
});
engine.setContainer(document.querySelector<HTMLElement>("#runtime"));
const observedErrors = new Set<string>();
engine.onState((state) => {
  for (const notice of state.notices)
    if (notice.level === "error") observedErrors.add(notice.message);
  if (state.lastError) observedErrors.add(state.lastError);
});

Object.assign(window, {
  loadHarness: {
    create: (withGame = true) =>
      engine.createParty(
        withGame
          ? { gameId: "load-game", title: "Load counter", mode: "state", source: game }
          : undefined,
      ),
    selectGame: () =>
      engine.selectGame({
        gameId: "load-game",
        title: "Load counter",
        mode: "state",
        source: game,
      }),
    join: (secret: string) => engine.joinByInvite({ secret }),
    state: () => engine.getState(),
    errors: () => [...observedErrors],
    inviteSecret: () =>
      parseInviteFragment(new URL(engine.getState().inviteUrl ?? "", location.href).hash)?.secret,
    start: () => engine.startGame(),
    leave: () => engine.leaveParty(),
  },
});
