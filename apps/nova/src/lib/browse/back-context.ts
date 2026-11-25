/**
 * Preserve category and query while visiting game details. Standalone browse
 * restores via URL parameters; the lobby browser uses sessionStorage because
 * the party route has a different search shape. Clear on explicit return to
 * the category cards so the next browse starts at the top level.
 */

const STORAGE_KEY = "nova:browse-back:v1";

export interface BrowseBackContext {
  /** The browse view (category id or "mine") at the time of navigation. */
  view: string | null;
  /** The search query at the time of navigation ("" when none). */
  query: string;
}

export function saveBrowseContext(view: string | null, query: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ view, query }));
  } catch {
    // Session storage can be unavailable (private mode); the details page
    // falls back to the plain /browse target.
  }
}

/** Peek at the stored context without clearing it (the details page reads
 * it, and a remounted browser restores from it). */
export function readBrowseContext(): BrowseBackContext | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<BrowseBackContext>;
    if (typeof parsed.query !== "string") return null;
    return { view: typeof parsed.view === "string" ? parsed.view : null, query: parsed.query };
  } catch {
    return null;
  }
}

export function clearBrowseContext(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}
