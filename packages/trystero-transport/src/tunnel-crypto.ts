/**
 * Tunnel pairing, directional frame encryption and message encoding for the
 * WebSocket fallback (PLAN.md §5.3–§5.4). These are pure helpers: nothing in
 * the transport calls them yet (the wrapper is §5.5 and wiring is §5.6).
 *
 * Canonical parameters (the edge Worker and any future server-side check must
 * agree on these exactly; see PLAN.md §5.3–§5.4):
 *
 * - Fingerprint value: `<algorithm lowercased> <hex uppercased>`, e.g.
 *   `sha-256 AB:CD:…`. Deduplicated per SDP.
 * - Side string: the SDP's fingerprint values, sorted and joined with `,`.
 * - pairId: the two side strings are sorted and joined with `|`, then `|` +
 *   roomId. The UTF-8 bytes are hashed with SHA-256 and rendered as 64
 *   lowercase hex characters.
 * - localRole: the index (0 or 1) of the LOCAL side string in that sorted
 *   pair. The two peers always get opposite roles. Identical side strings
 *   have no valid roles and throw.
 * - Keys: HKDF-SHA-256 over the UTF-8 bytes of the party session secret (the
 *   string `secrets.ts` hashes), salt = UTF-8 bytes of the pairId, info =
 *   `"rocketcrab tunnel v1 dir 0"` or `"rocketcrab tunnel v1 dir 1"`, output
 *   non-extractable AES-GCM-256. A peer's send key is `dir <localRole>` and its
 *   receive key is `dir <1 - localRole>`, so each direction has its own key.
 *   Send keys carry only `encrypt` usage and receive keys only `decrypt`.
 * - Frame: 12-byte random IV ‖ AES-GCM ciphertext (which carries the 16-byte
 *   tag). The IV is random. The sequence number is not on the wire.
 * - Sequence: each direction counts its frames from 0 as a 64-bit big-endian
 *   value, which is the AES-GCM additional data (AAD). The receiver expects
 *   the next number and opens with it, so a replayed, reflected, reordered or
 *   skipped frame fails. The tunnel is ordered and reliable, so any failure is
 *   fatal: `TunnelCipher` refuses all further use and the caller must close the
 *   tunnel.
 * - Message: 1-byte type tag (0 = UTF-8 string, 1 = binary) ‖ payload. Wire
 *   overhead for a binary message is `TUNNEL_FRAME_OVERHEAD_BYTES` (29).
 */
import { sessionSecretSchema, type SessionSecret } from "@rocketcrab/protocol";

/** AES-GCM IV length prepended to every frame. */
export const TUNNEL_IV_BYTES = 12;
/** AES-GCM authentication tag length (WebCrypto default, 128 bits). */
export const TUNNEL_TAG_BYTES = 16;
/**
 * Wire overhead added to a binary payload: 1 message type tag + 12-byte IV +
 * 16-byte GCM tag. A binary payload of N bytes becomes exactly N + 29 bytes.
 */
export const TUNNEL_FRAME_OVERHEAD_BYTES = 1 + TUNNEL_IV_BYTES + TUNNEL_TAG_BYTES;

/** Position of a peer in its pairing. The two peers always differ. */
export type TunnelRole = 0 | 1;

/** Failure to decode or authenticate a tunnel frame or message. */
export type TunnelFrameErrorCode = "auth-failed" | "malformed-message";

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
const SEQUENCE_MAX = (1n << 64n) - 1n;

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
 * Compute the pair ID and this peer's role. Both sides call this with their
 * own local and remote SDP. They get the same pairId and opposite localRoles,
 * with no signaling. See the module header for the canonical format.
 */
export async function computeTunnelPairing(
  localSdp: string,
  remoteSdp: string,
  roomId: string,
): Promise<{ pairId: string; localRole: TunnelRole }> {
  if (roomId.length === 0) {
    throw new Error("Tunnel pairing needs a non-empty room ID.");
  }
  const local = canonicalFingerprintSide(localSdp, "local");
  const remote = canonicalFingerprintSide(remoteSdp, "remote");
  if (local === remote) {
    throw new Error(
      "Tunnel pairing needs distinct local and remote DTLS fingerprints; identical sides cannot be assigned opposite roles.",
    );
  }
  const sides = [local, remote].sort();
  const localRole: TunnelRole = sides[0] === local ? 0 : 1;
  const canonical = `${sides.join("|")}|${roomId}`;
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(canonical));
  return { pairId: toHex(new Uint8Array(digest)), localRole };
}

function canonicalFingerprintSide(sdp: string, side: "local" | "remote"): string {
  const fingerprints = extractDtlsFingerprints(sdp);
  if (fingerprints.length === 0) {
    throw new Error(`Tunnel pairing needs a DTLS fingerprint in the ${side} SDP.`);
  }
  return [...fingerprints].sort().join(",");
}

/**
 * Derive the send and receive keys for one peer. The send key is direction
 * `localRole` and the receive key is direction `1 - localRole`. Both keys are
 * non-extractable.
 */
