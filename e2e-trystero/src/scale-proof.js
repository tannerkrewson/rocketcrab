// Raw Trystero proof, deliberately separate from Nova's transport.
import { joinRoom, scale } from "../../node_modules/@trystero-p2p/ws-relay/dist/index.mjs";

const errors = [];
const room = joinRoom(
  {
    appId: "nova-scale-proof",
    identity: "none",
    relayConfig: { urls: [`ws://${location.host}/signal`] },
    use: [scale({ maxDirectPeers: 4 })],
    maxReceiveBytes: 3 * 1024 * 1024,
  },
  new URL(location.href).searchParams.get("room"),
);
room.onError((error) => errors.push(`${error.code}: ${error.message}`));
const action = room.makeAction("source", { kind: "request" });
const source = new Uint8Array(2 * 1024 * 1024);
for (let i = 0; i < source.length; i++) source[i] = (i * 71 + (i >>> 8)) & 255;
action.onRequest(() => source);
let monitor;
let sawDirect = false;
window.proof = {
  watch: (target) => {
    sawDirect = room.getTopology().directPeerIds.includes(target);
    monitor = setInterval(() => {
      sawDirect ||= room.getTopology().directPeerIds.includes(target);
    }, 10);
  },
  stopWatch: () => {
    clearInterval(monitor);
    return sawDirect;
  },
  self: () => room.getSelf(),
  topology: () => room.getTopology(),
  errors: () => errors,
  request: async (target) => {
    const result = await action.request("source", { target, timeoutMs: 40000 });
    if (!(result instanceof Uint8Array) || result.length !== source.length)
      throw new Error("wrong type or length");
    for (let i = 0; i < source.length; i++)
      if (result[i] !== source[i]) throw new Error(`mismatch at ${i}`);
    return result.length;
  },
};
