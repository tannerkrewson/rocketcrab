import { afterEach, beforeEach, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ init: vi.fn(), consentV2: vi.fn(), event: vi.fn() }));
vi.mock("@microsoft/clarity", () => ({ default: sdk }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("PROD", true);
  vi.stubEnv("VITE_MAIN_ORIGIN", window.location.origin);
  vi.stubEnv("VITE_CLARITY_PROJECT_ID", "test123");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
  window.localStorage.removeItem("nova:session-replay");
});

it("loads once after explicit opt-in and denies advertising storage", async () => {
  const { startClarity, setClarityPreference, trackClarityAction } = await import("./clarity");
  startClarity();
  trackClarityAction("join_help_opened");
  await vi.dynamicImportSettled();
  expect(sdk.init).not.toHaveBeenCalled();
  expect(sdk.event).not.toHaveBeenCalled();
  expect(setClarityPreference(false)).toBe(true);
  startClarity();
  expect(sdk.init).not.toHaveBeenCalled();

  expect(setClarityPreference(true)).toBe(true);
  startClarity();
  await vi.dynamicImportSettled();
  expect(sdk.init).toHaveBeenCalledExactlyOnceWith("test123");
  expect(sdk.consentV2).toHaveBeenCalledExactlyOnceWith({
    ad_Storage: "denied",
    analytics_Storage: "granted",
  });
  trackClarityAction("join_help_opened");
  expect(sdk.event).toHaveBeenCalledExactlyOnceWith("join_help_opened");
});

it.each([
  "/party#secret=private",
  "/editor",
  "/library",
  "/browse?q=private",
  "/build?private=1",
  "/#private",
])("never starts in a document opened at %s, even after a soft navigation", async (path) => {
  window.history.replaceState(null, "", path);
  const { setClarityPreference, startClarity } = await import("./clarity");
  setClarityPreference(true);
  window.history.replaceState(null, "", "/");
  startClarity();
  await vi.dynamicImportSettled();
  expect(sdk.init).not.toHaveBeenCalled();
});

it("does not load when the choice cannot be saved", async () => {
  vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
    throw new DOMException("Storage disabled");
  });
  const { setClarityPreference } = await import("./clarity");
  expect(setClarityPreference(true)).toBe(false);
  await vi.dynamicImportSettled();
  expect(sdk.init).not.toHaveBeenCalled();
});
