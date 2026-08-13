/**
 * Editor → party source handoff (P4 "create party from current editor
 * source").
 *
 * The editor's Play-with-friends action stores the CURRENT editor source
 * (which may be unsaved) in sessionStorage before navigating to the party
 * route; the party route picks it up when the stored gameId matches,
 * falling back to the saved game source otherwise. Same pattern (and TTL
 * policy) as the draft-source handoff (7.40: the arena handoff was removed
 * when the arena moved onto the editor page).
 */
const STORAGE_KEY = "nova:party-source:v1";
export const PARTY_SOURCE_TTL_MS = 30 * 60 * 1000;

interface PartySourceEntry {
  gameId: string;
  source: string;
  updatedAt: number;
}

/** Store the current editor source for a party (best effort). */
export function storePartySource(input: { gameId: string; source: string }): void {
  try {
    const entry: PartySourceEntry = { ...input, updatedAt: Date.now() };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // sessionStorage unavailable (private mode): the party route falls back
    // to the saved game source.
  }
}

/** Read a fresh handoff entry for the given gameId, or null. */
export function takePartySource(gameId: string): string | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<PartySourceEntry>;
    if (
      typeof parsed.gameId !== "string" ||
      typeof parsed.source !== "string" ||
      typeof parsed.updatedAt !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.updatedAt > PARTY_SOURCE_TTL_MS) {
      return null;
    }
    return parsed.gameId === gameId ? parsed.source : null;
  } catch {
    return null;
  }
}

/** Test-only reset so each test imports a fresh handoff. */
export function resetPartySourceForTests(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // sessionStorage unavailable (private mode): nothing to reset.
  }
}
