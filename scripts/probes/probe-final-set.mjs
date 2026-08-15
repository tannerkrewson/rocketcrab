import { schnorr } from "@noble/secp256k1";
import { createHash } from "node:crypto";
const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const toHex = (b) => Buffer.from(b).toString("hex");
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SET = [
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.mom",
  "wss://relay.snort.social",
  "wss://relay.nostr.net",
  "wss://nostr.bitcoiner.social",
];
async function makeEvent(kind) {
  const { secretKey, publicKey } = schnorr.keygen();
  const pubkey = toHex(publicKey);
  const tags = [["x", `probe:${Date.now()}:${Math.random().toString(36).slice(2)}`]];
  const payload = { kind, tags, created_at: now(), content: '{"probe":true}', pubkey };
  const idHex = sha256hex(
    JSON.stringify([
      0,
      payload.pubkey,
      payload.created_at,
      payload.kind,
      payload.tags,
      payload.content,
    ]),
  );
  const sig = toHex(await schnorr.signAsync(new Uint8Array(Buffer.from(idHex, "hex")), secretKey));
  return { id: idHex, sig, ...payload };
}
function run(url) {
  return new Promise((resolve) => {
    const out = { connected: false, err: null, rounds: {} };
    let ws;
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        try {
          ws?.close();
        } catch {}
        resolve(out);
      }
    };
    const t = setTimeout(finish, 25000);
    try {
      ws = new WebSocket(url);
    } catch (_e) {
      out.err = String(e);
      finish();
      return;
    }
    const pending = new Map();
    ws.onopen = () => {
      out.connected = true;
      (async () => {
        for (let round = 1; round <= 2; round++) {
          const kindRes = {};
          for (const kind of [22774, 22734]) {
            const ev = await makeEvent(kind);
            const pr = new Promise((r) => {
              const tt = setTimeout(() => r({ status: "no-ok" }), 6000);
              pending.set(ev.id, (v) => {
                clearTimeout(tt);
                r(v);
              });
            });
            ws.send(JSON.stringify(["EVENT", ev]));
            kindRes[kind] = await pr;
            await sleep(150);
          }
          // burst 12
          let ok = 0;
          const rej = [];
          // simpler: count via pending of burst events
          const burstCount = { ok: 0, total: 12, rej: [] };
          const burstIds = [];
          for (let i = 0; i < 12; i++) {
            const ev = await makeEvent(22774);
            burstIds.push(ev.id);
            const pr = new Promise((r) => {
              pending.set(ev.id, r);
            });
            ws.send(JSON.stringify(["EVENT", ev]));
            const v = await pr;
            if (v.status === "accepted") burstCount.ok++;
            else burstCount.rej.push(v.reason);
            await sleep(100);
          }
          out.rounds[round] = { kinds: kindRes, burst: burstCount };
        }
        finish();
      })();
    };
    ws.onerror = () => {
      out.err = out.err ?? "websocket error";
    };
    ws.onclose = () => {
      if (!out.connected) out.err = out.err ?? "closed before open";
      finish();
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg[0] === "OK") {
        const p = pending.get(msg[1]);
        if (p) {
          pending.delete(msg[1]);
          p({ status: msg[2] ? "accepted" : "rejected", reason: msg[3] ?? null });
        }
      } else if (msg[0] === "NOTICE") {
        for (const p of pending.values()) p({ status: "notice", reason: msg[1] });
        pending.clear();
      }
    };
  });
}
for (const url of SET) {
  const r = await run(url);
  console.log(url);
  console.log("  connect=" + r.connected + (r.err ? " err=" + r.err : ""));
  for (const [round, res] of Object.entries(r.rounds)) {
    console.log(
      `  round ${round}: 22774=${res.kinds[22774]?.status} 22734=${res.kinds[22734]?.status} burst12=${res.burst.ok}/12${res.burst.rej.length ? " rejects=" + JSON.stringify(res.burst.rej.slice(0, 2)) : ""}`,
    );
  }
  await sleep(300);
}
