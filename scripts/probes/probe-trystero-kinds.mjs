// Probe relay acceptance for the kind range Trystero's Nostr strategy uses.
//
// Trystero derives an event kind from the topic string:
//   kind = (sum of char codes) % 10000 + 20000
// Topics are hashed room paths, so production kinds look random in
// [20000, 29999] — probing only two fixed kinds can miss per-kind policy.
// This probe publishes a spread of kinds with a subscription tag (["x",
// topic]) like Trystero does, records OK/NOTICE rejections, then bursts 12
// events on one kind to expose rate limits and proof-of-work demands.
//
// Usage: node scripts/probes/probe-trystero-kinds.mjs [relay ...]
// Default relays are the candidates under consideration plus the pinned set.

import { schnorr } from "@noble/secp256k1";
import { createHash } from "node:crypto";

const DEFAULT_RELAYS = [
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.mom",
  "wss://relay.snort.social",
  "wss://relay.nostr.net",
  "wss://nostr.bitcoiner.social",
  "wss://relay.damus.io",
  "wss://offchain.pub",
  "wss://relay.nostr.info",
];

const relays = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_RELAYS;
const SAMPLE_KINDS = [20011, 21427, 22774, 23551, 24813, 26000, 27555, 28999, 29801];
const BURST = 12;
const CONNECT_TIMEOUT_MS = 15_000;
const RESPONSE_TIMEOUT_MS = 10_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toHex = (bytes) => Buffer.from(bytes).toString("hex");
const now = () => Math.floor(Date.now() / 1000);

/** Trystero's kind derivation, for reference in the report. */
function kindForTopic(topic) {
  return ([...topic].reduce((sum, char) => sum + char.codePointAt(0), 0) % 10_000) + 20_000;
}

async function makeEvent(kind, secretKey, pubkey) {
  const topic = createHash("sha1").update(`probe:${Date.now()}:${Math.random()}`).digest("hex");
  const payload = {
    kind,
    tags: [["x", topic]],
    created_at: now(),
    content: JSON.stringify({ probe: true, ts: Date.now() }),
    pubkey,
  };
  const id = createHash("sha256")
    .update(
      JSON.stringify([
        0,
        payload.pubkey,
        payload.created_at,
        payload.kind,
        payload.tags,
        payload.content,
      ]),
    )
    .digest();
  return { id: toHex(id), sig: toHex(await schnorr.signAsync(id, secretKey)), ...payload };
}

async function fetchNip11(url) {
  try {
    const response = await fetch(url.replace(/^wss:/, "https:"), {
      headers: { Accept: "application/nostr+json", "User-Agent": "rocketcrab-probe/0.2" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const info = await response.json();
    return {
      software: info.software,
      version: info.version,
      supported_nips: info.supported_nips,
      limitation: info.limitation,
    };
  } catch (error) {
    return { error: String(error).slice(0, 200) };
  }
}

function probeRelay(url) {
  return new Promise((resolve) => {
    const { secretKey, publicKey } = schnorr.keygen();
    const pubkey = toHex(publicKey);
    const result = {
      url,
      connected: false,
      connectError: null,
      samples: {},
      burst: { accepted: 0, total: BURST, reasons: [] },
    };
    let settled = false;
    let socket;
    const pending = new Map();
    const finish = () => {
      if (settled) return;
      settled = true;
      for (const entry of pending.values()) entry.resolve({ status: "timeout", reason: null });
      pending.clear();
      try {
        socket?.close();
      } catch {}
      resolve(result);
    };
    const timeout = setTimeout(() => {
      result.connectError ??= "connect timeout";
      finish();
    }, CONNECT_TIMEOUT_MS);

    try {
      socket = new WebSocket(url);
    } catch (error) {
      result.connectError = String(error);
      clearTimeout(timeout);
      finish();
      return;
    }

    const publish = async (kind) => {
      const event = await makeEvent(kind, secretKey, pubkey);
      const verdict = new Promise((resolveVerdict) => {
        pending.set(event.id, {
          resolve: resolveVerdict,
          timer: setTimeout(() => {
            pending.delete(event.id);
            resolveVerdict({ status: "timeout", reason: null });
          }, RESPONSE_TIMEOUT_MS),
        });
      });
      socket.send(JSON.stringify(["EVENT", event]));
      const answer = await verdict;
      return { event, answer };
    };

    socket.onopen = () => {
      result.connected = true;
      clearTimeout(timeout);
      void (async () => {
        for (const kind of SAMPLE_KINDS) {
          const { answer } = await publish(kind);
          result.samples[kind] = answer;
          await sleep(250);
        }
        const burstKind = SAMPLE_KINDS[2];
        const burstResults = [];
        for (let i = 0; i < BURST; i += 1) {
          const { answer } = await publish(burstKind);
          burstResults.push(answer);
          if (answer.status === "accepted") result.burst.accepted += 1;
          else result.burst.reasons.push(`${answer.status}:${answer.reason ?? ""}`.slice(0, 160));
          await sleep(120);
        }
        void burstResults;
        setTimeout(finish, 600);
      })();
    };
    socket.onerror = () => {
      result.connectError ??= "websocket error";
    };
    socket.onclose = () => {
      if (!result.connected) result.connectError ??= "closed before open";
      finish();
    };
    socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!Array.isArray(message)) return;
      const [type, ...rest] = message;
      if (type === "OK") {
        const [id, accepted, reason] = rest;
        const entry = pending.get(id);
        if (entry) {
          clearTimeout(entry.timer);
          pending.delete(id);
          entry.resolve({
            status: accepted ? "accepted" : "rejected",
            reason: typeof reason === "string" ? reason.slice(0, 200) : null,
          });
        }
      } else if (type === "NOTICE") {
        for (const [id, entry] of pending) {
          clearTimeout(entry.timer);
          entry.resolve({ status: "notice", reason: String(rest[0] ?? "").slice(0, 200) });
          pending.delete(id);
        }
      } else if (type === "CLOSED") {
        for (const [id, entry] of pending) {
          clearTimeout(entry.timer);
          entry.resolve({ status: "closed", reason: String(rest[1] ?? "").slice(0, 200) });
          pending.delete(id);
        }
      }
    };
  });
}

async function main() {
  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        burstSize: BURST,
        sampleKinds: SAMPLE_KINDS,
        kindDerivation: "kind = charCodeSum(topic) % 10000 + 20000",
        exampleTopics: {
          "party:room:<sha1>": kindForTopic("party:room:0123456789abcdef0123456789abcdef01234567"),
          "nova-rendezvous:<sha1>": kindForTopic("nova-rendezvous:0123456789abcdef"),
        },
      },
      null,
      2,
    ),
  );
  for (const url of relays) {
    const [nip11, probe] = [await fetchNip11(url), await probeRelay(url)];
    console.log(JSON.stringify({ url, nip11, ...probe }, null, 2));
    await sleep(400);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
