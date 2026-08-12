import type { SessionId, SessionSecret } from "@rocketcrab/protocol";
import { sessionSecretSchema } from "@rocketcrab/protocol";

/**
 * Party session secrets and derivation (ADR-0004, ADR-0011).
 *
 * The creator generates one 32-byte CSPRNG session secret. Everything about
 * the private party room is DERIVED from that secret with Web Crypto
 * (SHA-256 with domain-separated labels), so the secret is the only private
 * material that ever has to move: from creator to admitted joiner over the
 * encrypted peer connection, and inside invite-link fragments (ADR-0011).
 * The four-letter code is never a secret (ADR-0004), and the derived
 * room/password/session never need to be transmitted at all — every side
 * derives them locally from the secret.
 *
 * Derivation scheme (P2 decision): for each label L,
 * `material = SHA-256(label || 0x00 || secret)`. The 0x00 separator keeps
 * label/secret concatenations unambiguous; SHA-256 over a high-entropy
 * secret with domain separation is sufficient here (the secret already has
 * full entropy — no key expansion needed), and `crypto.subtle` is available
 * in every secure context Nova runs in (F5 finding F9).
 *
 * - `roomId`    — the Trystero room name of the private party room,
 *                 `party:` + 64 lowercase hex chars (256 bits).
 * - `password`  — the Trystero room password, 32 bytes as unpadded
 *                 base64url (43 chars; F8: wrong password → JoinError).
 * - `sessionId` — the private session ID carried in every post-admission
 *                 peer message, 64 lowercase hex chars.
 */

/** Session secret size: 32 bytes = 256 bits of entropy. */
export const SESSION_SECRET_BYTES = 32;

/** Derived private-room credential material. */
export interface SessionMaterial {
  /** The raw session secret the rest is derived from. */
  readonly secret: SessionSecret;
  /** Private Trystero room name (high-entropy; never advertised). */
  readonly roomId: string;
  /** Private Trystero room password (derived; never advertised). */
  readonly password: string;
  /** Private session ID for post-admission peer messages. */
  readonly sessionId: SessionId;
}

/** Generate a new CSPRNG session secret (32 bytes, unpadded base64url). */
export function generateSessionSecret(): SessionSecret {
  const bytes = new Uint8Array(SESSION_SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/**
 * Derive the private room material from a session secret. Deterministic:
 * the same secret always derives the same roomId/password/sessionId, so the
 * creator, admitted joiners, and invite-link joiners all converge without
 * ever exchanging the derived values.
 */
export async function deriveSessionMaterial(secret: SessionSecret): Promise<SessionMaterial> {
  const parsed = sessionSecretSchema.safeParse(secret);
  if (!parsed.success) {
    throw new Error(
      `Party session secret is malformed (expected ${SESSION_SECRET_BYTES} bytes of unpadded base64url).`,
    );
  }
  const roomId = await deriveHex("nova-party-room", secret);
  const password = await deriveBase64Url("nova-party-password", secret);
  const sessionId = await deriveHex("nova-party-session", secret);
  return { secret, roomId: `party:${roomId}`, password, sessionId };
}

// ---------------------------------------------------------------------------
// Derivation internals
// ---------------------------------------------------------------------------

/** SHA-256(label || 0x00 || secret) as lowercase hex (64 chars). */
async function deriveHex(label: string, secret: string): Promise<string> {
  const digest = await sha256(domainSeparated(label, secret));
  return toHex(new Uint8Array(digest));
}

/** SHA-256(label || 0x00 || secret) as unpadded base64url (43 chars). */
async function deriveBase64Url(label: string, secret: string): Promise<string> {
  const digest = await sha256(domainSeparated(label, secret));
  return bytesToBase64Url(new Uint8Array(digest));
}

/** Concatenate label bytes, a 0x00 separator, and the secret bytes. */
function domainSeparated(label: string, secret: string): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const labelBytes = encoder.encode(label);
  const secretBytes = encoder.encode(secret);
  const joined = new Uint8Array(labelBytes.byteLength + 1 + secretBytes.byteLength);
  joined.set(labelBytes, 0);
  joined.set([0], labelBytes.byteLength);
  joined.set(secretBytes, labelBytes.byteLength + 1);
  return joined;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", bytes);
}

/** Unpadded base64url encoding (no `=`, URL-safe alphabet). */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/=+$/u, "").replace(/\+/gu, "-").replace(/\//gu, "_");
}

const HEX_DIGITS = "0123456789abcdef";

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += HEX_DIGITS.charAt(byte >> 4) + HEX_DIGITS.charAt(byte & 0x0f);
  }
  return out;
}
