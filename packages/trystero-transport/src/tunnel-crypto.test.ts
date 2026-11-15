import { describe, expect, it } from "vitest";
import {
  TUNNEL_FRAME_OVERHEAD_BYTES,
  TUNNEL_IV_BYTES,
  TunnelCipher,
  TunnelFrameError,
  computeTunnelPairing,
  decodeTunnelMessage,
  deriveTunnelKeys,
  encodeTunnelMessage,
  extractDtlsFingerprints,
} from "./tunnel-crypto";

const SECRET_A = "A".repeat(43);
const SECRET_B = "B".repeat(43);
const ROOM = "party:" + "c".repeat(64);
const OTHER_ROOM = "party:" + "d".repeat(64);
const PAIR = "e".repeat(64);
const OTHER_PAIR = "f".repeat(64);

/** Deterministic synthetic DTLS fingerprint: 32 colon-separated uppercase bytes. */
function fingerprint(seed: number): string {
  const bytes: string[] = [];
  let state = (Math.imul(seed, 2654435761) + 1) >>> 0;
  for (let i = 0; i < 32; i += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    bytes.push(((state >>> 16) & 0xff).toString(16).padStart(2, "0").toUpperCase());
  }
  return bytes.join(":");
}

const CHROME_LOCAL_SDP = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  `a=fingerprint:sha-256 ${fingerprint(1)}`,
  "a=group:BUNDLE 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=ice-ufrag:kN3q",
  "a=ice-pwd:0123456789abcdefghijkl",
  `a=fingerprint:sha-256 ${fingerprint(1)}`,
  "a=setup:actpass",
  "a=mid:0",
  "a=sctp-port:5000",
  "",
].join("\r\n");

// Firefox writes lowercase hex on some builds, and the session line differs in case.
const FIREFOX_REMOTE_SDP = [
  "v=0",
  "o=mozilla...THIS_IS_SDPARTA-99.0 1234 0 IN IP4 0.0.0.0",
  "s=-",
  "t=0 0",
  `a=fingerprint:sha-256 ${fingerprint(2).toLowerCase()}`,
  "a=group:BUNDLE 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=ice-ufrag:Zq7d",
  `a=fingerprint:sha-256 ${fingerprint(2)}`,
  "a=setup:active",
  "a=mid:0",
  "",
].join("\r\n");

const pairIdOf = async (local: string, remote: string, room: string) =>
  (await computeTunnelPairing(local, remote, room)).pairId;

/** Both ends of one tunnel, built the way each peer would build its own. */
async function tunnelPair(secret = SECRET_A, room = ROOM) {
  const chrome = await computeTunnelPairing(CHROME_LOCAL_SDP, FIREFOX_REMOTE_SDP, room);
  const firefox = await computeTunnelPairing(FIREFOX_REMOTE_SDP, CHROME_LOCAL_SDP, room);
  return {
    chrome: new TunnelCipher(await deriveTunnelKeys(secret, chrome.pairId, chrome.localRole)),
    firefox: new TunnelCipher(await deriveTunnelKeys(secret, firefox.pairId, firefox.localRole)),
  };
}

function bytes(length: number, fill = 0x5a): Uint8Array<ArrayBuffer> {
  return new Uint8Array(length).fill(fill);
}

function errorCodeOf(error: unknown): unknown {
  return error instanceof TunnelFrameError ? error.code : error;
}

