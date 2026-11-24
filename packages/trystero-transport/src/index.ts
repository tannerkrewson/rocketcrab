/**
 * @rocketcrab/trystero-transport
 *
 * The real-party implementation of the transport-neutral NovaTransport
 * interface behind Trystero's WebSocket relay strategy. This is the ONLY
 * package allowed to import Trystero (enforced by the root oxlint
 * `no-restricted-imports` rule); generated games never see it.
 *
 * The adapter mirrors `InMemoryTransport` (@rocketcrab/testing) and must
 * pass the same contract suite, so the game-facing Nova API behaves
 * identically in the local test arena and over real parties. See
 * `trystero-transport.ts` for the design decisions (room-scoped signaling,
 * environment appId, identity handshake, join-error mapping, relay
 * diagnostics, TURN hook, retry/timeout policy).
 */
export * from "./app-id";
export * from "./errors";
export * from "./wire";
export * from "./tunnel-crypto";
export * from "./fallback-peer-connection";
export * from "./trystero-transport";
