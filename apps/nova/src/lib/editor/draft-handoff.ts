/**
 * Example-game source handoff to the editor via sessionStorage. Each draft
 * gets its own id so navigation remounts the editor. Entries expire rather
 * than seeding a later editing session with stale source.
 */
const STORAGE_KEY = "nova:draft-source:v1";
export const DRAFT_SOURCE_TTL_MS = 30 * 60 * 1000;

export interface DraftSourceEntry {
  /** Draft id (never a saved game id) — used to remount the editor per draft. */
  gameId: string;
  source: string;
  updatedAt: number;
}

/** Fresh, unpersisted id for an editor draft. */
export function newDraftGameId(): string {
  return `draft-${Date.now().toString(36)}`;
}

/** Store a fresh draft before navigating; readDraftSource peeks without consuming it. */
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
