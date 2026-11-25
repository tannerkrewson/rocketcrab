const projectId = import.meta.env.VITE_CLARITY_PROJECT_ID?.trim() ?? "";
const preferenceKey = "nova:session-replay";
const publicPaths = new Set(["/", "/build", "/about"]);

export const clarityEnabled =
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

export function getClarityPreference(): boolean | null {
  if (!clarityEnabled) return null;
  try {
    const value = window.localStorage.getItem(preferenceKey);
    return value === null ? null : value === "allowed";
  } catch {
    return null;
  }
}

export function setClarityPreference(allowed: boolean): boolean {
  if (!clarityEnabled) return false;
  try {
    window.localStorage.setItem(preferenceKey, allowed ? "allowed" : "declined");
  } catch {
    if (!allowed && sdk) stopClarity();
    return false;
  }
  if (allowed) startClarity();
  else if (sdk) stopClarity();
  return true;
}

function stopClarity(): void {
  try {
    sdk?.consentV2({ ad_Storage: "denied", analytics_Storage: "denied" });
  } catch {
    // Reload even if the tag has failed.
  }
  window.location.reload();
}

export function startClarity(): void {
  if (!clarityPublicDocument || !isPublicPage() || getClarityPreference() !== true || starting)
    return;
  starting = true;
  void import("@microsoft/clarity")
    .then(({ default: clarity }) => {
      if (!isPublicPage() || getClarityPreference() !== true) {
        starting = false;
        return;
      }
      clarity.init(projectId);
      clarity.consentV2({ ad_Storage: "denied", analytics_Storage: "granted" });
      sdk = clarity;
      document.getElementById("clarity-script")?.addEventListener("error", () => (sdk = undefined));

      const checkPreference = () => {
        if (sdk && getClarityPreference() !== true) stopClarity();
      };
      window.addEventListener("storage", (event) => {
        if (event.key === preferenceKey || event.key === null) checkPreference();
      });
      window.addEventListener("pageshow", checkPreference);
    })
    .catch(() => {
      // A blocked tag or SDK failure cannot interrupt the app.
    });
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
