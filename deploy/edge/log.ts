import { jsonError } from "./http";

export interface LogEnv {
  CONNECTION_EVENTS?: {
    writeDataPoint(point: { blobs: string[]; doubles: number[] }): void;
  };
}

const outcomes = ["direct", "turn", "tunnel", "failed", "unknown"];
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

export async function handleLog(request: Request, env: LogEnv): Promise<Response> {
  // Bound streamed bodies even when Content-Length is absent or false.
  const reader = request.body?.getReader();
  if (!reader) return jsonError(400, "invalid_body", "event required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return jsonError(413, "too_large", "event too large");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
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
    if (!env.CONNECTION_EVENTS) return jsonError(503, "unavailable", "analytics unavailable");
    try {
      env.CONNECTION_EVENTS.writeDataPoint({
        blobs: [
          event.outcome as string,
          event.error_code as string,
          event.signaling_ok ? "true" : "false",
          event.browser as string,
          event.network as string,
          event.app_version,
        ],
        doubles: [event.ms_to_connect],
      });
    } catch {
      return jsonError(503, "unavailable", "analytics unavailable");
    }
    return new Response(null, { status: 204 });
  } catch {
    return jsonError(400, "invalid_body", "invalid event");
  }
}
