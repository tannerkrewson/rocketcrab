import { describe, expect, it } from "vitest";
import type { NovaTransport } from "./nova-transport";
import type {
  TransportConnectionState,
  TransportJoinRequest,
  TransportMessage,
  TransportPeerInfo,
  TransportSendOptions,
} from "./transport-types";

/**
 * Contract smoke test for the transport-neutral interface: a minimal
 * implementation compiles and satisfies the shape both InMemoryTransport (U5)
 * and TrysteroTransport (P1) must provide.
 */
class MockTransport implements NovaTransport {
  readonly kind = "mock";
  readonly selfMemberId = "member-1";
  readonly selfConnectionId = "connection-1";
  connectionState: TransportConnectionState = "idle";
  readonly peers: readonly TransportPeerInfo[] = [];

  on(): () => void {
    return () => undefined;
  }
  async join(_request: TransportJoinRequest): Promise<void> {}
  async leave(): Promise<void> {}
  async reconnect(): Promise<void> {}
  async suspend(): Promise<void> {}
  async resume(): Promise<void> {}
  async send(_options: TransportSendOptions): Promise<void> {}
}

describe("NovaTransport contract", () => {
  it("is implementable by a minimal transport", () => {
    const transport: NovaTransport = new MockTransport();
    expect(transport.kind).toBe("mock");
    expect(transport.connectionState).toBe("idle");
  });

  it("exposes the peer-envelope-compatible event surface", () => {
    const transport: NovaTransport = new MockTransport();
    const seen: string[] = [];
    const unsubscribe = transport.on("message:received", (message: TransportMessage) => {
      seen.push(message.messageId);
    });
    expect(typeof unsubscribe).toBe("function");
    transport.on("peer:joined", (peer: TransportPeerInfo) => {
      expect(peer.memberId).toBeTruthy();
    });
    transport.on("connection:state", (state: TransportConnectionState) => {
      expect(state).toBeTruthy();
    });
    transport.on("peer:reconnected", (event) => {
      expect(event.newConnectionId).toBeTruthy();
    });
    transport.on("message:lost", () => undefined);
    transport.on("message:invalid", (_message, reason) => {
      expect(typeof reason).toBe("string");
    });
    transport.on("transfer:progress", (progress) => {
      expect(progress.fraction).toBeGreaterThanOrEqual(0);
    });
    expect(seen).toEqual([]);
  });
});