export async function deriveTunnelKeys(
  partySecretMaterial: SessionSecret,
  pairId: string,
  localRole: TunnelRole,
): Promise<{ sendKey: CryptoKey; receiveKey: CryptoKey }> {
  if (!sessionSecretSchema.safeParse(partySecretMaterial).success) {
    throw new Error("Tunnel keys need a well-formed party session secret.");
  }
  if (!/^[0-9a-f]{64}$/u.test(pairId)) {
    throw new Error("Tunnel keys need a 64-character lowercase hex pair ID.");
  }
  if (localRole !== 0 && localRole !== 1) {
    throw new Error("Tunnel role must be 0 or 1.");
  }
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(partySecretMaterial),
    "HKDF",
    false,
    ["deriveKey"],
  );
  const remoteRole: TunnelRole = localRole === 0 ? 1 : 0;
  const [sendKey, receiveKey] = await Promise.all([
    deriveDirectionalKey(base, pairId, localRole, ["encrypt"]),
    deriveDirectionalKey(base, pairId, remoteRole, ["decrypt"]),
  ]);
  return { sendKey, receiveKey };
}

function deriveDirectionalKey(
  base: CryptoKey,
  pairId: string,
  direction: TunnelRole,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(pairId),
      info: encoder.encode(`rocketcrab tunnel v1 dir ${direction}`),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

/**
 * Seals outgoing frames and opens incoming ones for one tunnel. Each
 * direction has its own sequence counter, which is the AES-GCM AAD.
 *
 * Operations in each direction run strictly one at a time, in call order. A
 * later call starts only after the earlier one in its direction has settled,
 * and the sequence number is claimed when it starts. So the promises resolve
 * in call order, and `ws.send(await cipher.seal(x))` in call order sends frames
 * in sequence even when a large frame finishes encrypting after a small one.
 *
 * Any failure poisons the whole cipher, including a failed `seal`, whose
 * sequence number is already consumed. Every operation that starts afterwards
 * rejects. The caller must close the tunnel. Instances are not shared between
 * tunnels.
 */
export class TunnelCipher {
  private readonly sendKey: CryptoKey;
  private readonly receiveKey: CryptoKey;
  private sendSequence = 0n;
  private receiveSequence = 0n;
  private failed = false;
  private sendQueue: Promise<unknown> = Promise.resolve();
  private receiveQueue: Promise<unknown> = Promise.resolve();

  constructor(keys: { sendKey: CryptoKey; receiveKey: CryptoKey }) {
    this.sendKey = keys.sendKey;
    this.receiveKey = keys.receiveKey;
  }

  /**
   * Encrypt one plaintext into a frame: 12-byte random IV ‖ ciphertext+tag.
   * Resolves in call order with all other `seal` calls.
   */
  seal(plaintext: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    const run = this.sendQueue.then(() => this.sealNow(plaintext));
    this.sendQueue = run.catch(() => undefined);
    return run;
  }

  /**
   * Authenticate and decrypt the next expected incoming frame. Resolves in
   * call order with all other `open` calls. Throws `TunnelFrameError` with code
   * `auth-failed` for any failure, including a short frame, a replayed,
   * reflected, reordered or skipped frame, or a frame that starts after an
   * earlier failure.
   */
  open(frame: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    const run = this.receiveQueue.then(() => this.openNow(frame));
    this.receiveQueue = run.catch(() => undefined);
    return run;
  }

  private async sealNow(plaintext: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    if (this.failed) {
      throw new Error(
        "Tunnel cipher is unusable after an authentication failure; close the tunnel.",
      );
    }
    if (this.sendSequence > SEQUENCE_MAX) {
      throw new Error("Tunnel send sequence is exhausted; close the tunnel.");
    }
    const sequence = this.sendSequence;
    this.sendSequence += 1n;
    try {
      const iv = crypto.getRandomValues(new Uint8Array(TUNNEL_IV_BYTES));
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData: sequenceAad(sequence) },
          this.sendKey,
          plaintext,
        ),
      );
      const frame = new Uint8Array(TUNNEL_IV_BYTES + ciphertext.byteLength);
      frame.set(iv, 0);
      frame.set(ciphertext, TUNNEL_IV_BYTES);
      return frame;
    } catch (cause) {
      // The sequence number is spent but no frame went out, so the peer would
      // see a gap. The tunnel cannot continue.
      this.failed = true;
      throw new Error("Tunnel seal failed; close the tunnel.", { cause });
    }
  }

  private async openNow(frame: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    if (this.failed) {
      throw authFailed("Tunnel was already closed by an earlier authentication failure.");
    }
    const sequence = this.receiveSequence;
    this.receiveSequence += 1n;
    try {
      if (frame.byteLength < TUNNEL_IV_BYTES + TUNNEL_TAG_BYTES) {
        throw new RangeError(`Tunnel frame is ${frame.byteLength} bytes.`);
      }
      const iv = frame.subarray(0, TUNNEL_IV_BYTES);
      const sealed = frame.subarray(TUNNEL_IV_BYTES);
      return new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv, additionalData: sequenceAad(sequence) },
          this.receiveKey,
          sealed,
        ),
      );
    } catch (cause) {
      this.failed = true;
      throw authFailed("Tunnel frame failed authentication; close the tunnel.", cause);
    }
  }
}

function authFailed(message: string, cause?: unknown): TunnelFrameError {
  return new TunnelFrameError("auth-failed", message, cause === undefined ? undefined : { cause });
}

/** 64-bit big-endian sequence number, used as the AES-GCM additional data. */
function sequenceAad(sequence: bigint): Uint8Array<ArrayBuffer> {
  if (sequence < 0n || sequence > SEQUENCE_MAX) {
    throw new RangeError("Tunnel sequence is out of range.");
  }
  const aad = new Uint8Array(8);
  new DataView(aad.buffer).setBigUint64(0, sequence, false);
  return aad;
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
