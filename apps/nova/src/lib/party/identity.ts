/**
 * Page-lifetime party identity (P4; ADR-0007).
 *
 * The shell assigns every player a stable member identity for the party
 * plane. The identity is generated once per browser and reused across page
 * loads (persisted locally): a reconnect/rejoin after a Mobile Safari
 * reload keeps the same memberId, so the party sees the same player come
 * back rather than a stranger (M1; ADR-0012). The display name is a short,
 * distinct player name announced to peers through the transport handshake.
 */

const MEMBER_PREFIX = "member-";
const IDENTITY_KEY = "nova:party:identity:v1";

function randomHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

function generateMemberId(): string {
  return `${MEMBER_PREFIX}${randomHex(8)}`;
}

/** A party member identity (stable memberId + player-facing display name). */
export interface PartyIdentity {
  readonly memberId: string;
  readonly displayName: string;
}

let cachedIdentity: PartyIdentity | null = null;

/** Read a persisted identity, or null when absent/corrupt. */
function readStoredIdentity(): PartyIdentity | null {
  try {
    const raw = window.localStorage.getItem(IDENTITY_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PartyIdentity>;
    if (
      typeof parsed.memberId !== "string" ||
      parsed.memberId.length === 0 ||
      typeof parsed.displayName !== "string" ||
      parsed.displayName.length === 0
    ) {
      return null;
    }
    return { memberId: parsed.memberId, displayName: parsed.displayName };
  } catch {
    return null;
  }
}

/**
 * This page's party identity, generated once per browser and reused across
 * page loads so reconnects/rejoins keep the same memberId (ADR-0007).
 */
export function localPartyIdentity(): PartyIdentity {
  if (cachedIdentity === null) {
    cachedIdentity = readStoredIdentity();
  }
  if (cachedIdentity !== null) {
    return cachedIdentity;
  }
  const memberId = generateMemberId();
  const identity: PartyIdentity = {
    memberId,
    displayName: `Player ${memberId.slice(-4).toUpperCase()}`,
  };
  cachedIdentity = identity;
  try {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    // Storage unavailable (private mode): the identity lives for this page.
  }
  return identity;
}

/** Test-only reset so each test starts with a fresh identity. */
export function resetPartyIdentityForTests(): void {
  cachedIdentity = null;
  try {
    window.localStorage.removeItem(IDENTITY_KEY);
  } catch {
    // Storage unavailable — nothing to reset.
  }
}
