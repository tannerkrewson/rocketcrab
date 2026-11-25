/**
 * Each deploy replaces the app's hashed page files, so a tab opened before a
 * deploy can't load pages it hasn't visited yet. Vite reports that as
 * `vite:preloadError`; reloading picks up the new build. A second failure
 * soon after is a real outage, so it surfaces as an error instead of looping.
 */
const RELOADED_AT_KEY = "rc:reloaded-for-new-build";
const LOOP_WINDOW_MS = 30_000;

export function reloadForNewBuild(now = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT_KEY));
    if (now - last < LOOP_WINDOW_MS) return false;
    sessionStorage.setItem(RELOADED_AT_KEY, String(now));
  } catch {
    // Without storage there is no loop guard; a reload is still the best fix.
  }
  window.location.reload();
  return true;
}

export function handleStaleBuilds(): void {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForNewBuild()) event.preventDefault();
  });
}