describe("extractDtlsFingerprints", () => {
  it("collects session-level and media-level lines from a Chrome-style SDP and dedupes them", () => {
    expect(extractDtlsFingerprints(CHROME_LOCAL_SDP)).toEqual([`sha-256 ${fingerprint(1)}`]);
  });

  it("normalises mixed-case algorithm and hex in a Firefox-style SDP", () => {
    expect(extractDtlsFingerprints(FIREFOX_REMOTE_SDP)).toEqual([`sha-256 ${fingerprint(2)}`]);
  });

  it("keeps distinct fingerprints for distinct algorithms and trims surrounding whitespace", () => {
    const sdp = [
      `  a=fingerprint:SHA-384 ${fingerprint(3).toLowerCase()}  `,
      `a=fingerprint:sha-256 ${fingerprint(3)}`,
      "a=fingerprint:sha-256 " + fingerprint(4),
      "",
    ].join("\n");
    expect(extractDtlsFingerprints(sdp)).toEqual([
      `sha-384 ${fingerprint(3)}`,
      `sha-256 ${fingerprint(3)}`,
      `sha-256 ${fingerprint(4)}`,
    ]);
  });

  it("returns an empty list when there is no fingerprint line", () => {
    expect(extractDtlsFingerprints("v=0\r\ns=-\r\nm=application 9 UDP/DTLS/SCTP\r\n")).toEqual([]);
    expect(extractDtlsFingerprints("")).toEqual([]);
  });
});

