// Experimental name-slot projection, not Nova's transport admission protocol.
// Uses the production transport's identity mode ("none"), scale plugin and room-scoped
// signal URL (packages/trystero-transport) against the local edge relay on 18787.
// Omits the production join's maxReceiveBytes, turnConfig and rtcConfig.
import { joinRoom, scale } from "../../node_modules/@trystero-p2p/ws-relay/dist/index.mjs";
import { signalUrl } from "../../packages/trystero-transport/src/signal-url.ts";

const appId = "nova-presence-proof";
const roomId = new URL(location.href).searchParams.get("room");
const relayUrl = await signalUrl("http://127.0.0.1:18787", appId, roomId);
const room = joinRoom(
  {
    appId,
    identity: "none",
    use: [scale({ maxDirectPeers: 9 })],
    relayConfig: { urls: [relayUrl] },
  },
  roomId,
);
const names = room.makeUserState("proof.name", null, {
  validate: (value) => typeof value === "string" && value.length > 0 && value.length <= 32,
});
const admitted = new Map();
const seen = [];
const apply = (peerId, userId) => {
  const meta = names.getMeta(userId);
  const value = names.get(userId);
  if (
    admitted.get(peerId) === userId &&
    room.getPeers()[peerId]?.userId === userId &&
    meta?.online &&
    meta.peerId === peerId &&
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 32
  )
    seen.push({ peerId, userId, value });
};
names.onChange((_value, context) => {
  if (!context.self && !context.removed) apply(context.peerId, context.userId);
});
room.onPeerLeave(({ peerId }) => admitted.delete(peerId));
window.proof = {
  self: () => room.getSelf(),
  peers: () => room.getPeers(),
  admit: (peerId) => {
    const userId = room.getPeers()[peerId]?.userId;
    if (!userId) throw new Error("peer not connected");
    admitted.set(peerId, userId);
    apply(peerId, userId);
  },
  reject: (peerId) => admitted.delete(peerId),
  events: () => seen,
  reset: () => {
    seen.length = 0;
  },
  set: (value) => names.set(value),
  burst: async (values) => {
    await Promise.all(values.map((value) => names.set(value)));
  },
  get: (userId) => names.get(userId),
  leave: () => room.leave(),
};
