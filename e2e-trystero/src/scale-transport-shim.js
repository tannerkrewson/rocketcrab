// Test-only strategy adapter. Force a small topology and local signaling while
// exercising the actual Nova transport and game-source coordinator unchanged.
// oxlint-disable-next-line no-restricted-imports
import { joinRoom as join, scale } from "@trystero-p2p/ws-relay";
// oxlint-disable-next-line no-restricted-imports
export { getRelaySockets, scale } from "@trystero-p2p/ws-relay";
export const defaultRelayUrls = [`ws://${location.host}/signal`];
export function joinRoom(config, roomId) {
  window.testRoom = join(
    { ...config, relayConfig: { urls: defaultRelayUrls }, use: [scale({ maxDirectPeers: 4 })] },
    roomId,
  );
  return window.testRoom;
}
