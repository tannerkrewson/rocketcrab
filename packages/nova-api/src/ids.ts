/**
 * Identifier and timestamp generation for protocol messages.
 *
 * The session generates its own protocol-level message IDs and monotonic
 * per-sender sequence numbers; the transport assigns its own delivery
 * stamps independently. Sequence numbers start at 1 and increase for
 * every ordered message this session sends.
 */

export function newMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function nowSentAt(): number {
  return Date.now();
}

/** Unique action id for one `action.dispatch` (deduplication, ADR-0006). */
export function newActionId(): string {
  return `action-${newMessageId()}`;
}

/** Unique input id for one `simulation.input` (deduplication, ADR-0006). */
export function newInputId(): string {
  return `input-${newMessageId()}`;
}
