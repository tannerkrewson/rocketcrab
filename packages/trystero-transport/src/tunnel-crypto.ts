/**
 * Tunnel pair identity, frame encryption and message encoding for the
 * WebSocket fallback (PLAN.md §5.3–§5.4). These are pure helpers: nothing in
 * the transport calls them yet (the wrapper is §5.5 and wiring is §5.6).
 *
 * Canonical parameters (the edge Worker and any future server-side check must
 * agree on these exactly; see PLAN.md §5.3–§5.4):
 *
 * - Fingerprint value: `<algorithm lowercased> <hex uppercased>`, e.g.
 *   `sha-256 AB:CD:…`. Deduplicated per SDP.
 * - pairId: each side's fingerprints are sorted and joined with `,`; the two
 *   side strings are sorted and joined with `|`; then `|` + roomId. The UTF-8
 *   bytes are hashed with SHA-256 and rendered as 64 lowercase hex characters.
 * - Tunnel key: HKDF-SHA-256 over the UTF-8 bytes of the party session secret
 *   (the same string `secrets.ts` hashes), with salt = UTF-8 bytes of the
 *   pairId and info = `"rocketcrab tunnel v1"`, producing a non-extractable
 *   AES-GCM-256 key with usages `encrypt` and `decrypt`. The `secrets.ts`
 *   room/password/session labels are SHA-256 with different labels, so the
 *   tunnel derivation is domain-separated from them.
 * - Frame: 12-byte random IV ‖ AES-GCM ciphertext (which carries the 16-byte
 *   tag). Minimum frame length is 28 bytes.
 * - Message: 1-byte type tag (0 = UTF-8 string, 1 = binary) ‖ payload.
 */
import { sessionSecretSchema, type SessionSecret } from "@rocketcrab/protocol";

/** HKDF `info` for the tunnel key. Domain-separates it from `secrets.ts`. */
export const TUNNEL_HKDF_INFO = "rocketcrab tunnel v1";
/** AES-GCM IV length prepended to every frame. */
export const TUNNEL_IV_BYTES = 12;
/** AES-GCM authentication tag length (WebCrypto default, 128 bits). */
export const TUNNEL_TAG_BYTES = 16;
/** Smallest possible frame: an IV and an empty ciphertext's tag. */
export const TUNNEL_MIN_FRAME_BYTES = TUNNEL_IV_BYTES + TUNNEL_TAG_BYTES;

/** Failure to decode or decrypt a tunnel frame or message. */
export type TunnelFrameErrorCode = "short-frame" | "auth-failed" | "malformed-message";

export class TunnelFrameError extends Error {
  readonly code: TunnelFrameErrorCode;

  constructor(code: TunnelFrameErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TunnelFrameError";
    this.code = code;
  }
}

const TEXT_TAG = 0;
const BINARY_TAG = 1;

const encoder = new TextEncoder();

/**
 * Extract DTLS fingerprints from an SDP, from both session-level and
 * media-level `a=fingerprint:` lines. Each value is normalised to
 * `<algorithm lowercased> <hex uppercased>` and the result is deduplicated,
 * preserving first-seen order. Returns `[]` when the SDP has none.
 */
export function extractDtlsFingerprints(sdp: string): string[] {
  const seen = new Set<string>();
  for (const rawLine of sdp.split(/\r?\n/u)) {
    const match = /^a=fingerprint:(\S+)\s+(\S+)$/u.exec(rawLine.trim());
    if (!match) {
      continue;
    }
    const [, algorithm = "", hex = ""] = match;
    seen.add(`${algorithm.toLowerCase()} ${hex.toUpperCase()}`);
  }
  return [...seen];
}

/**
 * Compute the tunnel pair ID for one peer connection. Both sides call this
 * with their own local and remote SDP and get the same result, so the pairId
 * needs no signaling. See the module header for the canonical format.
 */
export async function computeTunnelPairId(
  localSdp: string,
  remoteSdp: string,
  roomId: string,
): Promise<string> {
  if (roomId.length === 0) {
    throw new Error("Tunnel pair ID needs a non-empty room ID.");
  }
  const local = canonicalFingerprintSide(localSdp, "local");
  const remote = canonicalFingerprintSide(remoteSdp, "remote");
  const canonical = `${[local, remote].sort().join("|")}|${roomId}`;
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(canonical));
  return toHex(new Uint8Array(digest));
}

