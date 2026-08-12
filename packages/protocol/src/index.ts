/**
 * @rocketcrab/protocol
 *
 * Shared Zod schemas, protocol types, and versioning for all cross-context
 * and peer messages (F6). Consumed by the Nova shell (apps/nova), the runtime
 * frame (apps/runtime), and the core engines (packages/core). Dependency-light
 * by design: zod only, no React, pure data + zod (no transforms or custom
 * callbacks embedded in schemas).
 *
 * See `versioning.md` in this package for the backward-compatibility policy.
 */
export * from "./version";
export * from "./ids";
export * from "./limits";
export * from "./envelope";
export * from "./errors";
export * from "./messages/shared";
export * from "./messages/peer";
export * from "./messages/runtime";

export const packageName = "@rocketcrab/protocol";
