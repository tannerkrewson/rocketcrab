import { BodyTooLargeError, jsonError, readBodyText } from "./http";

const outcomes = [
  "direct",
  "turn",
  "tunnel",
  "failed",
  "unknown",
  "lobby-ready",
  "join-failed",
  "game-ready",
];
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
];
const browsers = [
  "unknown",
  "safari-ios",
  "safari",
  "chrome-android",
  "chrome",
  "firefox",
  "edge",
  "other",
];
const networks = [
  "unknown",
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
];
const fields = [
  "outcome",
  "error_code",
  "ms_to_connect",
  "signaling_ok",
  "browser",
  "network",
  "app_version",
];
const MAX_BYTES = 1024;

export async function handleLog(request: Request): Promise<Response> {
  if (!request.body) return jsonError(400, "invalid_body", "event required");
  try {
    const value: unknown = JSON.parse(await readBodyText(request.body, MAX_BYTES));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const event = value as Record<string, unknown>;
    const member = (list: string[], item: unknown) =>
      typeof item === "string" && list.includes(item);
    if (
      Object.keys(event).length !== fields.length ||
      !fields.every((key) => Object.hasOwn(event, key)) ||
      !member(outcomes, event.outcome) ||
      !member(errors, event.error_code) ||
      !member(browsers, event.browser) ||
      !member(networks, event.network) ||
      typeof event.signaling_ok !== "boolean" ||
      typeof event.ms_to_connect !== "number" ||
      !Number.isInteger(event.ms_to_connect) ||
      event.ms_to_connect < 0 ||
      event.ms_to_connect > 3600000 ||
      typeof event.app_version !== "string" ||
      !/^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/.test(event.app_version)
    )
      throw new Error();
    console.log({ event: "nova_connection", ...event });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof BodyTooLargeError) return jsonError(413, "too_large", "event too large");
    return jsonError(400, "invalid_body", "invalid event");
  }
}
