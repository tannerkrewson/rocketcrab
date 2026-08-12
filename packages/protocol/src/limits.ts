import { z } from "zod";

/**
 * Initial protocol limits (F6; threat-model rows T10/T11).
 *
 * Byte-based limits are enforced at serialization boundaries (the host bridge
 * and the transport adapters) because Zod cannot measure the serialized size
 * of `unknown` payloads; string-length limits are enforced directly in the
 * schemas (see `htmlSourceSchema`). A warn threshold sits below every hard
 * limit so senders can degrade gracefully (rate-limit, compress, chunk)
 * before being rejected. Tuning these constants is expected after real
 * play-testing (P3, S3, M1).
 */

/** Warn when usage reaches this fraction of a hard limit. */
export const LIMIT_WARN_FRACTION = 0.8;

/** Hard cap on a game's complete HTML source document (ADR-0002, P3). */
export const htmlSourceBytes = 2 * 1024 * 1024; // 2 MiB
export const htmlSourceWarnBytes = Math.floor(htmlSourceBytes * LIMIT_WARN_FRACTION);

/** Largest single protocol message sent before the sender must chunk it. */
export const messageBytesBeforeChunking = 64 * 1024; // 64 KiB
export const messageWarnBytes = Math.floor(messageBytesBeforeChunking * LIMIT_WARN_FRACTION);

/** Hard cap on one canonical state snapshot (ADR-0006 state mode). */
export const stateSnapshotBytes = 512 * 1024; // 512 KiB
export const stateSnapshotWarnBytes = Math.floor(stateSnapshotBytes * LIMIT_WARN_FRACTION);

/** Hard cap on one action payload (ADR-0006 state mode). */
export const actionPayloadBytes = 16 * 1024; // 16 KiB
export const actionPayloadWarnBytes = Math.floor(actionPayloadBytes * LIMIT_WARN_FRACTION);

/** Maximum actions dispatched per second per player. */
export const actionRatePerSecond = 20;
export const actionWarnRatePerSecond = Math.floor(actionRatePerSecond * LIMIT_WARN_FRACTION);

/**
 * Hard cap on one raw-channel message payload (ADR-0006 raw mode). Raw mode
 * is the escape hatch for fast continuous protocols, so the cap sits well
 * above the action cap; payloads above `messageBytesBeforeChunking` travel
 * as chunked transfers with progress on both sides. Binary payloads are
 * measured by byte length, structured payloads by UTF-8 serialized size.
 */
export const rawMessageBytes = 1024 * 1024; // 1 MiB
/** Warn threshold: senders degrade gracefully (rate-limit, compress) at 80%. */
export const rawMessageWarnBytes = Math.floor(rawMessageBytes * LIMIT_WARN_FRACTION);

/**
 * Maximum raw-channel messages sent per second per player (all channels).
 * The window is the same 10 s sliding window state mode uses for action
 * rates, so diagnostics are comparable across modes.
 */
export const rawRatePerSecond = 120;
export const rawWarnRatePerSecond = Math.floor(rawRatePerSecond * LIMIT_WARN_FRACTION);

/** Maximum runtime log messages per second per runtime frame. */
export const runtimeLogRatePerSecond = 50;
export const runtimeLogWarnRatePerSecond = Math.floor(
  runtimeLogRatePerSecond * LIMIT_WARN_FRACTION,
);

/** Maximum runtime error reports per second per runtime frame. */
export const errorReportRatePerSecond = 5;
export const errorReportWarnRatePerSecond = Math.floor(
  errorReportRatePerSecond * LIMIT_WARN_FRACTION,
);

/**
 * Discovery + admission handshake timeout. Trystero can otherwise hang
 * silently (F5 finding F5; recommendation: impose a Nova-level
 * discovery/join timeout of ~20-30 s).
 */
export const handshakeTimeoutMs = 30_000;

/**
 * Time the authority has to apply a submitted action before the action times
 * out (ADR-0006: action timeouts and deduplication).
 */
export const actionTimeoutMs = 10_000;

/**
 * Authority heartbeat interval (ADR-0007 S3). The current authority
 * broadcasts one heartbeat per interval so followers can detect silent loss;
 * missing heartbeats begin the grace period.
 */
export const authorityHeartbeatIntervalMs = 1_000;

/**
 * Authority grace period (ADR-0007 S3): how long a follower waits without a
 * heartbeat (or announcement/snapshot from the authority) before suspecting
 * the authority and starting an election.
 */
export const authorityGracePeriodMs = 5_000;

/** The complete limits table, typed. */
export const LIMITS = {
  htmlSourceBytes,
  htmlSourceWarnBytes,
  messageBytesBeforeChunking,
  messageWarnBytes,
  stateSnapshotBytes,
  stateSnapshotWarnBytes,
  actionPayloadBytes,
  actionPayloadWarnBytes,
  actionRatePerSecond,
  actionWarnRatePerSecond,
  rawMessageBytes,
  rawMessageWarnBytes,
  rawRatePerSecond,
  rawWarnRatePerSecond,
  runtimeLogRatePerSecond,
  runtimeLogWarnRatePerSecond,
  errorReportRatePerSecond,
  errorReportWarnRatePerSecond,
  handshakeTimeoutMs,
  actionTimeoutMs,
  authorityHeartbeatIntervalMs,
  authorityGracePeriodMs,
} as const;

export type Limits = typeof LIMITS;

/**
 * Game source bounded by the HTML source hard limit (ADR-0002: a game is one
 * complete HTML document stored as a string).
 */
export const htmlSourceSchema = z
  .string()
  .max(htmlSourceBytes, `Game HTML source exceeds the ${htmlSourceBytes}-byte hard limit.`);
