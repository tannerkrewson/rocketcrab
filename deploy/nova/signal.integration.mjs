// Run against a separately started local `wrangler dev` (see deploy/README.md).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import WebSocket from "ws";

const base = process.env.SIGNAL_TEST_ORIGIN ?? "http://127.0.0.1:2729";
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
const origin = parsedBase.origin;
const wsBase = base.replace(/^http/, "ws");
const url = `${wsBase}/api/signal/${randomBytes(16).toString("hex")}`;
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
    assert.equal(await rejected(`${wsBase}/api/signal/invalid`, origin), 404);
    const a = connect(),
      b = connect(),
      other = connect(`${wsBase}/api/signal/${randomBytes(16).toString("hex")}`);
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

function collector(socket) {
  const messages = [];
  const closes = [];
  socket.on("message", (data, isBinary) => messages.push({ data, isBinary }));
  socket.on("close", (code, reason) => closes.push({ code, reason: reason.toString() }));
  return { messages, closes };
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test(
  "workerd tunnel pairing: paired once per side, binary forwarded, text refused",
  {
    timeout: 30000,
  },
  async () => {
    const tunnelUrl = (pairId) => `${wsBase}/api/tunnel/${pairId}`;
    assert.equal(await rejected(`${wsBase}/api/tunnel/${"A".repeat(64)}`, origin), 404);

    const pairOne = tunnelUrl(randomBytes(32).toString("hex"));
    const a = connect(pairOne),
      b = connect(pairOne);
    const sockets = [a, b];
    try {
      const aSeen = collector(a),
        bSeen = collector(b);
      await Promise.all(sockets.map((socket) => once(socket, "open")));
      await waitFor(() => aSeen.messages.length >= 1 && bSeen.messages.length >= 1, "paired");
      await new Promise((resolve) => setTimeout(resolve, 200));
      for (const seen of [aSeen, bSeen]) {
        assert.equal(seen.messages.length, 1);
        assert.equal(seen.messages[0].data.toString(), "paired");
        assert.equal(seen.messages[0].isBinary, false);
      }

      const atB = once(b, "message");
      a.send(Buffer.from([1, 2, 3]), { binary: true });
      const [bytes, bytesIsBinary] = await atB;
      assert.equal(bytesIsBinary, true);
      assert.deepEqual([...bytes], [1, 2, 3]);
      assert.equal(await rejected(pairOne, origin), 409);
      a.close(1000, "done");
      await waitFor(() => b._closeFrameReceived, "partner close frame");
      assert.equal(b._closeCode, 1000);
      assert.equal(b._closeMessage.toString(), "partner closed");
    } finally {
      for (const socket of sockets) socket.terminate();
    }

    // Local workerd delays the partner's TCP close event. Inspect the received
    // close frame instead: ws initializes _closeCode to 1006, so only
    // _closeFrameReceived proves that an actual close frame arrived.
    const pairTwo = tunnelUrl(randomBytes(32).toString("hex"));
    const c = connect(pairTwo),
      d = connect(pairTwo);
    const second = [c, d];
    try {
      const cSeen = collector(c),
        dSeen = collector(d);
      await Promise.all(second.map((socket) => once(socket, "open")));
      await waitFor(() => cSeen.messages.length >= 1 && dSeen.messages.length >= 1, "paired");
      c.send("not binary");
      await waitFor(() => cSeen.closes.length === 1, "sender close");
      await waitFor(() => d._closeFrameReceived, "partner close frame");
      assert.equal(cSeen.closes[0].code, 1003);
      assert.equal(cSeen.closes[0].reason, "binary only");
      assert.equal(d._closeCode, 1003);
      for (const seen of [cSeen, dSeen]) assert.equal(seen.messages.length, 1);
    } finally {
      for (const socket of second) socket.terminate();
    }
  },
);

function closeFrame(socket) {
  return socket._closeFrameReceived
    ? { code: socket._closeCode, reason: socket._closeMessage.toString() }
    : null;
}

async function openPair() {
  const url = `${wsBase}/api/tunnel/${randomBytes(32).toString("hex")}`;
  const a = connect(url),
    b = connect(url);
  // Collect from the start: `paired` arrives right after the upgrade, before `open` resolves.
  const aSeen = collector(a),
    bSeen = collector(b);
  try {
    await Promise.all([once(a, "open"), once(b, "open")]);
    await waitFor(() => aSeen.messages.length >= 1 && bSeen.messages.length >= 1, "paired");
    return { a, b, aSeen, bSeen };
  } catch (error) {
    a.terminate();
    b.terminate();
    throw error;
  }
}

test(
  "workerd tunnel accepts a frame at the limit, closes both on one byte over with 1009",
  {
    timeout: 30000,
  },
  async () => {
    const { a, b, bSeen } = await openPair();
    try {
      // 262144 + 29: the largest payload plus the client's AES-GCM framing.
      const largest = Buffer.alloc(262144 + 29, 1);
      a.send(largest, { binary: true });
      await waitFor(() => bSeen.messages.length === 2, "largest frame");
      assert.equal(bSeen.messages[1].data.length, largest.length);
      assert.equal(bSeen.messages[1].isBinary, true);
      // One byte over the server's limit (262144 + 64).
      a.send(Buffer.alloc(262144 + 64 + 1, 2), { binary: true });
      await waitFor(() => closeFrame(a) && closeFrame(b), "1009 close frames");
      assert.equal(closeFrame(a).code, 1009);
      assert.equal(closeFrame(b).code, 1009);
    } finally {
      a.terminate();
      b.terminate();
    }
  },
);

test(
  "workerd tunnel closes both with 1008 once a socket exhausts its relay budget",
  {
    timeout: 30000,
  },
  async () => {
    const { a, b } = await openPair();
    try {
      // 24 frames of 256 KiB is 6 MiB: more than the 4 MiB burst, and far too little
      // time for the 512 KiB/s refill to cover the difference.
      const chunk = Buffer.alloc(262144, 3);
      for (let i = 0; i < 24 && a.readyState === 1; i++) a.send(chunk, { binary: true });
      await waitFor(() => closeFrame(a) && closeFrame(b), "1008 close frames");
      assert.equal(closeFrame(a).code, 1008);
      assert.equal(closeFrame(a).reason, "rate limit");
      assert.equal(closeFrame(b).code, 1008);
      assert.equal(closeFrame(b).reason, "rate limit");
    } finally {
      a.terminate();
      b.terminate();
    }
  },
);
