import { htmlSourceBytes, htmlSourceWarnBytes } from "@rocketcrab/protocol";
import { sourceByteLength } from "../games/hashing";

/**
 * Mirror runtime HTML-source checks before starting a run. Hard failures
 * block execution; warnings remain visible. Detect observable failures,
 * not game correctness (apps/runtime/src/html-source.ts).
 */

export type SourceIssueCode = "empty" | "missing_structure" | "oversized_source" | "source_size";

export type SourceIssueSeverity = "error" | "warning";

export interface SourceIssue {
  code: SourceIssueCode;
  severity: SourceIssueSeverity;
  message: string;
}

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
