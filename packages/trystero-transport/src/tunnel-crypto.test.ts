import { describe, expect, it } from "vitest";
import {
  TUNNEL_IV_BYTES,
  TUNNEL_MIN_FRAME_BYTES,
  TunnelFrameError,
  computeTunnelPairId,
  decodeTunnelMessage,
  decryptTunnelFrame,
  deriveTunnelKey,
  encodeTunnelMessage,
  encryptTunnelFrame,
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

describe("computeTunnelPairId", () => {
  it("returns 64 lowercase hex characters", async () => {
    // Known-answer check below locks the exact canonical format.
    const pairId = await computeTunnelPairId(CHROME_LOCAL_SDP, FIREFOX_REMOTE_SDP, ROOM);
    expect(pairId).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("is identical whichever side computes it", async () => {
    const local = await computeTunnelPairId(CHROME_LOCAL_SDP, FIREFOX_REMOTE_SDP, ROOM);
    const remote = await computeTunnelPairId(FIREFOX_REMOTE_SDP, CHROME_LOCAL_SDP, ROOM);
    expect(local).toBe(remote);
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
    expect(await computeTunnelPairId(CHROME_LOCAL_SDP, FIREFOX_REMOTE_SDP, ROOM)).toBe(expected);
  });

  it("does not depend on the order of fingerprints within one SDP", async () => {
    const ordered = `a=fingerprint:sha-256 ${fingerprint(8)}\r\na=fingerprint:sha-384 ${fingerprint(9)}\r\n`;
    const reversed = `a=fingerprint:sha-384 ${fingerprint(9)}\r\na=fingerprint:sha-256 ${fingerprint(8)}\r\n`;
    expect(await computeTunnelPairId(reversed, FIREFOX_REMOTE_SDP, ROOM)).toBe(
      await computeTunnelPairId(ordered, FIREFOX_REMOTE_SDP, ROOM),
    );
  });

  it("differs per room", async () => {
    expect(await computeTunnelPairId(CHROME_LOCAL_SDP, FIREFOX_REMOTE_SDP, ROOM)).not.toBe(
      await computeTunnelPairId(CHROME_LOCAL_SDP, FIREFOX_REMOTE_SDP, OTHER_ROOM),
    );
  });

  it("differs when the local fingerprint differs", async () => {
    const changedLocal = CHROME_LOCAL_SDP.replaceAll(fingerprint(1), fingerprint(5));
    expect(await computeTunnelPairId(changedLocal, FIREFOX_REMOTE_SDP, ROOM)).not.toBe(
      await computeTunnelPairId(CHROME_LOCAL_SDP, FIREFOX_REMOTE_SDP, ROOM),
    );
  });

  it("differs when the remote fingerprint differs", async () => {
    const changedRemote = FIREFOX_REMOTE_SDP.replaceAll(
      fingerprint(2).toLowerCase(),
      fingerprint(6).toLowerCase(),
    ).replaceAll(fingerprint(2), fingerprint(6));
    expect(await computeTunnelPairId(CHROME_LOCAL_SDP, changedRemote, ROOM)).not.toBe(
      await computeTunnelPairId(CHROME_LOCAL_SDP, FIREFOX_REMOTE_SDP, ROOM),
    );
  });

  it("throws a clear error naming the side that has no fingerprint", async () => {
    const noFingerprint = "v=0\r\ns=-\r\n";
    await expect(computeTunnelPairId(noFingerprint, FIREFOX_REMOTE_SDP, ROOM)).rejects.toThrow(
      /DTLS fingerprint in the local SDP/u,
    );
    await expect(computeTunnelPairId(CHROME_LOCAL_SDP, noFingerprint, ROOM)).rejects.toThrow(
      /DTLS fingerprint in the remote SDP/u,
    );
  });

  it("rejects an empty room ID", async () => {
    await expect(computeTunnelPairId(CHROME_LOCAL_SDP, FIREFOX_REMOTE_SDP, "")).rejects.toThrow(
      /non-empty room ID/u,
    );
  });
});

describe("deriveTunnelKey", () => {
  it("produces a non-extractable AES-GCM-256 key with encrypt and decrypt usages", async () => {
    const key = await deriveTunnelKey(SECRET_A, PAIR);
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(key.extractable).toBe(false);
    expect([...key.usages].sort()).toEqual(["decrypt", "encrypt"]);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("derives interoperable keys for both sides from the same secret and pairId", async () => {
    const sender = await deriveTunnelKey(SECRET_A, PAIR);
    const receiver = await deriveTunnelKey(SECRET_A, PAIR);
    const frame = await encryptTunnelFrame(sender, new Uint8Array([1, 2, 3]));
    expect(await decryptTunnelFrame(receiver, frame)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("derives a different key for a different pairId or party secret", async () => {
    const frame = await encryptTunnelFrame(
      await deriveTunnelKey(SECRET_A, PAIR),
      new Uint8Array([7]),
    );
    await expect(
      decryptTunnelFrame(await deriveTunnelKey(SECRET_A, OTHER_PAIR), frame),
    ).rejects.toBeInstanceOf(TunnelFrameError);
    await expect(
      decryptTunnelFrame(await deriveTunnelKey(SECRET_B, PAIR), frame),
    ).rejects.toBeInstanceOf(TunnelFrameError);
  });

  it("rejects a malformed party secret and a malformed pairId", async () => {
    await expect(deriveTunnelKey("not-a-secret", PAIR)).rejects.toThrow(/party session secret/u);
    await expect(deriveTunnelKey(SECRET_A, "ABCD")).rejects.toThrow(/pair ID/u);
    await expect(deriveTunnelKey(SECRET_A, "E".repeat(64))).rejects.toThrow(/pair ID/u);
  });
});

describe("tunnel frame encryption", () => {
  const sizes = [
    ["empty", 0],
    ["small", 13],
    ["256 KiB", 256 * 1024],
  ] as const;

  for (const [label, size] of sizes) {
    it(`round-trips a ${label} payload`, async () => {
      const key = await deriveTunnelKey(SECRET_A, PAIR);
      const plaintext = new Uint8Array(size);
      for (let i = 0; i < size; i += 1) {
        plaintext[i] = i & 0xff;
      }
      const frame = await encryptTunnelFrame(key, plaintext);
      expect(frame.byteLength).toBe(TUNNEL_IV_BYTES + size + 16);
      expect(await decryptTunnelFrame(key, frame)).toEqual(plaintext);
    });
  }

  it("rejects a frame where any single byte was tampered with", async () => {
    const key = await deriveTunnelKey(SECRET_A, PAIR);
    const frame = await encryptTunnelFrame(key, new Uint8Array(32).fill(0x5a));
    for (let index = 0; index < frame.byteLength; index += 1) {
      const tampered = frame.slice();
      tampered[index] = (tampered[index] ?? 0) ^ 0x01;
      await expect(decryptTunnelFrame(key, tampered)).rejects.toMatchObject({
        code: "auth-failed",
      });
    }
  });

  it("rejects a frame decrypted with the wrong key", async () => {
    const frame = await encryptTunnelFrame(
      await deriveTunnelKey(SECRET_A, PAIR),
      new Uint8Array([1, 2, 3]),
    );
    await expect(
      decryptTunnelFrame(await deriveTunnelKey(SECRET_B, PAIR), frame),
    ).rejects.toBeInstanceOf(TunnelFrameError);
  });

  it("rejects a frame shorter than IV plus tag as short-frame", async () => {
    const key = await deriveTunnelKey(SECRET_A, PAIR);
    for (let length = 0; length < TUNNEL_MIN_FRAME_BYTES; length += 1) {
      await expect(decryptTunnelFrame(key, new Uint8Array(length))).rejects.toMatchObject({
        code: "short-frame",
      });
    }
  });

  it("treats a minimum-length frame with garbage as auth-failed, not short", async () => {
    const key = await deriveTunnelKey(SECRET_A, PAIR);
    await expect(
      decryptTunnelFrame(key, new Uint8Array(TUNNEL_MIN_FRAME_BYTES)),
    ).rejects.toMatchObject({ code: "auth-failed" });
  });

  it("uses a fresh IV for every call", async () => {
    const key = await deriveTunnelKey(SECRET_A, PAIR);
    const plaintext = new Uint8Array([9, 9, 9]);
    const frames: Uint8Array[] = [];
    for (let i = 0; i < 20; i += 1) {
      frames.push(await encryptTunnelFrame(key, plaintext));
    }
    const ivs = new Set(
      frames.map((frame) => Array.from(frame.subarray(0, TUNNEL_IV_BYTES)).join(",")),
    );
    expect(ivs.size).toBe(frames.length);
    expect(new Set(frames.map((frame) => Array.from(frame).join(","))).size).toBe(frames.length);
  });
});

describe("tunnel message encoding", () => {
  it("round-trips a string with emoji and tags it as text", async () => {
    const text = "héllo 🚀 world 👋🏽";
    const encoded = encodeTunnelMessage(text);
    expect(encoded[0]).toBe(0);
    expect(decodeTunnelMessage(encoded)).toBe(text);
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

  it("round-trips a message through encode, encrypt, decrypt and decode", async () => {
    const key = await deriveTunnelKey(SECRET_A, PAIR);
    const frame = await encryptTunnelFrame(key, encodeTunnelMessage("state 🎲"));
    expect(decodeTunnelMessage(await decryptTunnelFrame(key, frame))).toBe("state 🎲");
  });

  it("rejects an empty message, an unknown tag, and invalid UTF-8 text", () => {
    const codeOf = (run: () => unknown): unknown => {
      try {
        run();
      } catch (error) {
        return error instanceof TunnelFrameError ? error.code : error;
      }
      return "no error";
    };
    expect(codeOf(() => decodeTunnelMessage(new Uint8Array()))).toBe("malformed-message");
    expect(codeOf(() => decodeTunnelMessage(new Uint8Array([7, 1])))).toBe("malformed-message");
    expect(codeOf(() => decodeTunnelMessage(new Uint8Array([0, 0xff])))).toBe("malformed-message");
  });
});
