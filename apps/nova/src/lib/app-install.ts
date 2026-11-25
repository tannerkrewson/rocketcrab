import { useSyncExternalStore } from "react";
import { track } from "./analytics";

/** The parts of `<pwa-install>` (khmyznikov/pwa-install) this app uses. */
interface InstallElement extends HTMLElement {
  externalPromptEvent: Event | null;
  readonly isInstallAvailable: boolean;
  readonly isAppleMobilePlatform: boolean;
  readonly isAppleDesktopPlatform: boolean;
  readonly isUnderStandaloneMode: boolean;
  readonly isWebInstallSupported: boolean;
  install(): Promise<void>;
  showDialog(forced?: boolean): void;
}

let promptEvent: Event | null = null;
let element: InstallElement | null = null;
let available = false;
const listeners = new Set<() => void>();

function setAvailable(next: boolean): void {
  if (next === available) return;
  available = next;
  listeners.forEach((listener) => listener());
}

function standalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Capture Chromium's install prompt before React mounts, then load the
 * installer once the page is idle so it never delays the first render.
 */
export function prepareAppInstall(): void {
  if (typeof window === "undefined" || standalone()) return;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    promptEvent = event;
    if (element !== null) element.externalPromptEvent = event;
  });
  window.addEventListener("appinstalled", () => setAvailable(false));
  const load = () => void mountInstaller();
  // Safari has no requestIdleCallback.
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(load, { timeout: 4000 });
  } else {
    setTimeout(load, 2000);
  }
}

async function mountInstaller(): Promise<void> {
  try {
    await import("@khmyznikov/pwa-install");
  } catch {
    return; // Installing is optional.
  }
  const installer = document.createElement("pwa-install") as InstallElement;
  // The app opens the dialog itself and never nags on load.
  for (const flag of ["manual-apple", "manual-chrome", "disable-screenshots"]) {
    installer.setAttribute(flag, "");
  }
  installer.setAttribute("manifest-url", "/manifest.webmanifest");
  installer.setAttribute("install-description", "Open rocketcrab right from your home screen.");
  installer.externalPromptEvent = promptEvent;
  const refresh = () =>
    setAvailable(installer.isInstallAvailable && !installer.isUnderStandaloneMode);
  installer.addEventListener("pwa-install-available-event", refresh);
  installer.addEventListener("pwa-install-success-event", () => {
    track("app_install", { outcome: "installed" });
    setAvailable(false);
  });
  installer.addEventListener("pwa-user-choice-result-event", (event) => {
    const choice = (event as CustomEvent<{ message?: string }>).detail?.message;
    if (choice === "dismissed") track("app_install", { outcome: "dismissed" });
  });
  document.body.append(installer);
  element = installer;
  refresh();
}

/** Open the browser's install prompt, or step-by-step instructions where there is none. */
export function installApp(): void {
  const installer = element;
  if (installer === null) return;
  const instructions =
    installer.isAppleMobilePlatform ||
    installer.isAppleDesktopPlatform ||
    (promptEvent === null && !installer.isWebInstallSupported);
  track("app_install", { outcome: instructions ? "instructions" : "prompt" });
  if (instructions) installer.showDialog(true);
  else void installer.install();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether this browser can add rocketcrab to the home screen or dock right now. */
export function useAppInstallAvailable(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => available,
    () => false,
  );
}
