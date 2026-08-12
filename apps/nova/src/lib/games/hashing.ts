import type { Sha256 } from "@rocketcrab/protocol";

const encoder = new TextEncoder();

/**
 * SHA-256 digest of a game's HTML source as 64 lowercase hex characters
 * (ADR-0005: Web Crypto for hashing; protocol `sha256Schema` shape). Hashes
 * are deterministic: the same source always produces the same digest.
 */
export async function hashSource(source: string): Promise<Sha256> {
  const bytes = encoder.encode(source);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * UTF-8 byte length of the source, matching the protocol's byte-limit
 * semantics (F6 `htmlSourceBytes`): multi-byte characters count as their
 * encoded size, not their string length.
 */
export function sourceByteLength(source: string): number {
  return encoder.encode(source).byteLength;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
