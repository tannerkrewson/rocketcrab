/**
 * @rocketcrab/core
 *
 * Party, authority, state and simulation engines, plus the transport-neutral
 * Nova transport interface (ADR-0003) implemented by InMemoryTransport (U5,
 * @rocketcrab/testing) and TrysteroTransport (P1, dedicated adapter package),
 * and the shared game-repository contract (U2). The transport interface is
 * React-free and never exposes Trystero to generated games (engineering rule
 * 1). Fully populated by later issues.
 */
export * from "./repository";
export * from "./transport";

export const packageName = "@rocketcrab/core";
