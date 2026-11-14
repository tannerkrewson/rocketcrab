import { edgeSocketUrl } from "./edge-url";

/** Compute the room-scoped signaling URL without exposing the room ID to the relay. */
export async function signalUrl(
  edgeOrigin: string,
  appId: string,
  roomId: string,
): Promise<string> {
  const input = new TextEncoder().encode(appId + roomId);
  const digest = await crypto.subtle.digest("SHA-256", input);
  const roomKey = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return edgeSocketUrl(edgeOrigin, `/signal/${roomKey}`);
}
