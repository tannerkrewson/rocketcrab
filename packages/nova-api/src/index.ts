/**
 * @rocketcrab/nova-api
 *
 * The game-facing Nova API (S1): the small, versioned surface AI-generated
 * games use in every mode, plus the transport-neutral session engine that
 * makes it work.
 *
 * - `createNovaClient` builds the exact object games receive as `window.nova`
 *   (the in-frame bridge and the arena construct the same client over
 *   different backends).
 * - `NovaSession` is the host-side engine that drives a client over the
 *   transport-neutral `NovaTransport` (InMemoryTransport in the test arena,
 *   TrysteroTransport for real parties in P1) — the same game code works in
 *   test and party transports.
 * - All types are documented from source (see `docs/api/`); the API has no
 *   Trystero terminology, no hosting or deployment concepts, no authority
 *   roles, and only structured-clone-compatible data crosses boundaries.
 */
export * from "./version";
export * from "./errors";
export * from "./types";
export * from "./constants";
export * from "./validation";
export * from "./client";
export * from "./media";
export * from "./session";
export * from "./state-engine";
export * from "./state-executor";
export * from "./examples";

export const packageName = "@rocketcrab/nova-api";
