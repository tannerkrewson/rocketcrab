/**
 * Generator → editor draft source handoff (A4).
 *
 * The /build generator's paste target stores pasted game HTML as an
 * unsaved draft in sessionStorage before navigating to the editor; the
 * /editor route picks it up and seeds the blank editor ("a paste target
 * that can create a new local draft immediately"). "Continue to editor"
 * clears any stale handoff so the blank editor really starts blank. Same
 * pattern (and TTL policy) as the U6 arena and P4 party source handoffs.
 */
const STORAGE_KEY = "nova:draft-source:v1";
export const DRAFT_SOURCE_TTL_MS = 30 * 60 * 1000;

export interface DraftSourceEntry {
  /** Draft id (never a saved game id) — used to remount the editor per draft. */
  gameId: string;
  source: string;
  updatedAt: number;
}

/** Fresh draft id for unsaved generator handoffs (never persisted). */
export function newDraftGameId(): string {
  return `draft-${Date.now().toString(36)}`;
}

/**
 * Store a new draft source and return the entry. Read-only consumers use
 * {@link readDraftSource}; the /build flow always stores a fresh entry
 * before navigating, so the editor can never pick up an older draft.
 */
export function storeDraftSource(source: string): DraftSourceEntry {
  const entry: DraftSourceEntry = { gameId: newDraftGameId(), source, updatedAt: Date.now() };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // sessionStorage unavailable (private mode): the editor starts blank.
  }
  return entry;
}

/** Read a fresh draft entry, or null (none / expired). Never consumes. */
export function readDraftSource(): DraftSourceEntry | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<DraftSourceEntry>;
    if (
      typeof parsed.gameId !== "string" ||
      typeof parsed.source !== "string" ||
      typeof parsed.updatedAt !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.updatedAt > DRAFT_SOURCE_TTL_MS) {
      return null;
    }
    return { gameId: parsed.gameId, source: parsed.source, updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}

/** Drop any pending draft handoff (e.g. before opening a blank editor). */
export function clearDraftSource(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // sessionStorage unavailable (private mode): nothing to clear.
  }
}
