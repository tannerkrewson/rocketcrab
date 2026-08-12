/**
 * Editor → arena source handoff (U6 "create arena from editor source").
 *
 * The editor's Test-multiplayer action stores the CURRENT editor source
 * (which may be unsaved) in sessionStorage before navigating to the arena;
 * the arena route picks it up when the stored gameId matches, falling back
 * to the saved game source otherwise. The entry expires after
 * {@link ARENA_SOURCE_TTL_MS} so a stale entry from an old editor session
 * never shadows a saved game.
 */
const STORAGE_KEY = "nova:arena-source:v1";
export const ARENA_SOURCE_TTL_MS = 30 * 60 * 1000;

interface ArenaSourceEntry {
  gameId: string;
  source: string;
  updatedAt: number;
}

/** Store the current editor source for the arena (best effort). */
export function storeArenaSource(input: { gameId: string; source: string }): void {
  try {
    const entry: ArenaSourceEntry = { ...input, updatedAt: Date.now() };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // sessionStorage unavailable (private mode): the arena falls back to
    // the saved game source.
  }
}

/** Read a fresh entry for the given gameId, or null (expired / mismatched). */
export function takeArenaSource(gameId: string): string | null {
  const entry = readArenaSourceEntry();
  return entry?.gameId === gameId ? entry.source : null;
}

/** Read a fresh draft entry (draft-* gameId), or null. */
export function takeDraftArenaSource(): { gameId: string; source: string } | null {
  const entry = readArenaSourceEntry();
  if (entry === null || !entry.gameId.startsWith("draft-")) return null;
  return { gameId: entry.gameId, source: entry.source };
}

function readArenaSourceEntry(): ArenaSourceEntry | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<ArenaSourceEntry>;
    if (
      typeof parsed.gameId !== "string" ||
      typeof parsed.source !== "string" ||
      typeof parsed.updatedAt !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.updatedAt > ARENA_SOURCE_TTL_MS) {
      return null;
    }
    return { gameId: parsed.gameId, source: parsed.source, updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}
