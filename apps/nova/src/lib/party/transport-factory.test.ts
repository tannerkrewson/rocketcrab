import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configuredRelays, createTrysteroPartyTransportFactory } from "./transport-factory";

/**
 * Transport-factory tests (task rocketcrab-23s, P0): the real-party factory
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("configuredRelays", () => {
  it("defaults to no override", () => {
    expect(configuredRelays()).toEqual([]);
  });

  it("keeps valid ws/wss URLs, normalizes, dedupes, and ignores invalid entries", () => {
    vi.stubEnv(
      "VITE_TRYSTERO_RELAYS",
      " wss://nos.lol,https://evil.example,wss://nostr.mom,,wss://nos.lol,not a url, ws://localhost:7777 ",
    );
    expect(configuredRelays()).toEqual([
      "wss://nos.lol/",
      "wss://nostr.mom/",
      "ws://localhost:7777/",
    ]);
  });
});

describe("createTrysteroPartyTransportFactory", () => {
  it("constructs both transports without turnConfig when nothing is baked in", () => {
    const factory = createTrysteroPartyTransportFactory();
    factory.createPrivateTransport({ memberId: "m1", password: "pw", displayName: "A" });
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
    factory.createPrivateTransport({ memberId: "m1", password: "pw", displayName: "A" });
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
    factory.createPrivateTransport({ memberId: "m1", password: "pw" });
    factory.createPrivateTransport({ memberId: "m1b", password: "pw" });
    const [, second] = mocks.constructed as [Record<string, unknown>, Record<string, unknown>];
    expect(second.turnConfig).toBe(TURN_CONFIG);
  });

  it("applies an explicit relay override to both room transports", () => {
    const relays = ["wss://relay.example/"];
    const factory = createTrysteroPartyTransportFactory({ relays });
    factory.createPrivateTransport({ memberId: "m1", password: "pw" });
    factory.createPrivateTransport({ memberId: "m2", password: "pw" });
    for (const options of mocks.constructed as Array<Record<string, unknown>>) {
      expect(options.relays).toEqual(relays);
    }
  });

  it("threads an onJoinError observer to BOTH transports (5cl.1)", () => {
    const onJoinError = vi.fn();
    const factory = createTrysteroPartyTransportFactory({ onJoinError });
    factory.createPrivateTransport({ memberId: "m1", password: "pw", displayName: "A" });
    factory.createPrivateTransport({ memberId: "m2", displayName: "B", password: "pw" });

    const [rendezvous, privateRoom] = mocks.constructed as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(rendezvous.onJoinError).toBe(onJoinError);
    expect(privateRoom.onJoinError).toBe(onJoinError);
  });
});
