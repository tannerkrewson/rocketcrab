/**
 * Page-lifetime party identity (P4; ADR-0007).
 *
 * The shell assigns every player a stable member identity for the party
 * plane. The identity is generated once per page load and reused for every
 * party this browser tab joins (so a reconnect/rejoin keeps the same
 * memberId); the display name is a short, distinct player name announced to
 * peers through the transport handshake.
 */

const MEMBER_PREFIX = "member-";

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

/** This page's party identity, generated once and reused for the session. */
export function localPartyIdentity(): PartyIdentity {
  if (cachedIdentity === null) {
    const memberId = generateMemberId();
    cachedIdentity = {
      memberId,
      displayName: `Player ${memberId.slice(-4).toUpperCase()}`,
    };
  }
  return cachedIdentity;
}
