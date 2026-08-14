import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTrysteroPartyTransportFactory } from "./transport-factory";

/**
 * Transport-factory tests (beads rocketcrab-23s, P0): the real-party factory
 * closes over minted TURN credentials (the sync factory methods pass them to
 * BOTH transports). `@rocketcrab/trystero-transport` is mocked so the tests
 * can assert exactly what options each constructed transport receives
 * without building real Trystero rooms.
 */

const mocks = vi.hoisted(() => ({
  constructed: [] as unknown[],
  TrysteroTransport: vi.fn(function (this: unknown, options: unknown) {
    (this as { options: unknown }).options = options;
    mocks.constructed.push(options);
  }),
}));

vi.mock("@rocketcrab/trystero-transport", () => ({
  TrysteroTransport: mocks.TrysteroTransport,
}));

const TURN_CONFIG = [
  {
    urls: [
      "turn:turn.cloudflare.com:3478?transport=udp",
      "turns:turn.cloudflare.com:5349|443?transport=tcp",
    ],
    username: "u1",
    credential: "c1",
  },
];

beforeEach(() => {
  mocks.constructed.length = 0;
});

describe("createTrysteroPartyTransportFactory", () => {
  it("constructs both transports without turnConfig when nothing is baked in", () => {
    const factory = createTrysteroPartyTransportFactory();
    factory.createRendezvousTransport({ memberId: "m1", displayName: "A" });
    factory.createPrivateTransport({ memberId: "m2", displayName: "B", password: "pw" });

    expect(mocks.constructed).toHaveLength(2);
    const [rendezvous, privateRoom] = mocks.constructed as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(rendezvous).toMatchObject({ memberId: "m1", displayName: "A" });
    expect(rendezvous).not.toHaveProperty("turnConfig");
    expect(privateRoom).toMatchObject({
      memberId: "m2",
      displayName: "B",
      password: "pw",
    });
    expect(privateRoom).not.toHaveProperty("turnConfig");
  });

  it("closes over minted turnConfig for BOTH transports (rendezvous + private)", () => {
    const factory = createTrysteroPartyTransportFactory({ turnConfig: TURN_CONFIG });
    factory.createRendezvousTransport({ memberId: "m1", displayName: "A" });
    factory.createPrivateTransport({ memberId: "m2", displayName: "B", password: "pw" });

    expect(mocks.constructed).toHaveLength(2);
    const [rendezvous, privateRoom] = mocks.constructed as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(rendezvous).toMatchObject({ turnConfig: TURN_CONFIG });
    expect(privateRoom).toMatchObject({ turnConfig: TURN_CONFIG, password: "pw" });
  });

  it("passes the same closed-over turnConfig array to every transport created", () => {
    const factory = createTrysteroPartyTransportFactory({ turnConfig: TURN_CONFIG });
    factory.createRendezvousTransport({ memberId: "m1" });
    factory.createRendezvousTransport({ memberId: "m1b" });
    const [, second] = mocks.constructed as [Record<string, unknown>, Record<string, unknown>];
    expect(second.turnConfig).toBe(TURN_CONFIG);
  });
});
