import { track } from "./analytics";
import { version } from "../../package.json";

const networks = [
  "slow-2g",
  "2g",
  "3g",
  "4g",
  "bluetooth",
  "cellular",
  "ethernet",
  "wifi",
  "wimax",
  "none",
  "other",
] as const;

type Member<T extends readonly string[]> = T[number];
export type ConnectionAttempt = {
  outcome:
    | "direct"
    | "turn"
    | "tunnel"
    | "failed"
    | "unknown"
    | "lobby-ready"
    | "join-failed"
    | "game-ready";
  error_code: "" | "relay-failed";
  ms_to_connect: number;
  signaling_ok: boolean;
};
export type BrowserFamily =
  | "unknown"
  | "safari-ios"
  | "safari"
  | "chrome-android"
  | "chrome"
  | "firefox"
  | "edge"
  | "other";
export type NetworkFamily = "unknown" | Member<typeof networks>;
export function browserFamily(ua: string): BrowserFamily {
  if (!ua) return "unknown";
  if (/Edg(?:e|A|iOS)?\//i.test(ua)) return "edge";
  if (/Firefox\/|FxiOS\//i.test(ua)) return "firefox";
  if (/Chrome\/|CriOS\//i.test(ua)) return /Android/i.test(ua) ? "chrome-android" : "chrome";
  if (/Safari\//i.test(ua)) return /iPhone|iPad|iPod/i.test(ua) ? "safari-ios" : "safari";
  return "other";
}

export function networkFamily(
  connection: { effectiveType?: unknown; type?: unknown } | undefined,
): NetworkFamily {
  for (const value of [connection?.effectiveType, connection?.type]) {
    if (typeof value === "string" && (networks as readonly string[]).includes(value))
      return value as NetworkFamily;
  }
  return "unknown";
}

/** Report only bounded connection categories and timing. */
export function reportConnection(attempt: ConnectionAttempt): void {
  if (typeof navigator === "undefined") return;
  const connection = (
    navigator as Navigator & { connection?: { effectiveType?: unknown; type?: unknown } }
  ).connection;
  track("connection_result", {
    outcome: attempt.outcome,
    error_code: attempt.error_code || undefined,
    ms_to_connect: attempt.ms_to_connect > 0 ? attempt.ms_to_connect : undefined,
    signaling_status: attempt.signaling_ok ? "available" : "unavailable",
    browser_family: browserFamily(navigator.userAgent),
    network: networkFamily(connection),
    app_version: import.meta.env.VITE_APP_VERSION || version,
  });
}
