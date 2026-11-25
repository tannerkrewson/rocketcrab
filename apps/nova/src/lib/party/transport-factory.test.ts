import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrysteroPartyTransportFactory, forceTunnelForTests } from "./transport-factory";

import { reportConnection } from "../connection-analytics";

vi.mock("../connection-analytics", () => ({ reportConnection: vi.fn() }));

/** Assert factory options through a transport mock without opening real Trystero rooms. */

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

const SECRET = "A".repeat(43);

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
  delete (globalThis as { __NOVA_TEST_FORCE_TUNNEL__?: unknown }).__NOVA_TEST_FORCE_TUNNEL__;
});

describe("createTrysteroPartyTransportFactory", () => {
  it("constructs both transports without turnConfig when nothing is baked in", () => {
    const factory = createTrysteroPartyTransportFactory();
    factory.createPrivateTransport({
      memberId: "m1",
      password: "pw",
      displayName: "A",
      secret: SECRET,
    });
    factory.createPrivateTransport({
      memberId: "m2",
      displayName: "B",
      password: "pw",
      secret: SECRET,
    });

    expect(mocks.constructed).toHaveLength(2);
    const [rendezvous, privateRoom] = mocks.constructed as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(rendezvous).toMatchObject({ displayName: "A" });
    expect(rendezvous).not.toHaveProperty("turnConfig");
    expect(privateRoom).toMatchObject({
      displayName: "B",
      password: "pw",
    });
    expect(privateRoom).not.toHaveProperty("turnConfig");
  });

  it("closes over minted turnConfig for BOTH transports (rendezvous + private)", () => {
    const factory = createTrysteroPartyTransportFactory({ turnConfig: TURN_CONFIG });
    factory.createPrivateTransport({
      memberId: "m1",
      password: "pw",
      displayName: "A",
      secret: SECRET,
    });
    factory.createPrivateTransport({
      memberId: "m2",
      displayName: "B",
      password: "pw",
      secret: SECRET,
    });

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
    factory.createPrivateTransport({ memberId: "m1", password: "pw", secret: SECRET });
    factory.createPrivateTransport({ memberId: "m1b", password: "pw", secret: SECRET });
    const [, second] = mocks.constructed as [Record<string, unknown>, Record<string, unknown>];
    expect(second.turnConfig).toBe(TURN_CONFIG);
  });

  it("threads an onJoinError observer to BOTH transports", () => {
    const onJoinError = vi.fn();
    const factory = createTrysteroPartyTransportFactory({ onJoinError });
    factory.createPrivateTransport({
      memberId: "m1",
      password: "pw",
      displayName: "A",
      secret: SECRET,
    });
    factory.createPrivateTransport({
      memberId: "m2",
      displayName: "B",
      password: "pw",
      secret: SECRET,
    });

    const [rendezvous, privateRoom] = mocks.constructed as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(rendezvous.onJoinError).toBe(onJoinError);
    expect(privateRoom.onJoinError).toBe(onJoinError);
  });
});

describe("tunnel fallback wiring", () => {
  it("gives each transport the party secret for tunnel key derivation", () => {
    const factory = createTrysteroPartyTransportFactory();
    factory.createPrivateTransport({ memberId: "m1", password: "pw", secret: SECRET });
    expect(mocks.constructed[0]).toMatchObject({ partySecret: SECRET });
  });

  it("passes the tunnel start and failure hooks to each transport", () => {
    const onTunnel = vi.fn();
    const onTunnelFailure = vi.fn();
    const factory = createTrysteroPartyTransportFactory({ onTunnel, onTunnelFailure });
    factory.createPrivateTransport({ memberId: "m1", password: "pw", secret: SECRET });
    expect(mocks.constructed[0]).toMatchObject({ onTunnel, onTunnelFailure });
  });

  it("does not force the tunnel by default", () => {
    const factory = createTrysteroPartyTransportFactory();
    factory.createPrivateTransport({ memberId: "m1", password: "pw", secret: SECRET });
    expect(mocks.constructed[0]).toMatchObject({ forceRelayOnlyNoServers: false });
  });

  it("forces the tunnel in test mode only when the page flag is set", () => {
    vi.stubEnv("MODE", "test");
    vi.stubEnv("DEV", false);
    const factory = createTrysteroPartyTransportFactory();
    (globalThis as { __NOVA_TEST_FORCE_TUNNEL__?: unknown }).__NOVA_TEST_FORCE_TUNNEL__ = true;
    expect(forceTunnelForTests()).toBe(true);
    factory.createPrivateTransport({ memberId: "m1", password: "pw", secret: SECRET });
    expect(mocks.constructed[0]).toMatchObject({ forceRelayOnlyNoServers: true });
  });

  it("ignores the force flag in production builds", () => {
    vi.stubEnv("MODE", "production");
    vi.stubEnv("DEV", false);
    (globalThis as { __NOVA_TEST_FORCE_TUNNEL__?: unknown }).__NOVA_TEST_FORCE_TUNNEL__ = true;
    expect(forceTunnelForTests()).toBe(false);
    const factory = createTrysteroPartyTransportFactory();
    factory.createPrivateTransport({ memberId: "m1", password: "pw", secret: SECRET });
    expect(mocks.constructed[0]).toMatchObject({ forceRelayOnlyNoServers: false });
  });

  it("ignores a non-true flag value even in test mode", () => {
    vi.stubEnv("MODE", "test");
    (globalThis as { __NOVA_TEST_FORCE_TUNNEL__?: unknown }).__NOVA_TEST_FORCE_TUNNEL__ = "true";
    expect(forceTunnelForTests()).toBe(false);
  });
});

it("reports the outcome from each transport without including room or peer metadata", () => {
  const factory = createTrysteroPartyTransportFactory();
  for (const memberId of ["m1", "m2"]) {
    factory.createPrivateTransport({ memberId, password: "pw", secret: SECRET });
  }
  expect(mocks.constructed).toHaveLength(2);
  for (const options of mocks.constructed) {
    (options as { onOutcome: (info: { outcome: string; msToConnect: number }) => void }).onOutcome({
      outcome: "tunnel",
      msToConnect: 812,
    });
  }
  expect(reportConnection).toHaveBeenCalledTimes(2);
  for (const count of [1, 2]) {
    expect(reportConnection).toHaveBeenNthCalledWith(count, {
      outcome: "tunnel",
      error_code: "",
      ms_to_connect: 812,
      signaling_ok: true,
    });
  }
});
