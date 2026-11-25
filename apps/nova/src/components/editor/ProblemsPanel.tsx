import { AlertTriangle, ChevronDown, Copy } from "lucide-react";
import type { ConsoleEntry, Diagnostic } from "../../lib/editor/diagnostics";
import type { SourceIssue } from "../../lib/editor/validation";
import { Button } from "../ui/Button";

export interface ProblemsPanelProps {
  validationIssues: SourceIssue[];
  diagnostics: Diagnostic[];
  consoleEntries: ConsoleEntry[];
  onCopyReport: () => void;
}

interface Problem {
  id: string;
  severity: "error" | "warning";
  text: string;
  detail?: string;
}

/** Validation issues, runtime errors and console errors/warnings, deduplicated by text. */
function collectProblems({
  validationIssues,
  diagnostics,
  consoleEntries,
}: Omit<ProblemsPanelProps, "onCopyReport">): Problem[] {
  const problems: Problem[] = [];
  const seen = new Set<string>();
  const add = (problem: Problem) => {
    if (seen.has(problem.text)) return;
    seen.add(problem.text);
    problems.push(problem);
  };
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "info") continue;
    add({
      id: diagnostic.id,
      severity: diagnostic.severity,
      text: diagnostic.message,
      ...(diagnostic.detail !== undefined ? { detail: diagnostic.detail } : {}),
    });
  }
  for (const issue of validationIssues) {
    add({ id: `validation-${issue.code}`, severity: issue.severity, text: issue.message });
  }
  for (const entry of consoleEntries) {
    if (entry.level !== "error" && entry.level !== "warn") continue;
    add({
      id: entry.id,
      severity: entry.level === "error" ? "error" : "warning",
      text: entry.message,
    });
  }
  return problems;
}

/**
 * One compact bar for everything wrong with the last run. Collapsed it shows
 * a count; expanded it lists each problem. "Copy for AI" copies the full
 * diagnostic report to paste back into the AI that wrote the game.
 */
export function ProblemsPanel(props: ProblemsPanelProps) {
  const problems = collectProblems(props);
  if (problems.length === 0) return null;
  const errors = problems.filter((problem) => problem.severity === "error").length;
  const label =
    errors > 0
      ? `${errors} ${errors === 1 ? "problem" : "problems"}`
      : `${problems.length} ${problems.length === 1 ? "warning" : "warnings"}`;
  return (
    <details
      className={`group rounded-2xl shadow-surface ${errors > 0 ? "bg-danger/12" : "bg-warning/10"}`}
      aria-label="Problems"
      data-testid="problems-panel"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-2.5">
        <AlertTriangle
          className={`h-4 w-4 shrink-0 ${errors > 0 ? "text-danger" : "text-warning"}`}
          aria-hidden="true"
        />
        <span className="font-black">{label}</span>
        <ChevronDown
          className="h-4 w-4 text-foreground/50 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
        <span className="flex-1" />
        <Button
          size="sm"
          variant="default"
          soft
          onClick={(event) => {
            // Don't toggle the <details> when copying.
            event.preventDefault();
            props.onCopyReport();
          }}
          title="Copy a report of these problems to paste into your AI"
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
          Copy for AI
        </Button>
      </summary>
      <ul className="flex flex-col gap-2 px-4 pb-3 text-sm">
        {problems.map((problem) => (
          <li key={problem.id} className="flex flex-col gap-1">
            <span className={problem.severity === "error" ? "text-danger" : "text-warning"}>
              {problem.text}
            </span>
            {problem.detail ? (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-secondary p-2 text-xs text-foreground/80">
                {problem.detail}
              </pre>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
