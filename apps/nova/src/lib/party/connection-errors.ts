/**
 * User-facing setup/connection errors. The transport reports categorized
 * join failures; raw messages mention SDP, relays, or TURN internals and
 * are not actionable for a player. Keep the mapping small and specific:
 * unknown errors fall through to their original message for diagnostics.
 */
const CATEGORY_MESSAGES: Readonly<Record<string, string>> = {
  password_mismatch: "This invite doesn't match the party. Ask the host for a fresh invite link.",
  incompatible_version:
    "Incompatible Nova version. Everyone should update/reload Nova and rejoin the party.",
  relay_unreachable:
    "Couldn't reach the party's signaling relays. Check your internet connection and try again.",
  join_timeout: "Joining the party timed out. Check your connection and try again.",
  peer_connection_failed:
    "Couldn't establish a direct connection to the party. Check your network and try again; some networks block peer-to-peer connections.",
  peer_disconnected: "The connection closed while joining. Try again.",
  rejected: "The party rejected the connection. Ask the host for a fresh invite link.",
  cancelled: "Joining the party was cancelled.",
  not_connected: "The party connection is not active. Rejoin the party.",
  invalid_state: "The party is in an unexpected state. Reload and try again.",
  already_joined: "This page is already in a party. Leave it before joining another.",
};

/** Extract the transport's structured category without importing its class. */
function errorCategory(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("category" in error)) {
    return null;
  }
  const category = (error as { category: unknown }).category;
  return typeof category === "string" ? category : null;
}

/** Convert a connection/setup error into a clear, actionable message. */
export function connectionErrorMessage(error: unknown): string {
  const category = errorCategory(error);
  if (category !== null) {
    const mapped = CATEGORY_MESSAGES[category];
    if (mapped !== undefined) return mapped;
  }
  return error instanceof Error && error.message.trim() !== ""
    ? error.message
    : "Something went wrong.";
}
