import type { TransportConnectionState } from "@rocketcrab/core";
import { runtimeOriginForMainOrigin } from "../runtime-origin";
import type { PartyNotice, PartyPhase } from "./engine-types";

export const MAX_NOTICES = 8;
/** Retry because authority may reject start while its source-verification view lags. */
export const START_RETRY_INTERVAL_MS = 2_000;
/** Fresh links can lose source announcements or accepts; periodic refresh re-announces them. */
export const SOURCE_RETRANSMIT_INTERVAL_MS = 2_000;
export const START_RETRY_TIMEOUT_MS = 30_000;
export const START_GIVE_UP_MESSAGE = "Couldn't start the game. Try again.";
export const UNSAFE_TEARDOWN_MESSAGE =
  "Couldn't close the previous party safely. Reload the page before joining another party.";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let noticeCounter = 0;

export function makeNotice(
  level: PartyNotice["level"],
  code: string,
  message: string,
): PartyNotice {
  noticeCounter += 1;
  return { id: `notice-${noticeCounter}`, level, code, message };
}

export function leftNoticeMessage(displayName: string): string {
  return `${displayName} left the party.`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export const PARTY_HEALTH_PROBE_TIMEOUT_MS = 2_000;
export const RECONNECT_RETRY_BASE_MS = 5_000;
export const RECONNECT_RETRY_CAP_MS = 30_000;
/** Connected signaling is insufficient: fail setup if no private-room peer arrives. */
export const DEFAULT_PEER_CONNECT_TIMEOUT_MS = 15_000;
export function defaultScheduler(callback: () => void, delayMs: number): () => void {
  const id = setTimeout(callback, delayMs);
  return () => {
    clearTimeout(id);
  };
}

export function isConnectedState(state: TransportConnectionState): boolean {
  return state === "connected";
}

export function defaultRuntimeOrigin(): string {
  if (typeof window === "undefined") {
    return "http://localhost:2723";
  }
  return runtimeOriginForMainOrigin(window.location.origin);
}

export function defaultBaseUrl(): string {
  return typeof window === "undefined" ? "http://localhost:2722" : window.location.origin;
}

export function isInPartyPhase(phase: PartyPhase): boolean {
  return (
    phase === "lobby" ||
    phase === "starting" ||
    phase === "switching" ||
    phase === "playing" ||
    phase === "reconnecting"
  );
}
