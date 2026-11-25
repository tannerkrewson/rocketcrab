/** The shell persists the player name. Trystero manages the party identity. */

const MEMBER_PREFIX = "member-";
const IDENTITY_KEY = "nova:party:identity:v1";
/** The player-chosen name, stored separately so it survives identity resets. */
const PLAYER_NAME_KEY = "nova:player:name:v1";

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

export interface PartyIdentity {
  readonly memberId: string;
  readonly displayName: string;
}

let cachedIdentity: PartyIdentity | null = null;

/** A page-local placeholder until Trystero supplies the party member ID. */
export function localPartyIdentity(): PartyIdentity {
  if (cachedIdentity === null) {
    const memberId = generateMemberId();
    cachedIdentity = {
      memberId,
      displayName: getSavedPlayerName() ?? `Player ${memberId.slice(-4).toUpperCase()}`,
    };
  }
  return cachedIdentity;
}

/** Saved display name, or null when never set. */
export function getSavedPlayerName(): string | null {
  try {
    // Older clients persisted a name alongside a self-assigned member ID.
    const legacy = window.localStorage.getItem(IDENTITY_KEY);
    if (legacy !== null) {
      window.localStorage.removeItem(IDENTITY_KEY);
      try {
        const name = (JSON.parse(legacy) as { displayName?: unknown } | null)?.displayName;
        if (typeof name === "string" && window.localStorage.getItem(PLAYER_NAME_KEY) === null) {
          setSavedPlayerName(name);
        }
      } catch {
        // A malformed legacy record has no usable name.
      }
    }
    const raw = window.localStorage.getItem(PLAYER_NAME_KEY);
    if (raw === null) {
      return null;
    }
    const trimmed = raw.trim();
    return trimmed.length === 0 ? null : trimmed;
  } catch {
    return null;
  }
}

export function setSavedPlayerName(name: string): void {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return;
  }
  try {
    window.localStorage.setItem(PLAYER_NAME_KEY, trimmed);
  } catch {
    // Storage unavailable — the name just won't survive this page.
  }
}

/**
 * Apply a display-name change: persist it and update the cached identity so
 * the current page (and future loads) use the new name immediately.
 */
export function updatePartyDisplayName(name: string): PartyIdentity | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return null;
  }
  setSavedPlayerName(trimmed);
  const identity = localPartyIdentity();
  const updated: PartyIdentity = { memberId: identity.memberId, displayName: trimmed };
  cachedIdentity = updated;
  return updated;
}

/** Test-only reset so each test starts with a fresh identity (and name). */
export function resetPartyIdentityForTests(): void {
  cachedIdentity = null;
  try {
    window.localStorage.removeItem(IDENTITY_KEY);
    window.localStorage.removeItem(PLAYER_NAME_KEY);
  } catch {
    // Storage unavailable — nothing to reset.
  }
}
