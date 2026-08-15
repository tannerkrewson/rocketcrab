/**
 * Browse-back context (rocketcrab-5cl.7): GameBrowser records its current
 * view + query right before navigating to a game's details page, so the
 * details page's back button can return to the same category (or search)
 * instead of the browser's top level. The standalone /browse route carries
 * the context in the URL (?view=&q=); the in-lobby browser can't (party.tsx
 * validates a fixed search shape), so GameBrowser also restores the stored
 * context on mount — a remounted lobby browser returns to the category the
 * host left from. The context is cleared when the user explicitly returns
 * to the category cards, so a fresh browse always starts at the top level.
 */

const STORAGE_KEY = "nova:browse-back:v1";

export interface BrowseBackContext {
  /** The browse view (category id or "mine") at the time of navigation. */
  view: string | null;
  /** The search query at the time of navigation ("" when none). */
  query: string;
}

/** Record the browser's position before opening a game's details page. */
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

/** Forget the stored position (the user returned to the category cards). */
export function clearBrowseContext(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
