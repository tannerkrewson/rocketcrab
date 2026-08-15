// Probe the pinned GOOD_RELAYS for Trystero kind acceptance.
// For each relay: (1) WS connect, (2) NIP-11 info doc, (3) publish
// signed EVENTS of kind 22774 and 22734 with a FRESH random pubkey,
// (4) record OK/NOTICE responses and rejection reasons. Repeat N rounds
// to check whether damus rate-limiting is transient or persistent.
//
// Run from repo root: node /tmp/probe-relays.mjs [rounds]
import { schnorr } from "@noble/secp256k1";
import { createHash } from "node:crypto";

const GOOD_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.mom",
  "wss://relay.snort.social",
  "wss://offchain.pub",
  "wss://relay.nostr.info",
];

const KINDS = [22774, 22734];
const ROUNDS = Number(process.argv[2] ?? 3);
const CONNECT_TIMEOUT_MS = 10000;
const RESPONSE_TIMEOUT_MS = 8000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
const toHex = (bytes) => Buffer.from(bytes).toString("hex");
const now = () => Math.floor(Date.now() / 1000);

/** Build a signed Nostr EVENT message for a fresh random pubkey. */
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

/** One WS session against a relay: connect, wait INFO, publish kinds, collect responses. */
function probeRelay(url, kinds) {
  return new Promise((resolve) => {
    const result = {
      url,
      connected: false,
      connectError: null,
      info: null, // first text frame (often relay INFO / NIP-11-ish or NOTICE)
      kinds: {},
      messages: [],
    };
    let settled = false;
    let ws;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        result.connectError = "timeout";
        try {
          ws?.close();
        } catch {}
        resolve(result);
      }
    }, CONNECT_TIMEOUT_MS);

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {}
      resolve(result);
    };

    try {
      ws = new WebSocket(url);
    } catch (_e) {
      result.connectError = String(e);
      finish();
      return;
    }

    const pending = new Map(); // kind -> {event, resolve}

    ws.onopen = () => {
      result.connected = true;
      // Publish each kind in sequence
      (async () => {
        for (const kind of kinds) {
          const event = await makeEvent(kind);
          result.kinds[kind] = { sent: true, eventId: event.id };
          const pr = new Promise((r) => {
            const t = setTimeout(
              () => r({ status: "no-ok-response", reason: "timeout" }),
              RESPONSE_TIMEOUT_MS,
            );
            pending.set(kind, {
              resolve: (v) => {
                clearTimeout(t);
                r(v);
              },
            });
          });
          ws.send(JSON.stringify(["EVENT", event]));
          const verdict = await pr;
          result.kinds[kind] = { ...result.kinds[kind], ...verdict };
          await sleep(300);
        }
        // Small grace window for stragglers, then close.
        setTimeout(finish, 800);
      })();
    };

    ws.onerror = (e) => {
      result.connectError = result.connectError ?? "websocket error";
    };
    ws.onclose = () => {
      if (!result.connected) result.connectError = result.connectError ?? "closed before open";
      finish();
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (result.messages.length < 20) result.messages.push(String(e.data).slice(0, 400));
      if (result.info === null) result.info = String(e.data).slice(0, 400);
      const [type, ...rest] = msg;
      if (type === "EVENT" && typeof rest[0] === "string" && pending.has(rest[0])) {
        // EOSE-style ack? Nostr: relays send OK for EVENT, not EVENT. Skip.
      }
      if (type === "OK") {
        const [eventId, accepted, reason] = rest;
        for (const [kind, entry] of Object.entries(result.kinds)) {
          if (entry.eventId === eventId && !entry.status) {
            pending
              .get(Number(kind))
              ?.resolve({ status: accepted ? "accepted" : "rejected", reason: reason ?? null });
          }
        }
      } else if (type === "NOTICE") {
        // NOTICE is relay-wide policy info; attribute to all pending kinds.
        for (const kind of Object.keys(pending)) {
          pending.get(Number(kind))?.resolve({ status: "notice", reason: rest[0] });
        }
      } else if (type === "CLOSED") {
        // REQ closed (we don't send REQ here, but harmless)
      }
    };
  });
}

/** NIP-11 info doc via HTTP GET with Accept: application/nostr+json. */
async function fetchNip11(url) {
  const httpUrl = url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
  try {
    const res = await fetch(httpUrl, {
      headers: { Accept: "application/nostr+json", "User-Agent": "rocketcrab-probe/0.1" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { status: res.status, error: `HTTP ${res.status}` };
    const json = await res.json();
    return {
      name: json.name,
      supported_nips: json.supported_nips,
      limitation: json.limitation,
      retention: json.retention?.kinds,
    };
  } catch (_e) {
    return { error: String(e).slice(0, 200) };
  }
}

async function main() {
  console.log(`Probing ${GOOD_RELAYS.length} relays x ${ROUNDS} rounds, kinds ${KINDS.join(",")}`);
  const summary = {};
  for (const url of GOOD_RELAYS) {
    const nip11 = await fetchNip11(url);
    const results = [];
    for (let round = 1; round <= ROUNDS; round++) {
      results.push(await probeRelay(url, KINDS));
      await sleep(500);
    }
    summary[url] = { nip11, results };
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