describe("computeTunnelPairing", () => {
  it("gives both peers the same pairId and opposite roles", async () => {
    const chrome = await computeTunnelPairing(CHROME_LOCAL_SDP, FIREFOX_REMOTE_SDP, ROOM);
    const firefox = await computeTunnelPairing(FIREFOX_REMOTE_SDP, CHROME_LOCAL_SDP, ROOM);
    expect(chrome.pairId).toBe(firefox.pairId);
    expect(chrome.localRole).not.toBe(firefox.localRole);
    expect([chrome.localRole, firefox.localRole].sort()).toEqual([0, 1]);
  });

  it("returns a 64-character lowercase hex pairId", async () => {
    expect(await pairIdOf(CHROME_LOCAL_SDP, FIREFOX_REMOTE_SDP, ROOM)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("matches the documented canonical string", async () => {
    // Independent recomputation of the canonical format from PLAN.md §5.3.
    const localSide = `sha-256 ${fingerprint(1)}`;
    const remoteSide = `sha-256 ${fingerprint(2)}`;
    const canonical = `${[localSide, remoteSide].sort().join("|")}|${ROOM}`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    const expected = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    expect(await pairIdOf(CHROME_LOCAL_SDP, FIREFOX_REMOTE_SDP, ROOM)).toBe(expected);
  });

  it("does not depend on the order of fingerprints within one SDP", async () => {
    const ordered = `a=fingerprint:sha-256 ${fingerprint(8)}\r\na=fingerprint:sha-384 ${fingerprint(9)}\r\n`;
    const reversed = `a=fingerprint:sha-384 ${fingerprint(9)}\r\na=fingerprint:sha-256 ${fingerprint(8)}\r\n`;
    expect(await pairIdOf(reversed, FIREFOX_REMOTE_SDP, ROOM)).toBe(
      await pairIdOf(ordered, FIREFOX_REMOTE_SDP, ROOM),
    );
  });

  it("differs per room", async () => {
    expect(await pairIdOf(CHROME_LOCAL_SDP, FIREFOX_REMOTE_SDP, ROOM)).not.toBe(
      await pairIdOf(CHROME_LOCAL_SDP, FIREFOX_REMOTE_SDP, OTHER_ROOM),
    );
  });

  it("differs when the local fingerprint differs", async () => {
    const changedLocal = CHROME_LOCAL_SDP.replaceAll(fingerprint(1), fingerprint(5));
    expect(await pairIdOf(changedLocal, FIREFOX_REMOTE_SDP, ROOM)).not.toBe(
      await pairIdOf(CHROME_LOCAL_SDP, FIREFOX_REMOTE_SDP, ROOM),
    );
  });

  it("differs when the remote fingerprint differs", async () => {
    const changedRemote = FIREFOX_REMOTE_SDP.replaceAll(
      fingerprint(2).toLowerCase(),
      fingerprint(6).toLowerCase(),
    ).replaceAll(fingerprint(2), fingerprint(6));
    expect(await pairIdOf(CHROME_LOCAL_SDP, changedRemote, ROOM)).not.toBe(
      await pairIdOf(CHROME_LOCAL_SDP, FIREFOX_REMOTE_SDP, ROOM),
    );
  });

  it("throws when both sides have identical fingerprints", async () => {
    await expect(computeTunnelPairing(CHROME_LOCAL_SDP, CHROME_LOCAL_SDP, ROOM)).rejects.toThrow(
      /identical sides/u,
    );
  });

  it("throws a clear error naming the side that has no fingerprint", async () => {
    const noFingerprint = "v=0\r\ns=-\r\n";
    await expect(computeTunnelPairing(noFingerprint, FIREFOX_REMOTE_SDP, ROOM)).rejects.toThrow(
      /DTLS fingerprint in the local SDP/u,
    );
    await expect(computeTunnelPairing(CHROME_LOCAL_SDP, noFingerprint, ROOM)).rejects.toThrow(
      /DTLS fingerprint in the remote SDP/u,
    );
  });

  it("rejects an empty room ID", async () => {
    await expect(computeTunnelPairing(CHROME_LOCAL_SDP, FIREFOX_REMOTE_SDP, "")).rejects.toThrow(
      /non-empty room ID/u,
    );
  });
});

describe("deriveTunnelKeys", () => {
  it("produces non-extractable AES-GCM-256 keys with one usage each", async () => {
    const { sendKey, receiveKey } = await deriveTunnelKeys(SECRET_A, PAIR, 0);
    expect(sendKey.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(receiveKey.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(sendKey.extractable).toBe(false);
    expect(receiveKey.extractable).toBe(false);
    expect(sendKey.usages).toEqual(["encrypt"]);
    expect(receiveKey.usages).toEqual(["decrypt"]);
    await expect(crypto.subtle.exportKey("raw", sendKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey("raw", receiveKey)).rejects.toThrow();
  });

  it("pairs each peer's send key with the other peer's receive key", async () => {
    const chrome = await deriveTunnelKeys(SECRET_A, PAIR, 0);
    const firefox = await deriveTunnelKeys(SECRET_A, PAIR, 1);
    const cipherChrome = new TunnelCipher(chrome);
    const cipherFirefox = new TunnelCipher(firefox);
    const frame = await cipherChrome.seal(bytes(4));
    expect(await cipherFirefox.open(frame)).toEqual(bytes(4));
    const back = await cipherFirefox.seal(bytes(4, 0x11));
    expect(await cipherChrome.open(back)).toEqual(bytes(4, 0x11));
  });

  it("derives keys that do not work across different pairIds or party secrets", async () => {
    const sealer = new TunnelCipher(await deriveTunnelKeys(SECRET_A, PAIR, 0));
    const frame = await sealer.seal(bytes(3));
    const otherPair = new TunnelCipher(await deriveTunnelKeys(SECRET_A, OTHER_PAIR, 1));
    const otherSecret = new TunnelCipher(await deriveTunnelKeys(SECRET_B, PAIR, 1));
    await expect(otherPair.open(frame)).rejects.toMatchObject({ code: "auth-failed" });
    await expect(otherSecret.open(frame)).rejects.toMatchObject({ code: "auth-failed" });
  });

  it("rejects a malformed party secret, malformed pairId, or invalid role", async () => {
    await expect(deriveTunnelKeys("not-a-secret", PAIR, 0)).rejects.toThrow(
      /party session secret/u,
    );
    await expect(deriveTunnelKeys(SECRET_A, "ABCD", 0)).rejects.toThrow(/pair ID/u);
    await expect(deriveTunnelKeys(SECRET_A, "E".repeat(64), 0)).rejects.toThrow(/pair ID/u);
    await expect(deriveTunnelKeys(SECRET_A, PAIR, 2 as never)).rejects.toThrow(
      /role must be 0 or 1/u,
    );
  });
});

describe("TunnelCipher", () => {
  it("opens frames in the order the peer sealed them", async () => {
    const { chrome, firefox } = await tunnelPair();
    const payloads = [bytes(0), bytes(13, 1), bytes(256 * 1024, 2), bytes(5, 3)];
    for (const payload of payloads) {
      expect(await firefox.open(await chrome.seal(payload))).toEqual(payload);
    }
    // And the reverse direction, with its own counter.
    expect(await chrome.open(await firefox.seal(bytes(7, 9)))).toEqual(bytes(7, 9));
  });

  it("rejects a frame echoed back to its sender", async () => {
    const { chrome } = await tunnelPair();
    const frame = await chrome.seal(bytes(8));
    await expect(chrome.open(frame)).rejects.toMatchObject({ code: "auth-failed" });
  });

  it("rejects a replayed frame", async () => {
    const { chrome, firefox } = await tunnelPair();
    const frame = await chrome.seal(bytes(8));
    expect(await firefox.open(frame)).toEqual(bytes(8));
    await expect(firefox.open(frame)).rejects.toMatchObject({ code: "auth-failed" });
  });

  it("rejects a reordered frame", async () => {
    const { chrome, firefox } = await tunnelPair();
    await chrome.seal(bytes(1));
    const second = await chrome.seal(bytes(2));
    await expect(firefox.open(second)).rejects.toMatchObject({ code: "auth-failed" });
  });

  it("rejects a frame after a skipped frame", async () => {
    const { chrome, firefox } = await tunnelPair();
    const first = await chrome.seal(bytes(1));
    await chrome.seal(bytes(2));
    const third = await chrome.seal(bytes(3));
    expect(await firefox.open(first)).toEqual(bytes(1));
    await expect(firefox.open(third)).rejects.toMatchObject({ code: "auth-failed" });
  });

  it("stays failed after an earlier failed open, even for a valid frame", async () => {
    const { chrome, firefox } = await tunnelPair();
    const first = await chrome.seal(bytes(1));
    const second = await chrome.seal(bytes(2));
    const corrupted = first.slice();
    corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1] ?? 0) ^ 0x01;
    await expect(firefox.open(corrupted)).rejects.toMatchObject({ code: "auth-failed" });
    await expect(firefox.open(first)).rejects.toMatchObject({ code: "auth-failed" });
    await expect(firefox.open(second)).rejects.toMatchObject({ code: "auth-failed" });
  });

  it("refuses to seal after an authentication failure", async () => {
    const { chrome, firefox } = await tunnelPair();
    await expect(firefox.open(bytes(40))).rejects.toMatchObject({ code: "auth-failed" });
    await expect(firefox.seal(bytes(1))).rejects.toThrow(/unusable/u);
    // The send side of the other peer is unaffected by this peer's receive failure.
    expect(await chrome.seal(bytes(1))).toBeInstanceOf(Uint8Array);
  });

  it("treats a frame shorter than IV plus tag as auth-failed", async () => {
    const { firefox } = await tunnelPair();
    await expect(firefox.open(bytes(27))).rejects.toMatchObject({ code: "auth-failed" });
  });

  it("rejects a frame where any single byte was tampered with", async () => {
    const payload = bytes(32);
    const sample = await tunnelPair();
    const frameLength = (await sample.chrome.seal(payload)).byteLength;
    for (let index = 0; index < frameLength; index += 1) {
      const { chrome, firefox } = await tunnelPair();
      const frame = await chrome.seal(payload);
      frame[index] = (frame[index] ?? 0) ^ 0x01;
      await expect(firefox.open(frame)).rejects.toMatchObject({ code: "auth-failed" });
    }
  });

  it("rejects a frame opened with the wrong secret", async () => {
    const { chrome } = await tunnelPair(SECRET_A);
    const { firefox } = await tunnelPair(SECRET_B);
    await expect(firefox.open(await chrome.seal(bytes(3)))).rejects.toBeInstanceOf(
      TunnelFrameError,
    );
  });

  it("uses a fresh IV for every seal", async () => {
    const { chrome } = await tunnelPair();
    const frames: Uint8Array[] = [];
    for (let i = 0; i < 20; i += 1) {
      frames.push(await chrome.seal(bytes(3, 9)));
    }
    const ivs = new Set(
      frames.map((frame) => Array.from(frame.subarray(0, TUNNEL_IV_BYTES)).join(",")),
    );
    expect(ivs.size).toBe(frames.length);
  });

  it("keeps sequence order for concurrent seals and opens", async () => {
    const { chrome, firefox } = await tunnelPair();
    const frames = await Promise.all([chrome.seal(bytes(1, 1)), chrome.seal(bytes(1, 2))]);
    expect(await firefox.open(frames[0])).toEqual(bytes(1, 1));
    expect(await firefox.open(frames[1])).toEqual(bytes(1, 2));

    const fresh = await tunnelPair();
    const replayed = await fresh.chrome.seal(bytes(4));
    const results = await Promise.allSettled([
      fresh.firefox.open(replayed),
      fresh.firefox.open(replayed),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
  });

  it("puts no sequence number on the wire: a binary payload of N bytes is N + 29", async () => {
    const { chrome, firefox } = await tunnelPair();
    const size = 256 * 1024;
    const frame = await chrome.seal(encodeTunnelMessage(bytes(size)));
    expect(frame.byteLength).toBe(size + TUNNEL_FRAME_OVERHEAD_BYTES);
    expect(TUNNEL_FRAME_OVERHEAD_BYTES).toBe(29);
    const decoded = decodeTunnelMessage(await firefox.open(frame));
    expect(new Uint8Array(decoded as ArrayBuffer)).toEqual(bytes(size));
  });
});

describe("TunnelCipher call order", () => {
  const BIG = 256 * 1024;
  // WebCrypto finishes a small job before a large one in most trials, so repeat
  // each scenario so that the old, unserialised code fails reliably.
  const TRIALS = 10;

  it("resolves seals in call order when a later, smaller seal finishes first", async () => {
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const { chrome } = await tunnelPair();
      const order: string[] = [];
      const big = chrome.seal(bytes(BIG, 1)).then((frame) => {
        order.push("big");
        return frame;
      });
      const small = chrome.seal(bytes(16, 2)).then((frame) => {
        order.push("small");
        return frame;
      });
      await Promise.all([big, small]);
      expect(order).toEqual(["big", "small"]);
    }
  });

  it(
    "resolves opens in call order when a later, smaller frame decrypts first",
    { timeout: 30_000 },
    async () => {
      for (let trial = 0; trial < TRIALS; trial += 1) {
        const { chrome, firefox } = await tunnelPair();
        const bigFrame = await chrome.seal(bytes(BIG, 3));
        const smallFrame = await chrome.seal(bytes(16, 4));
        const order: string[] = [];
        const big = firefox.open(bigFrame).then((plaintext) => {
          order.push("big");
          return plaintext;
        });
        const small = firefox.open(smallFrame).then((plaintext) => {
          order.push("small");
          return plaintext;
        });
        const [bigPlaintext, smallPlaintext] = await Promise.all([big, small]);
        expect(order).toEqual(["big", "small"]);
        expect(bigPlaintext).toEqual(bytes(BIG, 3));
        expect(smallPlaintext).toEqual(bytes(16, 4));
      }
    },
  );

  it("opens every frame when the wire carries them in resolution order", async () => {
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const { chrome, firefox } = await tunnelPair();
      // The "wire": frames appended in the order their seals resolved, which is
      // the order a `ws.send(await cipher.seal(x))` loop would transmit them.
      const wire: { size: number; frame: Uint8Array<ArrayBuffer> }[] = [];
      await Promise.all([
        chrome.seal(bytes(BIG, 5)).then((frame) => wire.push({ size: BIG, frame })),
        chrome.seal(bytes(16, 6)).then((frame) => wire.push({ size: 16, frame })),
        chrome.seal(bytes(64, 7)).then((frame) => wire.push({ size: 64, frame })),
      ]);
      for (const { size, frame } of wire) {
        const plaintext = await firefox.open(frame);
        expect(plaintext.byteLength).toBe(size);
      }
    }
  });

  it("rejects opens queued behind a failed open, even a valid frame", async () => {
    const { chrome, firefox } = await tunnelPair();
    const first = await chrome.seal(bytes(8));
    const second = await chrome.seal(bytes(8));
    const corrupted = first.slice();
    corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1] ?? 0) ^ 0x01;
    const results = await Promise.allSettled([firefox.open(corrupted), firefox.open(second)]);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      expect((result as PromiseRejectedResult).reason).toMatchObject({ code: "auth-failed" });
    }
  });

  it("poisons the cipher after a failed seal, so queued seals reject as unusable", async () => {
    const keys = await deriveTunnelKeys(SECRET_A, PAIR, 0);
    // A receive-only key cannot encrypt, so the seal itself fails.
    const cipher = new TunnelCipher({ sendKey: keys.receiveKey, receiveKey: keys.receiveKey });
    const results = await Promise.allSettled([cipher.seal(bytes(4)), cipher.seal(bytes(4))]);
    expect((results[0] as PromiseRejectedResult).reason.message).toMatch(/seal failed/u);
    expect((results[1] as PromiseRejectedResult).reason.message).toMatch(/unusable/u);
  });
});

describe("tunnel message encoding", () => {
  it("round-trips a string with emoji and tags it as text", () => {
    const text = "héllo 🚀 world 👋🏽";
    const encoded = encodeTunnelMessage(text);
    expect(encoded[0]).toBe(0);
    expect(decodeTunnelMessage(encoded)).toBe(text);
  });

  it("round-trips an empty string", () => {
    expect(decodeTunnelMessage(encodeTunnelMessage(""))).toBe("");
  });

  it("preserves a leading byte-order mark in a string", () => {
    const text = "﻿bom";
    expect(decodeTunnelMessage(encodeTunnelMessage(text))).toBe(text);
  });

  it("round-trips an ArrayBuffer as binary", () => {
    const buffer = new Uint8Array([0, 1, 2, 254, 255]).buffer;
    const encoded = encodeTunnelMessage(buffer);
    expect(encoded[0]).toBe(1);
    const decoded = decodeTunnelMessage(encoded);
    expect(decoded).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(decoded as ArrayBuffer)).toEqual(new Uint8Array([0, 1, 2, 254, 255]));
  });

  it("round-trips an empty binary message as a tag-only payload", async () => {
    const encoded = encodeTunnelMessage(new Uint8Array(0));
    expect(Array.from(encoded)).toEqual([1]);
    const { chrome, firefox } = await tunnelPair();
    const frame = await chrome.seal(encoded);
    expect(frame.byteLength).toBe(TUNNEL_FRAME_OVERHEAD_BYTES);
    const decoded = decodeTunnelMessage(await firefox.open(frame));
    expect(decoded).toBeInstanceOf(ArrayBuffer);
    expect((decoded as ArrayBuffer).byteLength).toBe(0);
  });

  it("encodes only the bytes of a Uint8Array view with a non-zero byteOffset", () => {
    const backing = new Uint8Array(16);
    for (let i = 0; i < backing.length; i += 1) {
      backing[i] = i;
    }
    const view = new Uint8Array(backing.buffer, 4, 6); // bytes 4..9
    const encoded = encodeTunnelMessage(view);
    expect(encoded.byteLength).toBe(1 + 6);
    const decoded = decodeTunnelMessage(encoded);
    expect(new Uint8Array(decoded as ArrayBuffer)).toEqual(new Uint8Array([4, 5, 6, 7, 8, 9]));
  });

  it("round-trips a message through encode, seal, open and decode", async () => {
    const { chrome, firefox } = await tunnelPair();
    const frame = await chrome.seal(encodeTunnelMessage("state 🎲"));
    expect(decodeTunnelMessage(await firefox.open(frame))).toBe("state 🎲");
  });

  it("rejects an empty message, an unknown tag, and invalid UTF-8 text", () => {
    const codeOf = (run: () => unknown): unknown => {
      try {
        run();
      } catch (error) {
        return errorCodeOf(error);
      }
      return "no error";
    };
    expect(codeOf(() => decodeTunnelMessage(new Uint8Array()))).toBe("malformed-message");
    expect(codeOf(() => decodeTunnelMessage(new Uint8Array([7, 1])))).toBe("malformed-message");
    expect(codeOf(() => decodeTunnelMessage(new Uint8Array([0, 0xff])))).toBe("malformed-message");
  });
});
