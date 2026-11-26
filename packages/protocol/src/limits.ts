import { z } from "zod";

/**
 * Protocol limits.
 *
 * Byte-based limits are enforced at serialization boundaries (the host bridge
 * and the transport adapters) because Zod cannot measure the serialized size
 * of `unknown` payloads; string-length limits are enforced directly in the
 * schemas (see `htmlSourceSchema`). A warn threshold sits below every hard
 * limit so senders can degrade gracefully (rate-limit, compress, chunk)
 * before being rejected.
 */

/** Warn when usage reaches this fraction of a hard limit. */
export const LIMIT_WARN_FRACTION = 0.8;

/** Hard cap on a game's complete HTML source document. */
export const htmlSourceBytes = 2 * 1024 * 1024; // 2 MiB
export const htmlSourceWarnBytes = Math.floor(htmlSourceBytes * LIMIT_WARN_FRACTION);

/** Most games one member can offer the host at once (`party.games`). */
export const offeredGamesMax = 50;

/** Largest single protocol message sent before the sender must chunk it. */
export const messageBytesBeforeChunking = 64 * 1024; // 64 KiB
export const messageWarnBytes = Math.floor(messageBytesBeforeChunking * LIMIT_WARN_FRACTION);

/** Hard cap on one canonical state snapshot. */
export const stateSnapshotBytes = 512 * 1024; // 512 KiB
export const stateSnapshotWarnBytes = Math.floor(stateSnapshotBytes * LIMIT_WARN_FRACTION);

/** Hard cap on one action payload. */
export const actionPayloadBytes = 16 * 1024; // 16 KiB
export const actionPayloadWarnBytes = Math.floor(actionPayloadBytes * LIMIT_WARN_FRACTION);

/** Per-player game-originated payload budget and token bucket capacity. */
export const gameBytesPerSecond = 256 * 1024;
export const gameBytesBurst = 1024 * 1024;
export const gameBytesWarn = Math.floor(gameBytesBurst * LIMIT_WARN_FRACTION);

/** Maximum actions dispatched per second per player. */
export const actionRatePerSecond = 20;
export const actionWarnRatePerSecond = Math.floor(actionRatePerSecond * LIMIT_WARN_FRACTION);

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
 * silently without a Nova-level discovery/join timeout.
 */
export const handshakeTimeoutMs = 30_000;

/**
 * Time the authority has to apply a submitted action before the action times
 * out (action timeouts and deduplication).
 */
export const actionTimeoutMs = 10_000;

/**
 * Processed action IDs a state snapshot carries (the deduplication
 * window). Snapshots broadcast only the IDs added since the previous
 * broadcast; full history travels only for late joiners, restores and resync.
 */
export const stateHistoryLimit = 256;

/** Most players a state snapshot's roster lists (far above any real party). */
export const stateRosterMax = 256;

/**
 * How long a player must stay gone before the game's `playerLeft` runs, so a
 * phone that was briefly backgrounded or lost signal keeps its seat.
 */
export const playerLeaveGraceMs = 20_000;

/**
 * Minimum spacing between state resync requests from one member. A receiver
 * keeps at most one request outstanding per interval, and the authority
 * answers at most one per requester per interval.
 */
export const stateResyncMinIntervalMs = 1_000;

/**
 * Largest state delta a commit may carry. A commit
 * whose diff needs more operations, or a deeper path, is sent as a full state.
 */
export const stateDeltaMaxOps = 512;
/** Deepest path a state delta operation may address. */
export const stateDeltaMaxDepth = 32;

/**
 * Authority heartbeat interval. The current authority
 * broadcasts one heartbeat per interval so followers can detect silent loss;
 * missing heartbeats begin the grace period.
 */
export const authorityHeartbeatIntervalMs = 1_000;

/**
 * Authority grace period: how long a follower waits without a
 * heartbeat (or announcement/snapshot from the authority) before suspecting
 * the authority and starting an election.
 */
export const authorityGracePeriodMs = 5_000;

/** Ticks per second for a game with a `tick` handler, unless it declares one. */
export const tickRateDefault = 15;

/** Fastest declared tick rate. */
export const tickRateMax = 60;

/** Most a `nova.controls.set` value may serialize to. */
export const controlsBytes = 1024;

/** Largest player count a game may declare as its minimum or maximum. */
export const playerLimitMax = 10_000;

/** The complete limits table, typed. */
export const LIMITS = {
  tickRateDefault,
  tickRateMax,
  controlsBytes,
  playerLimitMax,
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
  gameBytesPerSecond,
  gameBytesBurst,
  gameBytesWarn,
  runtimeLogRatePerSecond,
  runtimeLogWarnRatePerSecond,
  errorReportRatePerSecond,
  errorReportWarnRatePerSecond,
  handshakeTimeoutMs,
  actionTimeoutMs,
  stateHistoryLimit,
  stateResyncMinIntervalMs,
  authorityHeartbeatIntervalMs,
  authorityGracePeriodMs,
} as const;

export type Limits = typeof LIMITS;

/**
 * Game source bounded by the HTML source hard limit (a game is one
 * complete HTML document stored as a string).
 */
export const htmlSourceSchema = z
  .string()
  .max(htmlSourceBytes, `Game HTML source exceeds the ${htmlSourceBytes}-byte hard limit.`);
