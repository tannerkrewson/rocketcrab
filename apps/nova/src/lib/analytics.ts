import { findCatalogGame } from "./catalog";

const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim();
export const analyticsEnabled =
  import.meta.env.PROD &&
  /^G-[A-Z0-9]+$/.test(measurementId ?? "") &&
  typeof window !== "undefined" &&
  window.location.origin === import.meta.env.VITE_MAIN_ORIGIN;

type Parameters = Record<string, string | number | boolean | undefined>;
let tag: ((...args: unknown[]) => void) | undefined;
let pageLocation: string | undefined;

export function trackPage(routeId: string, gameId?: string): void {
  if (!analyticsEnabled) return;
  // Use route templates and listed slugs. Local game IDs, search, and invites stay out of GA.
  const listedId = gameId === undefined ? undefined : findCatalogGame(gameId)?.id;
  const path =
    routeId === "/game/$gameId" && listedId !== undefined
      ? `/game/${listedId}`
      : routeId === "__root__"
        ? "/404"
        : routeId.replace("$gameId", "local");
  const location = window.location.origin + path;
  if (location === pageLocation) return;
  let referrer = pageLocation ?? "";
  if (!referrer && document.referrer) {
    try {
      referrer = new URL(document.referrer).origin;
    } catch {
      // Omit malformed referrers.
    }
  }

  const page = { page_location: location, page_referrer: referrer, page_title: "Rocketcrab" };
  if (pageLocation === undefined) {
    const globals = window as Window & { dataLayer?: unknown[] };
    const queue = (globals.dataLayer ??= []);
    tag = function () {
      queue.push(arguments);
    };
    tag("js", new Date());
    tag("set", page);
    tag("config", measurementId, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    script.onerror = () => {
      tag = undefined;
      queue.length = 0;
    };
    document.head.append(script);
  } else {
    tag?.("set", page);
  }
  pageLocation = location;
  track("page_view", page);
}

export function track(event: string, params: Parameters = {}): void {
  try {
    tag?.("event", event, params);
  } catch {
    // A tag failure cannot interrupt gameplay.
  }
}
