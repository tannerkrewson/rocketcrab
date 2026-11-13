// Test-only strategy adapter. Force a small topology and local signaling while
// exercising the actual Nova transport and game-source coordinator unchanged.
import {
  joinRoom as join,
  scale,
  getRelaySockets as sockets,
} from "../../node_modules/@trystero-p2p/ws-relay/dist/index.mjs";
export { scale };
const url = `ws://${location.host}/signal`;
let adapterUrl;
export function getRelaySockets() {
  return { [adapterUrl]: sockets()[url] };
}
export function joinRoom(config, roomId) {
  adapterUrl = config.relayConfig.urls[0];
  window.adapterPlugins = config.use?.map((plugin) => plugin.name);
  window.testRoom = join(
    { ...config, relayConfig: { urls: [url] }, use: [scale({ maxDirectPeers: 4 })] },
    roomId,
  );
  return window.testRoom;
}
