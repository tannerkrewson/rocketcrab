// Run against a separately started local `wrangler dev` (see deploy/cloudflare.md).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import WebSocket from "ws";

const base = process.env.SIGNAL_TEST_ORIGIN ?? "http://127.0.0.1:18987";
const parsedBase = new URL(base);
if (
  parsedBase.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(parsedBase.hostname) ||
  parsedBase.pathname !== "/" ||
  parsedBase.search ||
  parsedBase.hash
) {
  throw new Error("SIGNAL_TEST_ORIGIN must be a local HTTP origin");
}
const origin = "http://localhost:5173";
const wsBase = base.replace(/^http/, "ws");
const url = `${wsBase}/signal/${randomBytes(16).toString("hex")}`;
const connect = (target = url, requestOrigin = origin) =>
  new WebSocket(target, { origin: requestOrigin });
const send = (socket, value) => socket.send(JSON.stringify(value));

function receiver(socket) {
  const queue = [];
  const waiters = [];
  socket.on("message", (data) => {
    const value = JSON.parse(data.toString());
    const waiter = waiters.shift();
    if (waiter) waiter(value);
    else queue.push(value);
  });
  return {
    pending: () => queue.length,
    next: async () => {
      if (queue.length) return queue.shift();
      let timer;
      try {
        return await Promise.race([
          new Promise((resolve) => waiters.push(resolve)),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("message timeout")), 3000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

async function rejected(target, requestOrigin) {
  const socket = connect(target, requestOrigin);
  const [, response] = await once(socket, "unexpected-response");
  response.resume();
  return response.statusCode;
}

test(
  "workerd signaling upgrade, isolation and idle socket delivery",
  { timeout: 30000 },
  async () => {
    assert.equal(await rejected(url, "https://evil.example"), 403);
    assert.equal(
      (await fetch(url.replace(/^ws/, "http"), { headers: { Origin: origin } })).status,
      426,
    );
    assert.equal(await rejected(`${wsBase}/signal/invalid`, origin), 404);
    const a = connect(),
      b = connect(),
      other = connect(`${wsBase}/signal/${randomBytes(16).toString("hex")}`);
    const sockets = [a, b, other];
    try {
      await Promise.all(sockets.map((socket) => once(socket, "open")));
      const am = receiver(a),
        bm = receiver(b),
        om = receiver(other);
      send(a, { type: "subscribe", topic: "live" });
      send(a, { type: "publish", topic: "live", payload: "ready-a" });
      assert.equal((await am.next()).payload, "ready-a");
      send(other, { type: "subscribe", topic: "live" });
      send(other, { type: "publish", topic: "live", payload: "ready-other" });
      assert.equal((await om.next()).payload, "ready-other");
      send(b, { type: "subscribe", topic: "live" });
      send(b, { type: "publish", topic: "live", payload: "barrier" });
      assert.equal((await bm.next()).payload, "barrier");
      assert.equal((await am.next()).payload, "barrier");
      // Idle delivery is tested, but this does not prove workerd evicted the object.
      await new Promise((resolve) => setTimeout(resolve, 12000));
      send(a, { type: "publish", topic: "live", payload: "after-idle" });
      assert.deepEqual(await am.next(), { topic: "live", payload: "after-idle" });
      assert.deepEqual(await bm.next(), { topic: "live", payload: "after-idle" });
      send(b, { type: "unsubscribe", topic: "live" });
      send(b, { type: "subscribe", topic: "confirm" });
      send(b, { type: "publish", topic: "confirm", payload: "unsubscribed" });
      assert.equal((await bm.next()).payload, "unsubscribed");
      send(a, { type: "publish", topic: "live", payload: "after-unsubscribe" });
      assert.equal((await am.next()).payload, "after-unsubscribe");
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(bm.pending(), 0);
      assert.equal(om.pending(), 0);
    } finally {
      for (const socket of sockets) socket.terminate();
    }
  },
);
