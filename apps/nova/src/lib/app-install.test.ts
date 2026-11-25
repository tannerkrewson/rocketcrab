import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const installer = vi.hoisted(() => ({
  apple: false,
  install: vi.fn(async () => undefined),
  showDialog: vi.fn(),
}));

vi.mock("@khmyznikov/pwa-install", () => {
  class FakeInstaller extends HTMLElement {
    externalPromptEvent: Event | null = null;
    isInstallAvailable = false;
    isUnderStandaloneMode = false;
    isWebInstallSupported = false;
    isAppleDesktopPlatform = false;
    get isAppleMobilePlatform() {
      return installer.apple;
    }
    install = installer.install;
    showDialog = installer.showDialog;
  }
  if (!customElements.get("pwa-install")) customElements.define("pwa-install", FakeInstaller);
  return {};
});
vi.mock("./analytics", () => ({ track: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  installer.apple = false;
  vi.stubGlobal("requestIdleCallback", (load: () => void) => load());
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelectorAll("pwa-install").forEach((element) => element.remove());
});

async function ready() {
  const module = await import("./app-install");
  module.prepareAppInstall();
  const element = await vi.waitFor(() => {
    const found = document.querySelector("pwa-install") as HTMLElement & {
      isInstallAvailable: boolean;
    };
    expect(found).not.toBeNull();
    return found;
  });
  const { result } = renderHook(() => module.useAppInstallAvailable());
  return { module, element, result };
}

function makeAvailable(element: HTMLElement & { isInstallAvailable: boolean }) {
  act(() => {
    element.isInstallAvailable = true;
    element.dispatchEvent(new Event("pwa-install-available-event"));
  });
}

it("offers the app only once the installer reports it can install", async () => {
  const { element, result } = await ready();
  expect(result.current).toBe(false);
  makeAvailable(element);
  expect(result.current).toBe(true);
  act(() => {
    window.dispatchEvent(new Event("appinstalled"));
  });
  expect(result.current).toBe(false);
});

it("opens the browser prompt when Chromium offered one", async () => {
  const { module, element } = await ready();
  window.dispatchEvent(new Event("beforeinstallprompt"));
  expect(element).toHaveProperty("externalPromptEvent.type", "beforeinstallprompt");
  makeAvailable(element);
  module.installApp();
  expect(installer.install).toHaveBeenCalledOnce();
  expect(installer.showDialog).not.toHaveBeenCalled();
});

it("shows step-by-step instructions on Apple devices", async () => {
  installer.apple = true;
  const { module, element } = await ready();
  makeAvailable(element);
  module.installApp();
  expect(installer.showDialog).toHaveBeenCalledWith(true);
  expect(installer.install).not.toHaveBeenCalled();
});

it("never loads the installer inside the installed app", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("standalone") }));
  const { prepareAppInstall } = await import("./app-install");
  prepareAppInstall();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector("pwa-install")).toBeNull();
});
