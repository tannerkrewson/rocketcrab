import { describe, expect, it } from "vitest";
import type {
  TransportConnectionState,
  TransportMessage,
  TransportPeerInfo,
  TransportReconnectEvent,
} from "@rocketcrab/core";
import { InMemoryTransportHub } from "./hub";
import type { InMemoryTransport } from "./in-memory-transport";

const SESSION = "session-1";

function collect(
  transport: InMemoryTransport,
  event: "peer:joined" | "peer:left",
): TransportPeerInfo[] {
  const events: TransportPeerInfo[] = [];
  transport.on(event, (peer) => {
    events.push(peer);
  });
  return events;
}

function collectMessages(transport: InMemoryTransport): TransportMessage[] {
  const messages: TransportMessage[] = [];
  transport.on("message:received", (message) => {
    messages.push(message);
  });
  return messages;
}

async function joinRoom(transport: InMemoryTransport, room = "arena"): Promise<void> {
  await transport.join({ room, sessionId: SESSION });
}

describe("InMemoryTransport lifecycle", () => {
  it("joins a room and observes peers on both sides", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({ memberId: "member-a", displayName: "Ada" });
    const b = hub.createTransport({ memberId: "member-b" });
    const aJoined = collect(a, "peer:joined");
    const bJoined = collect(b, "peer:joined");
    const states: TransportConnectionState[] = [];
    a.on("connection:state", (state) => {
      states.push(state);
    });

    await joinRoom(a);
    expect(a.connectionState).toBe("connected");
    await joinRoom(b);
    expect(states).toEqual(["joining", "connected"]);
    expect(aJoined).toHaveLength(1);
    expect(aJoined[0]!.memberId).toBe("member-b");
    expect(bJoined).toHaveLength(1);
    expect(bJoined[0]!.displayName).toBe("Ada");
    expect(a.peers).toHaveLength(1);
    expect(b.peers).toHaveLength(1);
  });

  it("delivers join events in join order", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({ memberId: "member-b" });
    const c = hub.createTransport({ memberId: "member-c" });
    const cJoined = collect(c, "peer:joined");
    await joinRoom(a);
    await joinRoom(b);
    await joinRoom(c);
    expect(cJoined.map((p) => p.memberId)).toEqual(["member-a", "member-b"]);
    expect(c.peers.map((p) => p.memberId)).toEqual(["member-a", "member-b"]);
  });

  it("leaves cleanly: peers see peer:left and the sender cannot send", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({ memberId: "member-b" });
    const bLeft = collect(b, "peer:left");
    await joinRoom(a);
    await joinRoom(b);

    await a.leave();
    expect(a.connectionState).toBe("disconnected");
    expect(bLeft).toHaveLength(1);
    expect(bLeft[0]!.memberId).toBe("member-a");
    expect(b.peers).toHaveLength(0);
    await expect(a.send({ channel: "raw", payload: "x" })).rejects.toThrow(/not connected/);
  });

  it("cancels in-flight outgoing messages on leave", async () => {
    const hub = new InMemoryTransportHub({ now: () => 1000 });
    const a = hub.createTransport({
      memberId: "member-a",
      faults: { latencyMs: 50 },
    });
    const b = hub.createTransport({ memberId: "member-b" });
    const received = collectMessages(b);
    await joinRoom(a);
    await joinRoom(b);
    await a.send({ channel: "raw", payload: "in-flight" });
    await a.leave();
    hub.drain();
    expect(received).toHaveLength(0);
  });

  it("discards in-flight incoming messages after the peer left", async () => {
    const hub = new InMemoryTransportHub({ now: () => 1000 });
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({
      memberId: "member-b",
      faults: { latencyMs: 50 },
    });
    const aReceived = collectMessages(a);
    await joinRoom(a);
    await joinRoom(b);
    // b sends before leaving; the delivery is in flight when a tears down.
    await b.send({ channel: "raw", payload: "in-flight-to-a" });
    await a.leave();
    hub.drain();
    expect(aReceived).toHaveLength(0);
  });

  it("leave() while suspended moves the transport to disconnected", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({ memberId: "member-b" });
    await joinRoom(a);
    await joinRoom(b);
    await b.suspend();
    await b.leave();
    expect(b.connectionState).toBe("disconnected");
    await expect(b.resume()).rejects.toThrow(/not suspended/);
  });

  it("reconnect produces the expected lifecycle events and a fresh connectionId", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({ memberId: "member-b" });
    const bLeft = collect(b, "peer:left");
    const bJoined = collect(b, "peer:joined");
    const reconnected: TransportReconnectEvent[] = [];
    a.on("peer:reconnected", (event) => {
      reconnected.push(event);
    });
    await joinRoom(a);
    await joinRoom(b);
    const oldConnectionId = a.selfConnectionId;

    await a.reconnect();
    expect(a.connectionState).toBe("connected");
    expect(a.selfConnectionId).not.toBe(oldConnectionId);
    expect(reconnected).toHaveLength(1);
    expect(reconnected[0]!.oldConnectionId).toBe(oldConnectionId);
    expect(reconnected[0]!.newConnectionId).toBe(a.selfConnectionId);
    // Peers observe the same lifecycle a real transport produces: leave
    // (old connection) then join (new connection). The first join is the
    // original connection; the second is the rejoin.
    expect(bLeft.map((p) => p.connectionId)).toEqual([oldConnectionId]);
    expect(bJoined.map((p) => p.connectionId)).toEqual([oldConnectionId, a.selfConnectionId]);
    expect(b.peers.map((p) => p.memberId)).toEqual(["member-a"]);

    // Messages flow again after reconnect.
    const received = collectMessages(b);
    await a.send({ channel: "raw", payload: "after-reconnect" });
    hub.drain();
    expect(received).toHaveLength(1);
  });

  it("rejects reconnect when not connected", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({ memberId: "member-a" });
    await expect(a.reconnect()).rejects.toThrow(/not connected/);
  });

  it("cancels a delayed join when leaving mid-join", async () => {
    const hub = new InMemoryTransportHub({
      schedule: (callback, delayMs) => {
        void callback;
        void delayMs;
        return () => undefined;
      },
    });
    const a = hub.createTransport({
      memberId: "member-a",
      faults: { joinDelayMs: 100 },
    });
    const join = a.join({ room: "arena", sessionId: SESSION });
    await a.leave();
    await expect(join).rejects.toThrow(/cancelled/);
    expect(a.connectionState).toBe("idle");
    hub.dispose();
  });

  it("suspend drops the connection; resume rejoins and delivers buffered messages", async () => {
    const hub = new InMemoryTransportHub({ now: () => 1000 });
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({ memberId: "member-b" });
    const aLeft = collect(a, "peer:left");
    const aJoined = collect(a, "peer:joined");
    const states: TransportConnectionState[] = [];
    b.on("connection:state", (state) => {
      states.push(state);
    });
    await joinRoom(a);
    await joinRoom(b);
    const bReceived = collectMessages(b);

    // Schedule an in-flight message, THEN suspend: the message is already on
    // the wire when the connection drops, so it is buffered by default.
    await a.send({ channel: "raw", payload: "during-suspension" });
    await b.suspend();
    expect(b.connectionState).toBe("suspended");
    expect(aLeft).toHaveLength(1);
    expect(aLeft[0]!.memberId).toBe("member-b");

    hub.drain();
    expect(bReceived).toHaveLength(0);

    await b.resume();
    expect(b.connectionState).toBe("connected");
    // a observed b joining twice: the original connection and the rejoin.
    expect(aJoined).toHaveLength(2);
    expect(aJoined[1]!.connectionId).toBe(b.selfConnectionId);
    expect(bReceived).toHaveLength(1);
    expect(bReceived[0]!.payload).toBe("during-suspension");
    expect(states).toEqual(["joining", "connected", "suspended", "connected"]);
  });

  it("drops incoming messages while suspended when dropWhileSuspended is set", async () => {
    const hub = new InMemoryTransportHub({ now: () => 1000 });
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({
      memberId: "member-b",
      faults: { dropWhileSuspended: true },
    });
    await joinRoom(a);
    await joinRoom(b);
    const bReceived = collectMessages(b);

    await a.send({ channel: "raw", payload: "dropped" });
    await b.suspend();
    hub.drain();
    expect(bReceived).toHaveLength(0);

    await b.resume();
    hub.drain();
    expect(bReceived).toHaveLength(0);
  });

  it("rejects send while suspended", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({ memberId: "member-b" });
    await joinRoom(a);
    await joinRoom(b);
    await b.suspend();
    await expect(b.send({ channel: "raw", payload: "x" })).rejects.toThrow(/not connected/);
  });

  it("resume() requires a prior suspend()", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({ memberId: "member-a" });
    await joinRoom(a);
    await expect(a.resume()).rejects.toThrow(/not suspended/);
  });

  it("applies rejoin latency to reconnect completion", async () => {
    const scheduled: number[] = [];
    const hub = new InMemoryTransportHub({
      schedule: (callback, delayMs) => {
        scheduled.push(delayMs);
        return () => undefined;
      },
    });
    const a = hub.createTransport({
      memberId: "member-a",
      faults: { rejoinDelayMs: 40 },
    });
    const b = hub.createTransport({ memberId: "member-b" });
    const bJoined = collect(b, "peer:joined");
    await joinRoom(a);
    await joinRoom(b);
    const promise = a.reconnect();
    expect(scheduled).toEqual([40]);
    hub.drain();
    await promise;
    expect(bJoined).toHaveLength(2);
  });

  it("supports unsubscribing from events", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({ memberId: "member-a" });
    const b = hub.createTransport({ memberId: "member-b" });
    const received: TransportMessage[] = [];
    const unsubscribe = b.on("message:received", (message) => {
      received.push(message);
    });
    await joinRoom(a);
    await joinRoom(b);
    await a.send({ channel: "raw", payload: "one" });
    hub.drain();
    unsubscribe();
    await a.send({ channel: "raw", payload: "two" });
    hub.drain();
    expect(received).toHaveLength(1);
    expect(received[0]!.payload).toBe("one");
  });

  it("disposes transports and rejects further use", async () => {
    const hub = new InMemoryTransportHub();
    const a = hub.createTransport({ memberId: "member-a" });
    hub.dispose();
    await expect(a.join({ room: "r", sessionId: SESSION })).rejects.toThrow(/disposed/);
  });
});
