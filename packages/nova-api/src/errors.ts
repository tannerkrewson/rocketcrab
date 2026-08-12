/**
 * Nova API errors.
 *
 * Every failure the game-facing API produces is a {@link NovaError} with a
 * stable machine-readable `code`, so games can react to failures and the
 * runtime can surface them clearly (S1 acceptance: API calls fail clearly
 * before readiness; unknown methods or versions fail safely).
 */

/** Stable error codes of the Nova API. */
export const NOVA_ERROR_CODES = {
  /** `nova.defineGame` targets an API version this build cannot serve. */
  unsupported_api_version: "unsupported_api_version",
  /** A method that does not exist on this API version was invoked. */
  unknown_method: "unknown_method",
  /** `nova.defineGame` was called more than once. */
  already_registered: "already_registered",
  /** A call requires `nova.defineGame` to have run first. */
  not_registered: "not_registered",
  /** `nova.ready` was called more than once. */
  already_ready: "already_ready",
  /** A call is only available after the game starts (see `nova.onStart`). */
  not_started: "not_started",
  /** A lifecycle transition was attempted after the game already started. */
  already_started: "already_started",
  /** A call is not available after the game ended. */
  ended: "ended",
  /** Options or arguments failed structural validation. */
  invalid_options: "invalid_options",
  /** A payload is not JSON-serializable / structured-clone-compatible. */
  invalid_payload: "invalid_payload",
  /** A raw channel name is not known to this session. */
  unknown_channel: "unknown_channel",
  /** A raw channel name collides with a reserved protocol name. */
  reserved_channel: "reserved_channel",
  /** A targeted send referenced a player that is not connected. */
  not_connected: "not_connected",
  /** A raw send exceeded the per-second rate limit (A2). */
  rate_limited: "rate_limited",
  /** An inbound protocol message failed validation at the boundary. */
  invalid_message: "invalid_message",
  /** The host cannot perform the requested operation in this build. */
  unsupported: "unsupported",
  /** A dispatched action was based on an outdated state revision (S2). */
  stale_revision: "stale_revision",
  /** A dispatched action was not applied before its deadline (S2). */
  timed_out: "timed_out",
  /** The action type has no registered handler (S2). */
  unknown_action: "unknown_action",
  /** The action payload exceeded the size limit (S2). */
  payload_too_large: "payload_too_large",
  /** Applying the action produced an oversized canonical state (S2). */
  state_too_large: "state_too_large",
  /** An action handler produced a non-plain-data state (S2). */
  invalid_state: "invalid_state",
  /** No authority is active, so the action cannot be applied (S2; S3). */
  no_authority: "no_authority",
  /** The game ended before the action could be applied (S2). */
  game_ended: "game_ended",
  /** An action handler threw (S2). */
  handler_error: "handler_error",
  /** A player's view could not be computed (S2). */
  view_error: "view_error",
  /** The initial state could not be created (S2). */
  initial_state_error: "initial_state_error",
  /** The authority runtime did not answer in time (S2). */
  execution_timeout: "execution_timeout",
  /** The authority runtime failed while executing (S2). */
  execution_failed: "execution_failed",
  /**
   * The game did not register a `serializeState` handler, so Nova cannot
   * produce authoritative simulation snapshots (A1).
   */
  no_snapshot_handler: "no_snapshot_handler",
  /** The game's `serializeState` handler threw (A1). */
  snapshot_error: "snapshot_error",
  /** A replicated simulation snapshot failed its hash check (A1). */
  invalid_snapshot: "invalid_snapshot",
  /**
   * Media transport is not available in this build: tracks/streams cannot
   * cross the runtime frame boundary yet (A3 experimental surface; see
   * `docs/testing/media-bridging-findings.md`).
   */
  media_unsupported: "media_unsupported",
} as const;

export type NovaErrorCode = (typeof NOVA_ERROR_CODES)[keyof typeof NOVA_ERROR_CODES];

/** A Nova API failure with a stable `code` and a human-readable message. */
export class NovaError extends Error {
  readonly code: NovaErrorCode;

  constructor(code: NovaErrorCode, message: string) {
    super(message);
    this.name = "NovaError";
    this.code = code;
  }
}

/** Error message for calls gated on registration (S1 lifecycle). */
export function notRegisteredMessage(method: string): string {
  return `nova.${method}() must be called after nova.defineGame().`;
}

/** Error message for calls gated on game start (S1 lifecycle). */
export function notStartedMessage(method: string): string {
  return `nova.${method}() is only available after the game starts (see nova.onStart).`;
}

/** Error message for calls after the game ended (S1 lifecycle). */
export function endedMessage(method: string): string {
  return `nova.${method}() is not available after the game ended.`;
}
