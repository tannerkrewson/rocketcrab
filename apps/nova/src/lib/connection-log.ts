import { version } from "../../package.json";
import { edgeOrigin } from "./edge";

const outcomes = ["direct", "turn", "tunnel", "failed"] as const;
const errors = [
  "",
  "room-full",
  "banned",
  "relay-failed",
  "identity-failed",
  "plugin-failed",
  "decrypt-failed",
  "peer-connect-failed",
  "handshake-failed",
  "peer-error",
] as const;
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
  outcome: Member<typeof outcomes>;
  error_code: Member<typeof errors>;
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
export type ConnectionEvent = ConnectionAttempt & {
  browser: BrowserFamily;
  network: NetworkFamily;
  app_version: string;
};

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

/** Best effort only: never include caller-provided extra fields or raw browser data. */
export function reportConnection(attempt: ConnectionAttempt): boolean {
  try {
    if (
      !edgeOrigin() ||
      typeof navigator === "undefined" ||
      typeof navigator.sendBeacon !== "function" ||
      !(outcomes as readonly unknown[]).includes(attempt.outcome) ||
      !(errors as readonly unknown[]).includes(attempt.error_code) ||
      !Number.isInteger(attempt.ms_to_connect) ||
      attempt.ms_to_connect < 0 ||
      attempt.ms_to_connect > 3600000 ||
      typeof attempt.signaling_ok !== "boolean" ||
      !/^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/.test(version)
    )
      return false;
    const connection = (
      navigator as Navigator & {
        connection?: { effectiveType?: unknown; type?: unknown };
      }
    ).connection;
    const event: ConnectionEvent = {
      outcome: attempt.outcome,
      error_code: attempt.error_code,
      ms_to_connect: attempt.ms_to_connect,
      signaling_ok: attempt.signaling_ok,
      browser: browserFamily(navigator.userAgent),
      network: networkFamily(connection),
      app_version: version,
    };
    return navigator.sendBeacon(`${edgeOrigin()}/log`, JSON.stringify(event));
  } catch {
    return false;
  }
}
