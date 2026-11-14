import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserFamily,
  networkFamily,
  reportConnection,
  type ConnectionAttempt,
} from "./connection-log";

const attempt: ConnectionAttempt = {
  outcome: "direct",
  error_code: "",
  ms_to_connect: 0,
  signaling_ok: true,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("connection reporting", () => {
  it("reduces browser and network data to allowlisted families", () => {
    expect(browserFamily("iPhone Safari/123 secret")).toBe("safari-ios");
    expect(browserFamily("Android Chrome/123 Safari/123")).toBe("chrome-android");
    expect(browserFamily("Chrome/123 Edg/123")).toBe("edge");
    expect(browserFamily("FxiOS/123")).toBe("firefox");
    expect(browserFamily("")).toBe("unknown");
    expect(networkFamily({ effectiveType: "private-id", type: "wifi" })).toBe("wifi");
    expect(networkFamily({ effectiveType: "4g", type: "wifi" })).toBe("4g");
    expect(networkFamily({ type: "private-id" })).toBe("unknown");
  });

  it("sends only schema fields, never caller extras or raw navigator data", () => {
    vi.stubEnv("VITE_EDGE_ORIGIN", "https://edge.example/");
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", {
      sendBeacon,
      userAgent: "iPhone Safari/123 private",
      connection: { effectiveType: "4g", id: "secret" },
    });
    expect(reportConnection({ ...attempt, room_id: "secret" } as ConnectionAttempt)).toBe(true);
    expect(sendBeacon).toHaveBeenCalledOnce();
    const [url, body] = sendBeacon.mock.calls[0] as unknown as [string, string];
    expect(url).toBe("https://edge.example/log");
    expect(JSON.parse(body)).toEqual({
      ...attempt,
      browser: "safari-ios",
      network: "4g",
      app_version: "0.0.0",
    });
    expect(body).not.toContain("secret");
    expect(body).not.toContain("private");
  });

  it("sends the unknown outcome and still rejects unrecognised outcomes", () => {
    vi.stubEnv("VITE_EDGE_ORIGIN", "https://edge.example");
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon, userAgent: "" });
    expect(reportConnection({ ...attempt, outcome: "unknown" })).toBe(true);
    const [, body] = sendBeacon.mock.calls[0] as unknown as [string, string];
    expect(JSON.parse(body)).toMatchObject({ outcome: "unknown" });
    for (const outcome of ["Unknown", "unknowns", "", "relay"])
      expect(reportConnection({ ...attempt, outcome } as unknown as ConnectionAttempt)).toBe(false);
    expect(sendBeacon).toHaveBeenCalledOnce();
  });

  it("rejects invalid data and handles unavailable or failing beacons", () => {
    vi.stubEnv("VITE_EDGE_ORIGIN", "https://edge.example");
    const sendBeacon = vi.fn(() => false);
    vi.stubGlobal("navigator", { sendBeacon, userAgent: "" });
    for (const ms of [-1, 3600001, 1.5, NaN, Infinity])
      expect(reportConnection({ ...attempt, ms_to_connect: ms })).toBe(false);
    expect(
      reportConnection({
        ...attempt,
        error_code: "secret",
      } as unknown as ConnectionAttempt),
    ).toBe(false);
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(reportConnection({ ...attempt, ms_to_connect: 3600000 })).toBe(false);
    sendBeacon.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(reportConnection(attempt)).toBe(false);
    vi.stubGlobal("navigator", {});
    expect(reportConnection(attempt)).toBe(false);
    vi.stubEnv("VITE_EDGE_ORIGIN", "");
    expect(reportConnection(attempt)).toBe(false);
  });
});
