/**
 * Real-party transport factory (P4; ADR-0003/0004/0011).
 *
 * The party layer (P2) is transport-neutral: it drives {@link NovaTransport}
 * through a {@link PartyTransportFactory}. For real parties both transports
 * are {@link TrysteroTransport} instances — the rendezvous room carries no
 * password, the private party room carries the derived session password so
 * room admission stays at the transport level (F8). The appId defaults to
 * the environment-specific `rocketcrab-nova-dev` / `-prod` (never colliding
 * between dev and prod rooms; `app-id.ts`).
 */
import type { PartyTransportFactory } from "@rocketcrab/party";
import { TrysteroTransport } from "@rocketcrab/trystero-transport";

/** The transport factory real parties run over (dev/prod appId by env). */
export function createTrysteroPartyTransportFactory(): PartyTransportFactory {
  return {
    createRendezvousTransport(identity) {
      return new TrysteroTransport({
        memberId: identity.memberId,
        displayName: identity.displayName,
      });
    },
    createPrivateTransport(identity) {
      return new TrysteroTransport({
        memberId: identity.memberId,
        displayName: identity.displayName,
        password: identity.password,
      });
    },
  };
}
