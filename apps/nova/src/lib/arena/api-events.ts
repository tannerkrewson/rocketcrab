import type { GameApiEvent, GameEndReason } from "@rocketcrab/protocol";
import type { NovaSessionEvent } from "@rocketcrab/nova-api";

/** Return the game-facing API event, or null for host-only session events. */
export function toApiEvent(event: NovaSessionEvent): GameApiEvent | null {
  switch (event.type) {
    case "playerJoined":
      return { kind: "playerJoined", player: event.player };
    case "playerLeft":
      return { kind: "playerLeft", player: event.player };
    case "connection":
      return { kind: "connection", status: event.status };
    case "leader":
      return { kind: "leader", leaderId: event.leaderId };
    case "start":
      return { kind: "start" };
    case "end":
      return { kind: "end", reason: event.reason as GameEndReason };
    case "state":
      return { kind: "state", state: event.state };
    case "error":
      return { kind: "error", code: event.error.code, message: event.error.message };
    case "actionAck":
      return {
        kind: "actionAck",
        actionId: event.ack.actionId,
        status: event.ack.status,
        ...(event.ack.revision !== undefined ? { revision: event.ack.revision } : {}),
        ...(event.ack.errorCode !== undefined ? { errorCode: event.ack.errorCode } : {}),
        ...(event.ack.errorMessage !== undefined ? { errorMessage: event.ack.errorMessage } : {}),
      };
    case "bandwidthWarning":
    case "stateCommitted":
    case "actionRejected":
    case "actionReceived":
    case "authorityChanged":
    case "historyIncomplete":
    case "snapshotFallback":
    case "ready":
      return null;
  }
}
