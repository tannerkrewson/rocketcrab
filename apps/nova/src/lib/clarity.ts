const projectId = import.meta.env.VITE_CLARITY_PROJECT_ID?.trim() ?? "";
const preferenceKey = "nova:session-replay";
const publicPaths = new Set(["/", "/build", "/about"]);

const clarityEnabled =
  import.meta.env.PROD &&
  /^[a-z0-9]+$/.test(projectId) &&
  typeof window !== "undefined" &&
  window.location.origin === import.meta.env.VITE_MAIN_ORIGIN;

function isPublicPage(): boolean {
  const { pathname, search, hash } = window.location;
  return publicPaths.has(pathname) && !search && !hash;
}

// The hosted script can read URLs and the DOM. Keep it in documents opened on
// public pages. Links from those pages into the app use a fresh document.
export const clarityPublicDocument =
  clarityEnabled &&
  isPublicPage() &&
  (!document.referrer || /^https?:\/\/[^/?#]+\/$/.test(document.referrer));

let sdk: typeof import("@microsoft/clarity").default | undefined;
let starting = false;

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

export async function startClarity(): Promise<void> {
  if (!clarityPublicDocument || !isPublicPage() || replayOptedOut() || starting) return;
  starting = true;
  try {
    const eligibility = await fetch("/api/replay", {
      mode: "same-origin",
      credentials: "omit",
      cache: "no-store",
    });
    if (eligibility.status !== 204) return;

    const { default: clarity } = await import("@microsoft/clarity");
    if (!isPublicPage() || replayOptedOut()) return;
    // Use the project's normal first-party cookies in eligible regions.
    clarity.init(projectId);
    sdk = clarity;
    document.getElementById("clarity-script")?.addEventListener("error", () => (sdk = undefined));

    const checkPreference = () => {
      if (!sdk || !replayOptedOut()) return;
      try {
        sdk.consentV2({ ad_Storage: "denied", analytics_Storage: "denied" });
      } finally {
        window.location.reload();
      }
    };
    window.addEventListener("storage", (event) => {
      if (event.key === preferenceKey || event.key === null) checkPreference();
    });
    window.addEventListener("pageshow", checkPreference);
  } catch {
    // Replay can fail independently of the app and GA.
  }
}

export function trackClarityAction(
  action:
    | "start_party_clicked"
    | "join_help_opened"
    | "browse_games_clicked"
    | "open_editor_clicked",
): void {
  try {
    sdk?.event(action);
  } catch {
    // Recording is optional.
  }
}