function canonicalFingerprintSide(sdp: string, side: "local" | "remote"): string {
  const fingerprints = extractDtlsFingerprints(sdp);
  if (fingerprints.length === 0) {
    throw new Error(`Tunnel pair ID needs a DTLS fingerprint in the ${side} SDP.`);
  }
  return [...fingerprints].sort().join(",");
}

/**
 * Derive the AES-GCM-256 tunnel key for one pair. The key is non-extractable.
 * Both sides derive the same key from the same party secret and pairId.
 */
export async function deriveTunnelKey(
  partySecretMaterial: SessionSecret,
  pairId: string,
): Promise<CryptoKey> {
  if (!sessionSecretSchema.safeParse(partySecretMaterial).success) {
    throw new Error("Tunnel key needs a well-formed party session secret.");
  }
  if (!/^[0-9a-f]{64}$/u.test(pairId)) {
    throw new Error("Tunnel key needs a 64-character lowercase hex pair ID.");
  }
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(partySecretMaterial),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(pairId),
      info: encoder.encode(TUNNEL_HKDF_INFO),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt one plaintext into a frame: 12-byte random IV ‖ ciphertext+tag. */
export async function encryptTunnelFrame(
  key: CryptoKey,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(TUNNEL_IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  const frame = new Uint8Array(TUNNEL_IV_BYTES + ciphertext.byteLength);
  frame.set(iv, 0);
  frame.set(ciphertext, TUNNEL_IV_BYTES);
  return frame;
}

/**
 * Decrypt a frame produced by `encryptTunnelFrame`. Throws `TunnelFrameError`
 * with code `short-frame` when the frame cannot hold an IV and tag, and with
 * code `auth-failed` for any decryption failure (tampering, wrong key, or
 * a key without decrypt usage).
 */
export async function decryptTunnelFrame(
  key: CryptoKey,
  frame: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (frame.byteLength < TUNNEL_MIN_FRAME_BYTES) {
    throw new TunnelFrameError(
      "short-frame",
      `Tunnel frame is ${frame.byteLength} bytes; at least ${TUNNEL_MIN_FRAME_BYTES} are required.`,
    );
  }
  const iv = frame.subarray(0, TUNNEL_IV_BYTES);
  const sealed = frame.subarray(TUNNEL_IV_BYTES);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, sealed));
  } catch (cause) {
    throw new TunnelFrameError("auth-failed", "Tunnel frame failed authentication.", { cause });
  }
}

/**
 * Encode a data-channel payload before encryption. Strings become UTF-8 with
 * tag 0; binary becomes tag 1. For an ArrayBufferView, only the view's own
 * bytes (from `byteOffset`, length `byteLength`) are included.
 */
export function encodeTunnelMessage(
  data: string | ArrayBuffer | ArrayBufferView,
): Uint8Array<ArrayBuffer> {
  if (typeof data === "string") {
    return withTypeTag(TEXT_TAG, encoder.encode(data));
  }
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  return withTypeTag(BINARY_TAG, bytes);
}

/**
 * Decode a payload produced by `encodeTunnelMessage`. Returns a string for tag
 * 0 and a fresh ArrayBuffer (exactly the payload bytes) for tag 1. Throws
 * `TunnelFrameError` with code `malformed-message` for an empty input, an
 * unknown tag, or invalid UTF-8.
 */
export function decodeTunnelMessage(bytes: Uint8Array): string | ArrayBuffer {
  if (bytes.byteLength === 0) {
    throw new TunnelFrameError("malformed-message", "Tunnel message is empty.");
  }
  const tag = bytes[0];
  const body = bytes.subarray(1);
  if (tag === TEXT_TAG) {
    try {
      // ignoreBOM keeps a leading U+FEFF so the round trip is exact.
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
    } catch (cause) {
      throw new TunnelFrameError("malformed-message", "Tunnel text is not valid UTF-8.", {
        cause,
      });
    }
  }
  if (tag === BINARY_TAG) {
    const copy = new Uint8Array(body.byteLength);
    copy.set(body);
    return copy.buffer;
  }
  throw new TunnelFrameError("malformed-message", `Unknown tunnel message tag ${String(tag)}.`);
}

function withTypeTag(tag: number, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(body.byteLength + 1);
  out[0] = tag;
  out.set(body, 1);
  return out;
}

const HEX_DIGITS = "0123456789abcdef";

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += HEX_DIGITS.charAt(byte >> 4) + HEX_DIGITS.charAt(byte & 0x0f);
  }
  return out;
}
