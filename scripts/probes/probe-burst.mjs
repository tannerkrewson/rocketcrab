// Stress probe: characterize damus rate-limiting (transient vs persistent,
// per-connection vs per-pubkey) and offchain.pub web-of-trust behavior
// under app-like load: N concurrent sockets (the app opens 2 transports x
// 7 relays = 14 sockets) each publishing periodically.
//
// Run: node scripts/probes/probe-burst.mjs
import { schnorr } from "@noble/secp256k1";
import { createHash } from "node:crypto";

const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const toHex = (b) => Buffer.from(b).toString("hex");
const now = () => Math.floor(Date.now() / 1000);

const TARGETS = [
  { url: "wss://relay.damus.io", label: "damus" },
  { url: "wss://offchain.pub", label: "offchain" },
];

async function makeEvent(kind, { sameKey = null } = {}) {
  let secretKey, publicKey;
  if (sameKey) {
    secretKey = sameKey.secretKey;
    publicKey = sameKey.publicKey;
  } else {
    ({ secretKey, publicKey } = schnorr.keygen());
  }
  const pubkey = toHex(publicKey);
  const content = `{"probe":true,"ts":${Date.now()}}`;
  const tags = [["x", `probe:${Date.now()}:${Math.random().toString(36).slice(2)}`]];
  const payload = { kind, tags, created_at: now(), content, pubkey };
  const idHex = sha256hex(JSON.stringify([0, payload.pubkey, payload.created_at, payload.kind, payload.tags, payload.content]));
  const sig = toHex(await schnorr.signAsync(new Uint8Array(Buffer.from(idHex, "hex")), secretKey));
  return { id: idHex, sig, ...payload, secretKey, publicKey };
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) { reject(e); return; }
    const t = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("connect timeout")); }, 8000);
    ws.onopen = () => { clearTimeout(t); resolve(ws); };
    ws.onerror = () => {};
    ws.onclose = () => { clearTimeout(t); reject(new Error("closed before open")); };
  });
}

/** Publish `n` events (burst) over one socket; collect OK/true|false messages. */
async function burstPublish(ws, kind, n, opts = {}) {
  const out = [];
  const waiter = new Promise((resolve) => {
    ws.__prev = ws.onmessage;
    ws.onmessage = (e) => {
      ws.__prev?.(e);
      let msg;
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      if (msg[0] === "OK") out.push({ ok: msg[2], reason: msg[3] ?? "" });
      if (out.length >= n) resolve();
    };
    setTimeout(resolve, 15000);
  });
  for (let i = 0; i < n; i++) {
    const ev = await makeEvent(kind, opts);
    ws.send(JSON.stringify(["EVENT", { kind: ev.kind, tags: ev.tags, created_at: ev.created_at, content: ev.content, pubkey: ev.pubkey, id: ev.id, sig: ev.sig }]));
    await new Promise((r) => setTimeout(r, 200));
  }
  await waiter;
  return out;
}

async function main() {
  for (const { url, label } of TARGETS) {
    console.log(`\n##### ${label} (${url}) #####`);

    // Test A: fresh pubkey, burst of 25 events on one socket
    console.log("A) fresh pubkey, burst of 25 events, one socket:");
    const ws1 = await openSocket(url).catch((e) => { console.log("   connect failed:", String(e)); return null; });
    if (ws1) {
      const res = await burstPublish(ws1, 22774, 25, {});
      const ok = res.filter((r) => r.ok).length;
      console.log(`   accepted=${ok}/${res.length}  rejects=${res.filter((r) => !r.ok).map((r) => JSON.stringify(r.reason)).slice(0, 3)}`);
      ws1.close();
    }

    // Test B: same pubkey across 2 sockets, burst of 15 each (app-like: one pubkey reused per tab? trystero generates per module, but test worst case)
    console.log("B) SAME pubkey, 2 sockets x 15 events:");
    const sameKey = schnorr.keygen();
    const ws2a = await openSocket(url).catch((e) => null);
    const ws2b = await openSocket(url).catch((e) => null);
    if (ws2a) {
      const r1 = await burstPublish(ws2a, 22774, 15, { sameKey });
      ws2a.close();
      console.log(`   socket1 accepted=${r1.filter((r) => r.ok).length}/15`);
    }
    if (ws2b) {
      const r2 = await burstPublish(ws2b, 22774, 15, { sameKey });
      ws2b.close();
      console.log(`   socket2 accepted=${r2.filter((r) => r.ok).length}/15`);
    }

    // Test C: rapid connect/disconnect churn (14 sockets like the app) - do reconnects get refused?
    console.log("C) 14 rapid sequential connects:");
    let opened = 0, refused = 0;
    for (let i = 0; i < 14; i++) {
      const ws = await openSocket(url).catch(() => null);
      if (ws) { opened++; ws.close(); } else refused++;
      await new Promise((r) => setTimeout(r, 150));
    }
    console.log(`   opened=${opened} refused=${refused}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
