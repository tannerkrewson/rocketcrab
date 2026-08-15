// Probe CANDIDATE replacement relays for Trystero kind acceptance:
// connect, publish kinds 22774 + 22734 with fresh pubkeys (2 rounds), and
// a small burst (10 events) to catch quota-style rate limits.
//
// Run: node scripts/probes/probe-candidates.mjs
import { schnorr } from "@noble/secp256k1";
import { createHash } from "node:crypto";

const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const toHex = (b) => Buffer.from(b).toString("hex");
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = [
  "wss://relay.nostr.band",
  "wss://brb.io",
  "wss://relay.duti.dev",
  "wss://nostr.wine",
  "wss://relay.nostr.bg",
  "wss://eden.nostr.land",
  "wss://relay.momostr.com",
  "wss://relay.siamstr.in",
  "wss://relay.orangepill.dev",
  "wss://relay.f7z.io",
  "wss://pyramid.f7z.io",
  "wss://relay.nostr.net",
  "wss://relay.current.fyi",
  "wss://nostr.bitcoiner.social",
  "wss://relay.0xchat.com",
  "wss://relay.nostr.vet",
  "wss://relay.damus.io", // control: known throttling
];

async function makeEvent(kind) {
  const { secretKey, publicKey } = schnorr.keygen();
  const pubkey = toHex(publicKey);
  const content = `{"probe":true,"ts":${Date.now()}}`;
  const tags = [["x", `probe:${Date.now()}:${Math.random().toString(36).slice(2)}`]];
  const payload = { kind, tags, created_at: now(), content, pubkey };
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

function probeRelay(url, kinds) {
  return new Promise((resolve) => {
    const out = { url, connected: false, error: null, kinds: {}, burst: [], info: null };
    let inBurst = false;
    let settled = false;
    let ws;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        out.error = "timeout";
        try {
          ws?.close();
        } catch {}
        resolve(out);
      }
    }, 10000);
    const finish = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        try {
          ws?.close();
        } catch {}
        resolve(out);
      }
    };
    try {
      ws = new WebSocket(url);
    } catch (_e) {
      out.error = String(e);
      finish();
      return;
    }

    const pending = new Map();
    ws.onopen = () => {
      out.connected = true;
      (async () => {
        for (const kind of kinds) {
          const ev = await makeEvent(kind);
          out.kinds[kind] = { sent: true, eventId: ev.id };
          const pr = new Promise((r) => {
            const t = setTimeout(() => r({ status: "no-ok", reason: "timeout" }), 6000);
            pending.set(ev.id, (v) => {
              clearTimeout(t);
              r(v);
            });
          });
          ws.send(JSON.stringify(["EVENT", ev]));
          out.kinds[kind] = { ...out.kinds[kind], ...(await pr) };
          await sleep(200);
        }
        // Burst: 10 more events same connection to catch quota limits
        inBurst = true;
        for (let i = 0; i < 10; i++) {
          const ev = await makeEvent(22774);
          ws.send(JSON.stringify(["EVENT", ev]));
          await sleep(120);
        }
        await sleep(2500);
        setTimeout(finish, 200);
      })();
    };
    ws.onerror = () => {
      out.error = out.error ?? "websocket error";
    };
    ws.onclose = () => {
      if (!out.connected) out.error = out.error ?? "closed before open";
      finish();
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (out.info === null) out.info = String(e.data).slice(0, 200);
      const [type, ...rest] = msg;
      if (type === "OK") {
        const [eventId, accepted, reason] = rest;
        const resolve = pending.get(eventId);
        if (resolve) {
          resolve({ status: accepted ? "accepted" : "rejected", reason: reason ?? null });
        } else if (inBurst) {
          out.burst.push({ ok: accepted, reason: reason ?? "" });
        }
      } else if (type === "NOTICE") {
        for (const resolve of pending.values()) resolve({ status: "notice", reason: rest[0] });
      }
    };
  });
}

async function fetchNip11(url) {
  const httpUrl = url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
  try {
    const res = await fetch(httpUrl, {
      headers: { Accept: "application/nostr+json", "User-Agent": "rocketcrab-probe/0.1" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const j = await res.json();
    return { name: j.name, nips: j.supported_nips };
  } catch (_e) {
    return { error: String(e).slice(0, 120) };
  }
}

async function main() {
  for (const url of CANDIDATES) {
    const nip = await fetchNip11(url);
    const r = await probeRelay(url, [22774, 22734]);
    const k = Object.entries(r.kinds)
      .map(
        ([kind, v]) =>
          `${kind}=${v.status ?? "?"}${v.reason && v.status !== "accepted" ? `("${v.reason}")` : ""}`,
      )
      .join(" ");
    const okBurst = (r.burst ?? []).filter((b) => b.ok).length;
    const rejBurst = (r.burst ?? [])
      .filter((b) => !b.ok)
      .map((b) => b.reason)
      .slice(0, 2);
    console.log(`${url}`);
    console.log(`  nip11: ${nip.name ?? "?"} nips=[${nip.nips?.join(",") ?? nip.error}]`);
    console.log(
      `  connect=${r.connected}${r.error ? ` err=${r.error}` : ""}  ${k}  burst10: ${okBurst} ok${rejBurst.length ? ` rejects=${JSON.stringify(rejBurst)}` : ""}`,
    );
    await sleep(400);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
