import { Copy, Hash, Ruler } from "lucide-react";
import type { ConsoleEntry, Diagnostic } from "../../lib/editor/diagnostics";
import { formatBytes, type SourceIssue } from "../../lib/editor/validation";
import { Button } from "../ui/Button";

export interface DiagnosticsPanelProps {
  sourceBytes: number;
  sourceHash: string;
  validationIssues: SourceIssue[];
  diagnostics: Diagnostic[];
  consoleEntries: ConsoleEntry[];
  onCopyReport: () => void;
  busy?: boolean;
}

function SeverityBadge({ severity }: { severity: Diagnostic["severity"] }) {
  const classes: Record<Diagnostic["severity"], string> = {
    error: "badge-error",
    warning: "badge-warning",
    info: "badge-info",
  };
  return <span className={`badge badge-sm ${classes[severity]}`}>{severity}</span>;
}

function ConsoleBadge({ level }: { level: ConsoleEntry["level"] }) {
  const classes: Record<ConsoleEntry["level"], string> = {
    debug: "badge-ghost",
    log: "badge-ghost",
    info: "badge-info",
    warn: "badge-warning",
    error: "badge-error",
  };
  return <span className={`badge badge-sm ${classes[level]}`}>{level}</span>;
}

/**
 * The editor's diagnostics panel (U4 "runtime error panel" + source-size
 * display + source-hash display + copyable report). Shows live source
 * validation, runtime diagnostics from the current run, a bounded console
 * tail, and a button that copies the whole report for pasting back into an
 * AI chat.
 */
export function DiagnosticsPanel({
  sourceBytes,
  sourceHash,
  validationIssues,
  diagnostics,
  consoleEntries,
  onCopyReport,
  busy = false,
}: DiagnosticsPanelProps) {
  return (
    <section className="flex flex-col gap-3" aria-label="Errors and diagnostics">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-black">Diagnostics</h2>
        <Button variant="default" soft size="md" onClick={onCopyReport} disabled={busy}>
          <Copy className="h-4 w-4" aria-hidden="true" />
          Copy report
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-base-content/60">
        <span className="inline-flex items-center gap-1">
          <Ruler className="h-3.5 w-3.5" aria-hidden="true" />
          {formatBytes(sourceBytes)}
        </span>
        <span
          className="inline-flex items-center gap-1 font-mono"
          title={`Source SHA-256: ${sourceHash || "computing…"}`}
        >
          <Hash className="h-3.5 w-3.5" aria-hidden="true" />
          {sourceHash ? `${sourceHash.slice(0, 12)}…` : "computing…"}
        </span>
      </div>

      <div className="flex flex-col gap-2 rounded-box border-2 border-base-300 bg-base-100 p-3">
        <h3 className="text-xs font-black text-base-content/60">Validation</h3>
        {validationIssues.length === 0 ? (
          <p className="text-sm text-base-content/60">Looks like a complete HTML document.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {validationIssues.map((issue) => (
              <li key={issue.code} className="flex items-start gap-2 text-sm">
                <SeverityBadge severity={issue.severity} />
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-box border-2 border-base-300 bg-base-100 p-3">
        <h3 className="text-xs font-black text-base-content/60">Runtime errors</h3>
        {diagnostics.length === 0 ? (
          <p className="text-sm text-base-content/60">No runtime errors from the last run.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {diagnostics.map((diagnostic) => (
              <li key={diagnostic.id} className="flex flex-col gap-1 text-sm">
                <span className="flex items-start gap-2">
                  <SeverityBadge severity={diagnostic.severity} />
                  <span>
                    <span className="font-bold">{diagnostic.category}</span> — {diagnostic.message}
                  </span>
                </span>
                {diagnostic.detail ? (
                  <pre className="ml-9 whitespace-pre-wrap rounded-box bg-base-200 p-2 text-xs text-base-content/80">
                    {diagnostic.detail}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-box border-2 border-base-300 bg-base-100 p-3">
        <h3 className="text-xs font-black text-base-content/60">Console</h3>
        {consoleEntries.length === 0 ? (
          <p className="text-sm text-base-content/60">No console output from the last run.</p>
        ) : (
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto font-mono text-xs">
            {consoleEntries.map((entry) => (
              <li key={entry.id} className="flex items-start gap-2">
                <ConsoleBadge level={entry.level} />
                <span className="break-all text-base-content/80">
                  {entry.message}
                  {entry.dropped ? (
                    <span className="text-warning"> ({entry.dropped} dropped)</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
