import { describe, expect, it } from "vitest";
import {
  LIMIT_WARN_FRACTION,
  LIMITS,
  actionPayloadBytes,
  actionPayloadWarnBytes,
  actionRatePerSecond,
  actionTimeoutMs,
  actionWarnRatePerSecond,
  authorityGracePeriodMs,
  authorityHeartbeatIntervalMs,
  errorReportRatePerSecond,
  errorReportWarnRatePerSecond,
  handshakeTimeoutMs,
  htmlSourceBytes,
  htmlSourceSchema,
  htmlSourceWarnBytes,
  messageBytesBeforeChunking,
  messageWarnBytes,
  rawMessageBytes,
  rawMessageWarnBytes,
  rawRatePerSecond,
  rawWarnRatePerSecond,
  runtimeLogRatePerSecond,
  runtimeLogWarnRatePerSecond,
  simulationHighLatencyMs,
  simulationInputRatePerSecond,
  simulationInputWarnRatePerSecond,
  simulationSnapshotBytes,
  simulationSnapshotIntervalMs,
  simulationSnapshotMaxIntervalMs,
  simulationSnapshotMinIntervalMs,
  simulationSnapshotWarnBytes,
  simulationTickMaxMs,
  simulationTickMinMs,
  simulationTickMs,
  stateSnapshotBytes,
  stateSnapshotWarnBytes,
} from "./limits";

describe("protocol limits", () => {
  it("defines the initial hard limits from the issue", () => {
    expect(htmlSourceBytes).toBe(2 * 1024 * 1024);
    expect(messageBytesBeforeChunking).toBe(64 * 1024);
    expect(stateSnapshotBytes).toBe(512 * 1024);
    expect(actionPayloadBytes).toBe(16 * 1024);
    expect(actionRatePerSecond).toBe(20);
    expect(rawMessageBytes).toBe(1024 * 1024);
    expect(rawRatePerSecond).toBe(120);
    expect(runtimeLogRatePerSecond).toBe(50);
    expect(errorReportRatePerSecond).toBe(5);
    expect(handshakeTimeoutMs).toBe(30_000);
    expect(actionTimeoutMs).toBe(10_000);
    expect(authorityHeartbeatIntervalMs).toBe(1_000);
    expect(authorityGracePeriodMs).toBe(5_000);
    // A1 simulation bounds.
    expect(simulationTickMs).toBe(100);
    expect(simulationTickMinMs).toBeLessThan(simulationTickMs);
    expect(simulationTickMaxMs).toBeGreaterThan(simulationTickMs);
    expect(simulationSnapshotIntervalMs).toBe(1_000);
    expect(simulationSnapshotMinIntervalMs).toBeLessThan(simulationSnapshotIntervalMs);
    expect(simulationSnapshotMaxIntervalMs).toBeGreaterThan(simulationSnapshotIntervalMs);
    expect(simulationInputRatePerSecond).toBeGreaterThan(actionRatePerSecond);
    expect(simulationSnapshotBytes).toBe(stateSnapshotBytes);
    expect(simulationHighLatencyMs).toBeGreaterThan(0);
  });

  it("keeps warn thresholds below hard limits", () => {
    expect(LIMIT_WARN_FRACTION).toBe(0.8);
    expect(htmlSourceWarnBytes).toBeLessThan(htmlSourceBytes);
    expect(messageWarnBytes).toBeLessThan(messageBytesBeforeChunking);
    expect(stateSnapshotWarnBytes).toBeLessThan(stateSnapshotBytes);
    expect(actionPayloadWarnBytes).toBeLessThan(actionPayloadBytes);
    expect(actionWarnRatePerSecond).toBeLessThan(actionRatePerSecond);
    expect(rawMessageWarnBytes).toBeLessThan(rawMessageBytes);
    expect(rawWarnRatePerSecond).toBeLessThan(rawRatePerSecond);
    expect(runtimeLogWarnRatePerSecond).toBeLessThan(runtimeLogRatePerSecond);
    expect(errorReportWarnRatePerSecond).toBeLessThan(errorReportRatePerSecond);
    expect(simulationInputWarnRatePerSecond).toBeLessThan(simulationInputRatePerSecond);
    expect(simulationSnapshotWarnBytes).toBeLessThan(simulationSnapshotBytes);
  });

  it("exports the complete typed limits table", () => {
    expect(LIMITS.htmlSourceBytes).toBe(htmlSourceBytes);
    expect(LIMITS.actionTimeoutMs).toBe(actionTimeoutMs);
    expect(LIMITS.errorReportWarnRatePerSecond).toBe(errorReportWarnRatePerSecond);
    expect(LIMITS.rawMessageBytes).toBe(rawMessageBytes);
    expect(LIMITS.rawWarnRatePerSecond).toBe(rawWarnRatePerSecond);
    expect(LIMITS.simulationTickMs).toBe(simulationTickMs);
    expect(LIMITS.simulationSnapshotIntervalMs).toBe(simulationSnapshotIntervalMs);
    expect(LIMITS.simulationInputRatePerSecond).toBe(simulationInputRatePerSecond);
    expect(LIMITS.simulationSnapshotBytes).toBe(simulationSnapshotBytes);
    expect(LIMITS.simulationHighLatencyMs).toBe(simulationHighLatencyMs);
  });

  it("enforces the HTML source hard limit in the schema", () => {
    expect(htmlSourceSchema.safeParse("<html></html>").success).toBe(true);
    const oversized = "x".repeat(htmlSourceBytes + 1);
    const result = htmlSourceSchema.safeParse(oversized);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("exceeds the");
    }
  });
});
