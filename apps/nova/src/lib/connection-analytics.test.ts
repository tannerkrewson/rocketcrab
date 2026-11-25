import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserFamily,
  networkFamily,
  reportConnection,
  type ConnectionAttempt,
} from "./connection-analytics";
import { track } from "./analytics";

vi.mock("./analytics", () => ({ track: vi.fn() }));

const attempt: ConnectionAttempt = {
  outcome: "direct",
  error_code: "",
  ms_to_connect: 0,
  signaling_ok: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
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

  it("reports the connection without caller extras or raw navigator data", () => {
    vi.stubGlobal("navigator", {
      userAgent: "iPhone Safari/123 private",
      connection: { effectiveType: "4g", id: "secret" },
    });
    reportConnection({
      ...attempt,
      outcome: "tunnel",
      ms_to_connect: 812,
      room_id: "secret",
    } as ConnectionAttempt);
    expect(track).toHaveBeenCalledExactlyOnceWith("connection_result", {
      outcome: "tunnel",
      error_code: undefined,
      ms_to_connect: 812,
      signaling_status: "available",
      browser_family: "safari-ios",
      network: "4g",
      app_version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
    });
  });

  it("omits absent timing and distinguishes a signaling outage from a peer failure", () => {
    reportConnection({
      outcome: "failed",
      error_code: "relay-failed",
      ms_to_connect: 0,
      signaling_ok: false,
    });
    expect(track).toHaveBeenCalledExactlyOnceWith(
      "connection_result",
      expect.objectContaining({
        outcome: "failed",
        error_code: "relay-failed",
        ms_to_connect: undefined,
        signaling_status: "unavailable",
      }),
    );
  });
});
