import { createBrowserHistory } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const commands = vi.hoisted(() => vi.fn());
const sdk = vi.hoisted(() => ({
  init: vi.fn(() => {
    window.clarity = commands;
  }),
}));
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
  delete window.clarity;
});

it("starts cookie-based replay by default on an eligible public page", async () => {
  const { startClarity, clarityEvent } = await import("./clarity");
  await Promise.all([startClarity(), startClarity()]);
  expect(eligibility).toHaveBeenCalledTimes(1);
  expect(eligibility.mock.calls[0]?.[0]).toBe("/api/replay");
  expect(sdk.init).toHaveBeenCalledExactlyOnceWith("test123");
  clarityEvent("join_help_opened");
  expect(commands).toHaveBeenCalledExactlyOnceWith("event", "join_help_opened");
});

it("skips replay for good when the Worker declines eligibility", async () => {
  eligibility.mockResolvedValue(new Response(null, { status: 403 }));
  const { startClarity } = await import("./clarity");
  await startClarity();
  await startClarity();
  expect(eligibility).toHaveBeenCalledOnce();
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
  ["/", true],
  ["/about", true],
  ["/party", true],
  ["/party?gameId=drawphone&title=Drawphone", true],
  ["/party?browse=true", true],
  ["/party?gameId=private-game-id&title=Secret", false],
  ["/party#secret=private", false],
  ["/party?name=private", false],
  ["/privacy", false],
  ["/editor", false],
  ["/library", false],
  ["/game/drawphone", false],
  ["/browse?q=private", false],
  ["/build?private=1", false],
  ["/#private", false],
])("allows replay at %s: %s", async (path, allowed) => {
  const { replayAllowed } = await import("./clarity");
  expect(replayAllowed(new URL(path, window.location.origin))).toBe(allowed);
});

it("stops before leaving a recorded page and resumes on return", async () => {
  const history = createBrowserHistory();
  const { guardReplayNavigation, startClarity } = await import("./clarity");
  guardReplayNavigation(history);
  history.push("/party");
  await vi.waitFor(() => expect(window.location.pathname).toBe("/party"));
  await startClarity();
  expect(sdk.init).toHaveBeenCalledOnce();

  const stoppedAt: string[] = [];
  commands.mockImplementation((command: string) => {
    if (command === "stop") stoppedAt.push(window.location.pathname);
  });
  history.push("/game/drawphone?from=party");
  await vi.waitFor(() => expect(window.location.pathname).toBe("/game/drawphone"));
  expect(commands).toHaveBeenCalledExactlyOnceWith("stop");
  // Clarity restarts on URL changes it sees while recording.
  expect(stoppedAt).toEqual(["/party"]);
  await startClarity();
  expect(commands).toHaveBeenCalledOnce();

  history.push("/party");
  await vi.waitFor(() => expect(window.location.pathname).toBe("/party"));
  await startClarity();
  expect(commands).toHaveBeenLastCalledWith("start");
});

it("stops on back navigation before the page changes", async () => {
  const { guardReplayNavigation, startClarity } = await import("./clarity");
  guardReplayNavigation(createBrowserHistory());
  window.history.replaceState(null, "", "/library");
  window.history.pushState(null, "", "/");
  await startClarity();

  window.history.back();
  await vi.waitFor(() => expect(commands).toHaveBeenCalledWith("stop"));
});

it("never starts when a same-origin referrer could carry a private path", async () => {
  vi.spyOn(document, "referrer", "get").mockReturnValue(`${window.location.origin}/library`);
  const { startClarity } = await import("./clarity");
  await startClarity();
  expect(eligibility).not.toHaveBeenCalled();
});
