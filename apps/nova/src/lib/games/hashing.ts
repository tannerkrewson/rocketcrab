import type { Sha256 } from "@rocketcrab/protocol";

const encoder = new TextEncoder();

/** SHA-256 of UTF-8 game source as 64 lowercase hex characters (protocol sha256Schema). */
export async function hashSource(source: string): Promise<Sha256> {
  const bytes = encoder.encode(source);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

/** UTF-8 byte length for protocol size limits; not JavaScript string length. */
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
