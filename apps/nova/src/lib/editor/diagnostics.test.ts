import type { RuntimeErrorMessage } from "@rocketcrab/protocol";
import { describe, expect, it } from "vitest";
import {
  RUNTIME_ERROR_CATEGORIES,
  buildDiagnosticReport,
  consoleEntryFromMessage,
  diagnosticFromRuntimeError,
  diagnosticsFromHostEvent,
} from "./diagnostics";

function runtimeError(category: RuntimeErrorMessage["category"], message: string) {
  return {
    version: 1,
    runtimeInstanceId: "runtime-1",
    messageId: "message-1",
    sentAt: 1_700_000_000_000,
    type: "runtime.error",
    category,
    message,
  } as RuntimeErrorMessage;
}

describe("diagnosticFromRuntimeError", () => {
  it("maps every U4 runtime category to a friendly diagnostic", () => {
    const cases: Array<[RuntimeErrorMessage["category"], string]> = [
      ["empty_source", "Empty source"],
      ["invalid_html", "Missing HTML structure"],
      ["missing_registration", "No game registration"],
      ["oversized_source", "Source too large"],
      ["syntax", "Syntax error"],
      ["remote_load", "Remote resource failed"],
      ["runtime", "Runtime error"],
      ["crash", "Game crashed"],
      ["security", "Security boundary"],
      ["unsupported", "Unsupported Nova API version"],
    ];
    for (const [category, label] of cases) {
      const diagnostic = diagnosticFromRuntimeError(runtimeError(category, "boom"));
      expect(diagnostic.category).toBe(category);
      expect(diagnostic.message).toBe("boom");
      expect(diagnostic.severity).toBe(RUNTIME_ERROR_CATEGORIES[category].severity);
      expect(RUNTIME_ERROR_CATEGORIES[category].label).toBe(label);
      expect(diagnostic.detail).toContain(RUNTIME_ERROR_CATEGORIES[category].hint);
    }
  });

  it("attaches error details when present", () => {
    const error = runtimeError("syntax", "Unexpected token");
    const diagnostic = diagnosticFromRuntimeError({
      ...error,
      details: { filename: "game.html", lineno: 3 },
    });
    expect(diagnostic.detail).toContain('"lineno":3');
  });
});

describe("diagnosticsFromHostEvent", () => {
  it("maps fatal and unresponsive host events", () => {
    const fatal = diagnosticsFromHostEvent({ type: "fatal", message: "bad message" });
    expect(fatal[0]?.severity).toBe("error");
    expect(fatal[0]?.category).toBe("fatal");
    const unresponsive = diagnosticsFromHostEvent({ type: "unresponsive" });
    expect(unresponsive[0]?.severity).toBe("warning");
    expect(unresponsive[0]?.category).toBe("unresponsive");
    expect(diagnosticsFromHostEvent({ type: "ready", message: { sentAt: 0 } as never })).toEqual(
      [],
    );
  });
});

describe("consoleEntryFromMessage", () => {
  it("carries the level, message, and dropped count", () => {
    const entry = consoleEntryFromMessage({
      version: 1,
      runtimeInstanceId: "runtime-1",
      messageId: "m",
      sentAt: 1_700_000_000_001,
      type: "runtime.console",
      level: "warn",
      message: "flaky",
      dropped: 3,
    });
    expect(entry.level).toBe("warn");
    expect(entry.message).toBe("flaky");
    expect(entry.dropped).toBe(3);
  });
});

describe("buildDiagnosticReport", () => {
  it("includes title, hash, size, validation, diagnostics, and console", () => {
    const report = buildDiagnosticReport({
      title: "Rocket Rumble",
      saved: true,
      sourceHash: "a".repeat(64),
      sourceBytes: 1234,
      runStatus: "running",
      runStartedAt: 1_700_000_000_000,
      runtimeInstanceId: "runtime-9",
      validationIssues: [{ code: "missing_structure", severity: "warning", message: "fragment" }],
      diagnostics: [
        {
          id: "d1",
          severity: "error",
          category: "syntax",
          message: "Unexpected token",
          timestamp: 1_700_000_000_002,
        },
      ],
      consoleEntries: [{ id: "c1", level: "log", message: "hello", timestamp: 1_700_000_000_003 }],
    });
    expect(report).toContain("Rocketcrab Nova — game diagnostic report");
    expect(report).toContain("Game: Rocket Rumble");
    expect(report).toContain("Saved: yes");
    expect(report).toContain(`Source SHA-256: ${"a".repeat(64)}`);
    expect(report).toContain("Source size: 1234 bytes");
    expect(report).toContain("Run status: running");
    expect(report).toContain("Runtime instance: runtime-9");
    expect(report).toContain("[warning] missing_structure — fragment");
    expect(report).toContain("[error] syntax");
    expect(report).toContain("[log] hello");
    expect(report).toContain("Paste this report back into your AI chat");
  });

  it("marks unsaved drafts and empty sections", () => {
    const report = buildDiagnosticReport({
      title: "Draft",
      saved: false,
      sourceHash: "",
      sourceBytes: 0,
      runStatus: "idle",
      validationIssues: [],
      diagnostics: [],
      consoleEntries: [],
    });
    expect(report).toContain("Saved: no (unsaved draft)");
    expect(report).toContain("Source SHA-256: (not computed yet)");
    expect(report).toContain("Runtime instance: none");
    expect(report).toContain("- none");
  });
});
