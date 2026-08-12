/**
 * @rocketcrab/trystero-transport
 *
 * P1 — the real-party implementation of the transport-neutral NovaTransport
 * interface (ADR-0003) behind Trystero's Nostr strategy. This is the ONLY
 * package allowed to import Trystero (enforced by the root oxlint
 * `no-restricted-imports` rule); generated games never see it (engineering
 * rule 1).
 *
 * The adapter mirrors `InMemoryTransport` (U5, @rocketcrab/testing) and must
 * pass the same contract suite, so the game-facing Nova API behaves
 * identically in the local test arena and over real parties. See
 * `trystero-transport.ts` for the design decisions (relay pinning F10,
 * environment appId, identity handshake, join-error mapping F5, relay
 * diagnostics, TURN hook, retry/timeout policy).
 */
export * from "./app-id";
export * from "./errors";
export * from "./relays";
export * from "./wire";
export * from "./trystero-transport";
