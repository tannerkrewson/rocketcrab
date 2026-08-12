/**
 * Observable HTML-source checks (ADR-0002 single-HTML model, U4 validation
 * categories). The runtime never sanitizes or rewrites game HTML; it only
 * classifies what it can observe so the host can diagnose failures.
 */

export type HtmlSourceIssue = "empty" | "missing_structure" | "ok";

/**
 * Classify a game document:
 * - `empty`: nothing but whitespace — the game cannot start;
 * - `missing_structure`: no `<!doctype` / `<html` opening tag — the document
 *   is a fragment or malformed. It may still run (browsers auto-wrap), so
 *   the runtime reports the issue but executes the source;
 * - `ok`: looks like a complete document.
 */
export function classifyHtmlSource(source: string): HtmlSourceIssue {
  if (source.trim().length === 0) {
    return "empty";
  }
  if (!/<(?:!doctype\b|html\b)/i.test(source)) {
    return "missing_structure";
  }
  return "ok";
}
