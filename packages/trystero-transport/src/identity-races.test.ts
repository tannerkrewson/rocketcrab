import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ joinRoom: vi.fn() }));
vi.mock("./signal-url", () => ({ signalUrl: async () => "relay" }));
vi.mock("@trystero-p2p/ws-relay", () => ({
  joinRoom: mocks.joinRoom,
  getRelaySockets: () => ({ relay: { readyState: 1 } }),
  defaultRelayUrls: ["relay"],
}));

import { TrysteroTransport } from "./trystero-transport";

it("waits for both validated identity and acknowledgement before announcing a peer", async () => {
  const listeners: Record<string, (...args: any[]) => void> = {};
  const peers: Record<string, { userId: string }> = {};
  const values: Record<string, unknown> = {};
  const metas: Record<string, unknown> = {};
  const subscribe = (name: string) => (fn: (...args: any[]) => void) => {
    listeners[name] = fn;
    return () => {
      delete listeners[name];
    };
  };
  let finishAck!: () => void;
  const ackSend = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishAck = resolve;
      }),
  );
  const dataSend = vi.fn(async () => {});
  const room = {
    getSelf: async () => ({ peerId: "self" }),
    getPeers: () => peers,
    leave: async () => {},
    onError: subscribe("error"),
    onPeerJoin: subscribe("join"),
    onPeerLeave: subscribe("leave"),
    makeAction: (name: string) => ({
      onMessage: subscribe(name),
      onReceiveProgress: subscribe(`${name}.progress`),
      onReceive: subscribe(`${name}.receive`),
      onRequest: subscribe(`${name}.request`),
      send: name === "nova.identity.ack" ? ackSend : dataSend,
    }),
    makeUserState: () => ({
      get: (user: string) => values[user],
      getMeta: (user: string) => metas[user],
      set: async () => {},
      onChange: subscribe("state"),
    }),
  };
  mocks.joinRoom.mockReturnValue(room);
  const transport = new TrysteroTransport({ memberId: "local" });
  transport.handleRequest("rpc", async () => "response");
  const joined = vi.fn();
  transport.on("peer:joined", joined);
  const received = vi.fn();
  transport.on("message:received", received);
  await transport.join({ room: "ROOM", sessionId: "session" });
  peers.remote = { userId: "user" };
  values.user = {
    v: 1,
    transportVersion: 5,
    memberId: "remote-member",
    connectionId: "remote-connection",
  };
  // An acknowledgement alone cannot admit a peer, and metadata from an old
  // connection with the same user id must not bind to this connection.
  listeners["nova.identity.ack"]!("self", { peerId: "remote" });
  metas.user = { online: true, peerId: "stale-peer", userId: "user" };
  listeners.join!({ peerId: "remote", userId: "user" });
  expect(joined).not.toHaveBeenCalled();
  expect(ackSend).not.toHaveBeenCalled();
  metas.user = { online: true, peerId: "remote", userId: "user" };
  listeners.state!(values.user, { peerId: "remote", userId: "user", self: false, removed: false });
  expect(ackSend).toHaveBeenCalledWith("remote-connection", { target: "remote" });
  expect(joined).not.toHaveBeenCalled();
  await transport.send({ channel: "game", payload: "before-admission" });
  expect(dataSend).not.toHaveBeenCalled();
  // The remote may have received our ack even though its send promise is
  // still pending. Its first application message must be queued, not lost.
  listeners.nova!("hello", {
    peerId: "remote",
    userId: "user",
    roles: [],
    metadata: { v: 1, messageId: "m", sentAt: 1, channel: "game", sessionId: "session" },
  });
  expect(received).not.toHaveBeenCalled();
  const rpcContext = {
    peerId: "remote",
    userId: "user",
    roles: [],
    kind: "request",
    byteLength: 5,
    signal: new AbortController().signal,
  };
  expect(listeners["nova.rpc:rpc.receive"]!(rpcContext)).toBe(true);
  const request = listeners["nova.rpc:rpc.request"]!(
    "request",
    rpcContext,
  ) as unknown as Promise<unknown>;
  finishAck();
  await Promise.resolve();
  expect(joined).toHaveBeenCalledOnce();
  await transport.send({ channel: "game", payload: "after-admission" });
  expect(dataSend).toHaveBeenCalledWith(
    "after-admission",
    expect.objectContaining({ target: "remote" }),
  );
  expect(received).toHaveBeenCalledOnce();
  await expect(request).resolves.toBe("response");
  expect(received.mock.calls[0]?.[0]).toMatchObject({
    payload: "hello",
    senderMemberId: "remote-member",
  });
  expect(joined.mock.calls[0]?.[0]).toMatchObject({
    memberId: "remote-member",
    connectionId: "remote-connection",
  });
  listeners.state!(values.user, { peerId: "remote", userId: "user", self: false, removed: false });
  expect(joined).toHaveBeenCalledOnce();
  values.user = {
    v: 1,
    transportVersion: 5,
    memberId: "impostor",
    connectionId: "remote-connection",
  };
  listeners.state!(values.user, { peerId: "remote", userId: "user", self: false, removed: false });
  expect(transport.peers).toHaveLength(0);
  // A changed identity is quarantined for this connection.
  values.user = {
    v: 1,
    transportVersion: 5,
    memberId: "remote-member",
    connectionId: "remote-connection",
  };
  listeners.state!(values.user, { peerId: "remote", userId: "user", self: false, removed: false });
  expect(joined).toHaveBeenCalledOnce();
  listeners.leave!({ peerId: "remote", userId: "user" });
  delete peers.remote;
  peers.other = { userId: "other-user" };
  values["other-user"] = {
    v: 1,
    transportVersion: 5,
    memberId: "other",
    connectionId: "other-connection",
  };
  metas["other-user"] = { online: true, peerId: "other", userId: "other-user" };
  listeners.join!({ peerId: "other", userId: "other-user" });
  listeners["nova.identity.ack"]!("self", { peerId: "other" });
  for (let i = 0; i < 33; i++) {
    listeners.nova!("hello", {
      peerId: "other",
      userId: "other-user",
      roles: [],
      metadata: { v: 1, messageId: String(i), sentAt: 1, channel: "game", sessionId: "session" },
    });
  }
  finishAck();
  await Promise.resolve();
  expect(joined).toHaveBeenCalledOnce();
  expect(received).toHaveBeenCalledOnce();
  await transport.leave();
});
