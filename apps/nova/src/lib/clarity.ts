import type { RouterHistory } from "@tanstack/react-router";
import { findCatalogGame } from "./catalog";

const projectId = import.meta.env.VITE_CLARITY_PROJECT_ID?.trim() ?? "";
const preferenceKey = "nova:session-replay";
const publicPaths = new Set(["/", "/build", "/about"]);
const partySearch = new Set(["gameId", "title", "browse"]);

const clarityEnabled =
  import.meta.env.PROD &&
  /^[a-z0-9]+$/.test(projectId) &&
  typeof window !== "undefined" &&
  window.location.origin === import.meta.env.VITE_MAIN_ORIGIN &&
  // Replay records the referrer; a same-origin one can carry a private path.
  (!document.referrer || /^https?:\/\/[^/?#]+\/$/.test(document.referrer));

/**
 * Replay records public pages and the party screen for listed games only.
 * The Clarity project uses strict masking, so page text is hidden, but
 * attributes are recorded as-is: never put names or secrets in them there.
 */
export function replayAllowed({
  pathname,
  search,
  hash,
}: Pick<Location, "pathname" | "search" | "hash">): boolean {
  if (hash) return false;
  if (publicPaths.has(pathname)) return !search;
  if (pathname !== "/party") return false;
  const params = new URLSearchParams(search);
  const gameId = params.get("gameId");
  return (
    [...params.keys()].every((key) => partySearch.has(key)) &&
    (gameId === null || findCatalogGame(gameId) !== undefined)
  );
}

let recording = false;
// Eligibility is checked once per document.
let attempted = false;

function clarity(command: string, ...args: unknown[]): void {
  try {
    window.clarity?.(command, ...args);
  } catch {
    // Recording is optional.
  }
}

export function replayOptedOut(): boolean {
  try {
    return window.localStorage.getItem(preferenceKey) === "declined";
  } catch {
    return true;
  }
}

export function setReplayOptOut(optedOut: boolean): boolean {
  try {
    if (optedOut) window.localStorage.setItem(preferenceKey, "declined");
    else window.localStorage.removeItem(preferenceKey);
    return true;
  } catch {
    return false;
  }
}

/** Record the current page when replay allows it. Call after each navigation. */
export async function startClarity(): Promise<void> {
  if (!clarityEnabled || recording || replayOptedOut() || !replayAllowed(window.location)) return;
  if (window.clarity !== undefined) {
    // Resume after leaving an unrecorded page.
    recording = true;
    clarity("start");
    return;
  }
  if (attempted) return;
  attempted = true;
  try {
    const eligibility = await fetch("/api/replay", {
      mode: "same-origin",
      credentials: "omit",
      cache: "no-store",
    });
    if (eligibility.status !== 204) return;

    const { default: sdk } = await import("@microsoft/clarity");
    if (!replayAllowed(window.location) || replayOptedOut()) return;
    // Use the project's normal first-party cookies in eligible regions.
    sdk.init(projectId);
    recording = true;
    document.getElementById("clarity-script")?.addEventListener("error", () => {
      recording = false;
    });

    const checkPreference = () => {
      if (!replayOptedOut()) return;
      clarity("consentV2", { ad_Storage: "denied", analytics_Storage: "denied" });
      window.location.reload();
    };
    window.addEventListener("storage", (event) => {
      if (event.key === preferenceKey || event.key === null) checkPreference();
    });
    window.addEventListener("pageshow", checkPreference);
  } catch {
    // Replay can fail independently of the app and GA.
  }
}

function stopBefore(next: Pick<Location, "pathname" | "search" | "hash">): void {
  if (!recording || replayAllowed(next)) return;
  recording = false;
  clarity("stop");
}

/**
 * Clarity restarts itself on every URL change, so it must stop before the
 * router leaves a recorded page. Back and forward change the URL first, so a
 * capturing listener stops it before Clarity's own popstate handler runs.
 */
export function guardReplayNavigation(history: RouterHistory): void {
  history.block({
    blockerFn: ({ nextLocation }) => {
      stopBefore(nextLocation);
      return false;
    },
    enableBeforeUnload: false,
  });
  window.addEventListener("popstate", () => stopBefore(window.location), { capture: true });
}

/** Mark a moment in the current recording so replays can be filtered by it. */
export function clarityEvent(name: string): void {
  if (recording) clarity("event", name);
}

declare global {
  interface Window {
    clarity?: (command: string, ...args: unknown[]) => void;
  }
}
