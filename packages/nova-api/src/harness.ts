/**
 * Test harness: the in-memory transport (U5) as a NovaTransportHarness, so
 * the contract suite and example tests run against the arena transport.
 * P1 runs the same contract suite against TrysteroTransport with its own
 * harness.
 */
import type { NovaTransport } from "@rocketcrab/core";
import { InMemoryTransportHub } from "@rocketcrab/testing";
import type { NovaTransportHarness } from "./contract-suite";

/** A deterministic in-memory harness (seeded hub, synchronous drain). */
export function createInMemoryHarness(): NovaTransportHarness {
  const hub = new InMemoryTransportHub({ seed: "nova-api-s1" });
  return {
    createTransport(identity: { memberId: string; displayName?: string }): NovaTransport {
      return hub.createTransport({
        memberId: identity.memberId,
        displayName: identity.displayName,
      });
    },
    drain(): void {
      hub.drain();
    },
  };
}
