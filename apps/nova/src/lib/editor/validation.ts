import { htmlSourceBytes, htmlSourceWarnBytes } from "@rocketcrab/protocol";
import { sourceByteLength } from "../games/hashing";

/**
 * Host-side HTML-document validation for the editor (U4 "HTML-document
 * validation" + "excessive source size"). These checks mirror what the
 * runtime observes (apps/runtime/src/html-source.ts `classifyHtmlSource`):
 * the editor refuses to start a run for hard errors and surfaces warnings
 * before handing the source to the runtime. Nova never attempts to prove a
 * game is correct (ADR-0002) — only observable failures are detected.
 */

export type SourceIssueCode = "empty" | "missing_structure" | "oversized_source" | "source_size";

export type SourceIssueSeverity = "error" | "warning";

export interface SourceIssue {
  code: SourceIssueCode;
  severity: SourceIssueSeverity;
  message: string;
}

/** Validate the current editor source before a run. */
export function validateSource(source: string): SourceIssue[] {
  const issues: SourceIssue[] = [];
  if (source.trim().length === 0) {
    issues.push({
      code: "empty",
      severity: "error",
      message: "Game source is empty. Paste your HTML into the editor first.",
    });
  } else if (!/<(?:!doctype\b|html\b)/i.test(source)) {
    issues.push({
      code: "missing_structure",
      severity: "warning",
      message:
        "No <!doctype> or <html> tag found. It may still run as a fragment, but a complete HTML document is safer.",
    });
  }
  const bytes = sourceByteLength(source);
  if (bytes > htmlSourceBytes) {
    issues.push({
      code: "oversized_source",
      severity: "error",
      message: `Game source is ${formatBytes(bytes)} — over the ${formatBytes(htmlSourceBytes)} hard limit.`,
    });
  } else if (bytes >= htmlSourceWarnBytes) {
    issues.push({
      code: "source_size",
      severity: "warning",
      message: `Game source is ${formatBytes(bytes)} — getting close to the ${formatBytes(htmlSourceBytes)} hard limit.`,
    });
  }
  return issues;
}

/** Human-friendly byte size ("1.2 KB"), matching GameCard's display. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
