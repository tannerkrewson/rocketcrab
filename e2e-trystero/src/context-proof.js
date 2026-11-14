import { joinRoom, scale } from "../../node_modules/@trystero-p2p/ws-relay/dist/index.mjs";
let room, slot;
window.rawProof = {
  async start(roomId, appId, badIdentity = false) {
    room = joinRoom(
      {
        appId,
        identity: "none",
        relayConfig: { urls: [`ws://${location.host}/signal`] },
        use: [scale({ maxDirectPeers: 4 })],
      },
      roomId,
    );
    slot = room.makeState("proof.creator", null, {
      validate: (v, { prev }) => typeof v === "string" && (prev === null || prev === v),
    });
    if (badIdentity) await room.makeUserState("nova.identity", null).set({ v: 123 });
    return await room.getSelf();
  },
  set: (v) => slot.set(v),
  get: () => slot.get(),
  peers: () => Object.keys(room.getPeers()),
  leave: () => room.leave(),
};
