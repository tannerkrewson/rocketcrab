import { afterEach, beforeEach, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ init: vi.fn(), consentV2: vi.fn(), event: vi.fn() }));
vi.mock("@microsoft/clarity", () => ({ default: sdk }));
const eligibility = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("PROD", true);
  vi.stubEnv("VITE_MAIN_ORIGIN", window.location.origin);
  vi.stubEnv("VITE_CLARITY_PROJECT_ID", "test123");
  eligibility.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", eligibility);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
  window.localStorage.removeItem("nova:session-replay");
});

it("starts cookie-based replay by default on an eligible public page", async () => {
  const { startClarity, trackClarityAction } = await import("./clarity");
  await Promise.all([startClarity(), startClarity()]);
  expect(eligibility).toHaveBeenCalledTimes(1);
  expect(eligibility.mock.calls[0]?.[0]).toBe("/api/replay");
  expect(sdk.init).toHaveBeenCalledExactlyOnceWith("test123");
  expect(sdk.consentV2).not.toHaveBeenCalled();
  trackClarityAction("join_help_opened");
  expect(sdk.event).toHaveBeenCalledExactlyOnceWith("join_help_opened");
});

it("skips replay when the Worker declines eligibility", async () => {
  eligibility.mockResolvedValue(new Response(null, { status: 403 }));
  const { startClarity } = await import("./clarity");
  await startClarity();
  expect(sdk.init).not.toHaveBeenCalled();
});

it("honors a stored opt-out until it is reset", async () => {
  window.localStorage.setItem("nova:session-replay", "declined");
  const { setReplayOptOut, startClarity } = await import("./clarity");
  await startClarity();
  expect(eligibility).not.toHaveBeenCalled();

  expect(setReplayOptOut(false)).toBe(true);
  await startClarity();
  expect(sdk.init).toHaveBeenCalledOnce();
});

it.each([
  "/privacy",
  "/party#secret=private",
  "/editor",
  "/library",
  "/browse?q=private",
  "/build?private=1",
  "/#private",
])("never starts in a document opened at %s, even after a soft navigation", async (path) => {
  window.history.replaceState(null, "", path);
  const { startClarity } = await import("./clarity");
  window.history.replaceState(null, "", "/");
  await startClarity();
  expect(eligibility).not.toHaveBeenCalled();
});
