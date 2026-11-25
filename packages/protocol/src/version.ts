import { z } from "zod";

/**
 * Protocol versioning for all rocketcrab nova cross-context and peer
 * messages.
 *
 * The protocol version is a single integer carried in the `version` field of
 * every envelope. Unknown versions are rejected with a useful error rather
 * than guessed at. Within a version, only additive changes are allowed: an
 * optional field, or a new message type that old receivers reject loudly.
 * New enum values, removals, renames and newly required fields need a bump;
 * keep an old version in SUPPORTED_PROTOCOL_VERSIONS only while it still parses.
 */

/** Current protocol version understood by this build of the package. */
export const PROTOCOL_VERSION = 1;

/** Every protocol version this build can parse. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [PROTOCOL_VERSION];

/** The concrete type of the current protocol version. */
export type ProtocolVersion = typeof PROTOCOL_VERSION;

const versionErrorMessage = `Unsupported protocol version. Supported versions: [${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}].`;

/**
 * Zod schema for the `version` envelope field. Fails with a useful message
 * when the value is not the current protocol version.
 */
export const protocolVersionSchema = z.literal(PROTOCOL_VERSION, {
  error: versionErrorMessage,
});

/** True when `version` is a protocol version this build can parse. */
export function isSupportedProtocolVersion(version: unknown): version is ProtocolVersion {
  return typeof version === "number" && SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}
