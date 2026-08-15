import { isValidPartyCode, normalizePartyCode } from "./code";
import { sessionSecretSchema } from "@rocketcrab/protocol";

/**
 * Invite links (ADR-0011).
 *
 * An invite link carries the private session secret in the URL FRAGMENT
 * only — never in a path segment or query parameter, because fragments are
 * the only part of a URL that is never sent to the static host (verified in
 * M2 acceptance). The four-letter code travels along so an invite joiner can
 * later serve as rendezvous greeter after migration (ADR-0004); codes are
 * public namespaces, not secrets.
 *
 * Fragment format (P2 decision):
 *
 *     https://host/join#code=ABCD&secret=<43-char-base64url>
 *
 * Host-side hygiene (import into memory, then minimize history
 * persistence): after parsing, the app should read the fragment, keep it in
 * memory, and replace the URL without the fragment
 * (`history.replaceState(null, "", pathname + search)`) so the secret does
 * not linger in browser history. P2 only defines the format; the app owns
 * the routing step.
 */

/** Invite link data parsed from a URL fragment. */
export interface InviteLinkData {
  /** Four-letter rendezvous code when the link carries one (optional). */
  readonly code?: string;
  /** Private session secret (present on every valid invite link). */
  readonly secret?: string;
}

/** Build an invite URL with the session secret in the fragment. */
export function buildInviteUrl(options: {
  readonly baseUrl: string;
  readonly code: string;
  readonly secret: string;
}): string {
  const code = normalizePartyCode(options.code);
  if (!isValidPartyCode(code)) {
    throw new Error(`buildInviteUrl: invalid party code "${options.code}".`);
  }
  const secret = sessionSecretSchema.safeParse(options.secret);
  if (!secret.success) {
    throw new Error("buildInviteUrl: invalid session secret.");
  }
  const base = options.baseUrl.replace(/#.*$/u, "");
  return `${base}#code=${encodeURIComponent(code)}&secret=${encodeURIComponent(secret.data)}`;
}

/**
 * Build a SHORT join URL: the site origin + the four-letter code as a path
 * segment (rocketcrab.com/cvvu), with NO secret — codes are public
 * rendezvous namespaces (ADR-0004), so a path segment is safe; the secret
 * must stay fragment-only (ADR-0011). The code is lowercased to match how
 * codes are displayed/typed in the UI; the route normalizes either case.
 * The full secret invite URL ({@link buildInviteUrl}) stays the primary
 * invite for the copy button and QR code; this is the typeable/shareable
 * alternative.
 */
export function buildShortJoinUrl(options: {
  /** Site root (origin), e.g. "https://rocketcrab.com" — NOT /join. */
  readonly baseUrl: string;
  /** Four-letter party code (any case). */
  readonly code: string;
}): string {
  const code = normalizePartyCode(options.code);
  if (!isValidPartyCode(code)) {
    throw new Error(`buildShortJoinUrl: invalid party code "${options.code}".`);
  }
  const base = options.baseUrl.replace(/#.*$/u, "").replace(/\/+$/u, "");
  return `${base}/${code.toLowerCase()}`;
}

/**
 * Parse an invite-link fragment (the string after `#`, with or without the
 * leading `#`). Returns null for fragments that carry no party link data or
 * fail validation (a malformed secret is rejected rather than accepted).
 */
export function parseInviteFragment(fragment: string): InviteLinkData | null {
  const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const params = new URLSearchParams(raw);
  const secret = params.get("secret");
  if (secret === null) {
    return null;
  }
  const secretCheck = sessionSecretSchema.safeParse(secret);
  if (!secretCheck.success) {
    return null;
  }
  const codeParam = params.get("code");
  const code = codeParam === null ? undefined : normalizePartyCode(codeParam);
  if (code !== undefined && !isValidPartyCode(code)) {
    return null;
  }
  return { ...(code !== undefined ? { code } : {}), secret: secretCheck.data };
}

/** Parse a full invite URL (fragment-only; query params are ignored). */
export function parseInviteUrl(url: string): InviteLinkData | null {
  const hashIndex = url.indexOf("#");
  if (hashIndex < 0) {
    return null;
  }
  return parseInviteFragment(url.slice(hashIndex));
}
