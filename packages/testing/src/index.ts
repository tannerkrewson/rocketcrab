/**
 * @rocketcrab/testing
 *
 * In-memory transport and reusable fixtures for the local test arena (U5/U6).
 * The in-memory transport implements the transport-neutral NovaTransport
 * interface from @rocketcrab/core (ADR-0003) with deterministic seeded
 * simulation (latency, jitter, loss, duplication, reordering, background
 * suspension, chunked transfers with progress, binary payloads) — no WebRTC,
 * no Trystero, so the arena runs several players on one page.
 */
export * from "./transport";

export const packageName = "@rocketcrab/testing";
