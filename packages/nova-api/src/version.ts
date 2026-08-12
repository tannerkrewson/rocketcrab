/**
 * Nova API versioning.
 *
 * The game-facing Nova API (S1) has its own version, independent of the
 * internal protocol version (`PROTOCOL_VERSION` in @rocketcrab/protocol).
 * Games read `nova.version` and may declare the API version they target via
 * `nova.defineGame({ apiVersion })`; unknown versions fail with a clear
 * error rather than being guessed at (S1 acceptance: unknown versions fail
 * safely).
 */

/** Current game-facing API version understood by this build. */
export const NOVA_API_VERSION = 1;

/** Every API version this build can serve. */
export const SUPPORTED_API_VERSIONS: readonly number[] = [NOVA_API_VERSION];

/** The concrete type of the current API version. */
export type NovaApiVersion = typeof NOVA_API_VERSION;

/** True when `version` is an API version this build can serve. */
export function isSupportedApiVersion(version: unknown): version is number {
  return typeof version === "number" && SUPPORTED_API_VERSIONS.includes(version);
}
