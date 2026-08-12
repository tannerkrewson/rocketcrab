import type { GameApiEvent, GameEndReason } from "@rocketcrab/protocol";
import type { NovaSessionEvent } from "@rocketcrab/nova-api";

/**
 * Map one host-side session event to the plain-data `game.apiEvent` payload
 * pushed into a game frame (U6 session router). Session events that are
 * host-side only (state committed, action acks, authority changes) return
 * null — the game never sees them.
 */
export function toApiEvent(event: NovaSessionEvent): GameApiEvent | null {
  switch (event.type) {
    case "playerJoined":
      return { kind: "playerJoined", player: event.player };
    case "playerLeft":
      return { kind: "playerLeft", player: event.player };
    case "connection":
      return { kind: "connection", status: event.status };
    case "start":
      return { kind: "start" };
    case "end":
      return { kind: "end", reason: event.reason as GameEndReason };
    case "state":
      return { kind: "state", state: event.state };
    case "rawMessage":
      return { kind: "rawMessage", channel: event.channel, message: event.message };
    case "simulationInput":
      return { kind: "simulationInput", input: event.input };
    case "simulationSnapshot":
      return { kind: "simulationSnapshot", snapshot: event.snapshot };
    case "simulationTick":
      return { kind: "simulationTick", tick: event.tick };
    case "simulationAuthorityChange":
      return { kind: "simulationAuthorityChange", term: event.term };
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
    case "stateCommitted":
    case "actionRejected":
    case "actionReceived":
    case "authorityChanged":
      return null;
  }
}
