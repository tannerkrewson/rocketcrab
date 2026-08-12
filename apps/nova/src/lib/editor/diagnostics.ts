import type { RuntimeConsoleMessage, RuntimeErrorMessage } from "@rocketcrab/protocol";
import type { RuntimeHostEvent } from "../runtime-host";
import type { SourceIssue } from "./validation";

/**
 * Diagnostics model for the editor's runtime error panel (U4): runtime-plane
 * events are normalized into a small, stable diagnostic shape the UI and the
 * copyable report share. Nova only reports what is observable — it never
 * statically proves game correctness (ADR-0002).
 */

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  id: string;
  severity: DiagnosticSeverity;
  /** Runtime error category, host-side category, or "validation". */
  category: string;
  message: string;
  detail?: string;
  timestamp: number;
}

export interface ConsoleEntry {
  id: string;
  level: RuntimeConsoleMessage["level"];
  message: string;
  dropped?: number;
  timestamp: number;
}

/** Friendly labels for the runtime error categories (U4 validation flow). */
export const RUNTIME_ERROR_CATEGORIES: Record<
  RuntimeErrorMessage["category"],
  { label: string; severity: DiagnosticSeverity; hint: string }
> = {
  empty_source: {
    label: "Empty source",
    severity: "error",
    hint: "The game document is empty, so nothing could start.",
  },
  invalid_html: {
    label: "Missing HTML structure",
    severity: "warning",
    hint: "No <!doctype> or <html> tag; the browser treated the source as a fragment.",
  },
  missing_registration: {
    label: "No game registration",
    severity: "error",
    hint: "The game never called nova.defineGame, so Nova cannot control it.",
  },
  oversized_source: {
    label: "Source too large",
    severity: "error",
    hint: "The game document exceeds the source-size limit.",
  },
  syntax: {
    label: "Syntax error",
    severity: "error",
    hint: "The browser reported a JavaScript syntax error while running the game.",
  },
  remote_load: {
    label: "Remote resource failed",
    severity: "warning",
    hint: "A CDN/asset did not load. Rocketcrab does not proxy the web, so check the URL and your connection.",
  },
  runtime: {
    label: "Runtime error",
    severity: "error",
    hint: "The game raised an error while running.",
  },
  crash: {
    label: "Game crashed",
    severity: "error",
    hint: "The game frame stopped unexpectedly.",
  },
  security: {
    label: "Security boundary",
    severity: "error",
    hint: "A message crossed a trust boundary that should not have been sent.",
  },
  unsupported: {
    label: "Unsupported Nova API version",
    severity: "error",
    hint: "The game declares a Nova API version this build cannot execute.",
  },
};

let diagnosticSequence = 0;

function nextId(prefix: string): string {
  diagnosticSequence += 1;
  return `${prefix}-${diagnosticSequence}`;
}

/** Map a runtime-plane error message onto a UI diagnostic. */
export function diagnosticFromRuntimeError(error: RuntimeErrorMessage): Diagnostic {
  const meta = RUNTIME_ERROR_CATEGORIES[error.category];
  const detail = [
    meta.hint,
    error.details !== undefined ? JSON.stringify(error.details) : undefined,
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n");
  return {
    id: nextId(error.category),
    severity: meta.severity,
    category: error.category,
    message: error.message,
    ...(detail.length > 0 ? { detail } : {}),
    timestamp: error.sentAt,
  };
}

/** Map a host-bridge event onto diagnostics (errors, fatal, unresponsive). */
export function diagnosticsFromHostEvent(event: RuntimeHostEvent): Diagnostic[] {
  switch (event.type) {
    case "error":
      return [diagnosticFromRuntimeError(event.message)];
    case "fatal":
      return [
        {
          id: nextId("fatal"),
          severity: "error",
          category: "fatal",
          message: event.message,
          timestamp: Date.now(),
        },
      ];
    case "unresponsive":
      return [
        {
          id: nextId("unresponsive"),
          severity: "warning",
          category: "unresponsive",
          message: "The game frame stopped responding to the runtime.",
          timestamp: Date.now(),
        },
      ];
    default:
      return [];
  }
}

/** Map a runtime console message onto a console entry for the panel. */
export function consoleEntryFromMessage(message: RuntimeConsoleMessage): ConsoleEntry {
  return {
    id: nextId("console"),
    level: message.level,
    message: message.message,
    ...(message.dropped !== undefined && message.dropped > 0 ? { dropped: message.dropped } : {}),
    timestamp: message.sentAt,
  };
}

export interface DiagnosticReportInput {
  title: string;
  /** False when the game has not been saved yet. */
  saved: boolean;
  sourceHash: string;
  sourceBytes: number;
  runStatus: string;
  runStartedAt?: number;
  runtimeInstanceId?: string | null;
  validationIssues: SourceIssue[];
  diagnostics: Diagnostic[];
  consoleEntries: ConsoleEntry[];
}

/** Plain-text diagnostic report for pasting back into an AI chat (U4). */
export function buildDiagnosticReport(input: DiagnosticReportInput): string {
  const lines: string[] = [
    "Rocketcrab Nova — game diagnostic report",
    `Generated: ${new Date().toISOString()}`,
    `Game: ${input.title}`,
    `Saved: ${input.saved ? "yes" : "no (unsaved draft)"}`,
    `Source SHA-256: ${input.sourceHash || "(not computed yet)"}`,
    `Source size: ${input.sourceBytes} bytes`,
    `Run status: ${input.runStatus}`,
    ...(input.runStartedAt !== undefined
      ? [`Run started: ${new Date(input.runStartedAt).toISOString()}`]
      : []),
    ...(input.runtimeInstanceId
      ? [`Runtime instance: ${input.runtimeInstanceId}`]
      : ["Runtime instance: none"]),
  ];

  const validation = input.validationIssues.map(
    (issue) => `- [${issue.severity}] ${issue.code} — ${issue.message}`,
  );
  lines.push("", "Validation:", ...(validation.length > 0 ? validation : ["- none"]));

  const runtime = input.diagnostics.map(
    (diagnostic) =>
      `- [${diagnostic.severity}] ${diagnostic.category} (${new Date(diagnostic.timestamp).toISOString()}) — ${diagnostic.message}${
        diagnostic.detail ? `\n  ${diagnostic.detail}` : ""
      }`,
  );
  lines.push("", "Runtime diagnostics:", ...(runtime.length > 0 ? runtime : ["- none"]));

  const consoleLines = input.consoleEntries.map(
    (entry) =>
      `- [${entry.level}] ${entry.message}${entry.dropped ? ` (${entry.dropped} dropped)` : ""}`,
  );
  lines.push(
    "",
    `Console (last ${input.consoleEntries.length}):`,
    ...(consoleLines.length > 0 ? consoleLines : ["- none"]),
  );

  lines.push("", "Paste this report back into your AI chat to debug your game.");
  return lines.join("\n");
}
