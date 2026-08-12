import { Square } from "lucide-react";
import type { RefObject } from "react";
import type { RuntimeStatus } from "../../lib/editor/runtime-session";
import { Button } from "../ui/Button";

export interface PreviewPanelProps {
  containerRef: RefObject<HTMLDivElement | null>;
  status: RuntimeStatus;
  onStop: () => void;
  /** True when the editor source differs from the source currently running. */
  stale?: boolean;
}

const STATUS_LABELS: Record<RuntimeStatus, string> = {
  idle: "Not running",
  starting: "Starting…",
  running: "Running",
  stopped: "Stopped",
  failed: "Startup failed",
};

const STATUS_BADGE: Record<RuntimeStatus, string> = {
  idle: "badge-ghost",
  starting: "badge-info",
  running: "badge-success",
  stopped: "badge-ghost",
  failed: "badge-error",
};

/**
 * The runtime preview panel: hosts the sandboxed game frame (via
 * RuntimeHostClient, U3) and shows run status with an Emergency-Stop style
 * control that lives outside the frame.
 */
export function PreviewPanel({ containerRef, status, onStop, stale = false }: PreviewPanelProps) {
  return (
    <section className="flex flex-col gap-2" aria-label="Preview">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-black">Preview</h2>
          <span className={`badge badge-sm ${STATUS_BADGE[status]}`}>{STATUS_LABELS[status]}</span>
        </div>
        {status === "running" || status === "starting" ? (
          <Button variant="outline" size="md" onClick={onStop}>
            <Square className="h-4 w-4" aria-hidden="true" />
            Stop
          </Button>
        ) : null}
      </header>
      {stale && status === "running" ? (
        <p className="text-xs font-semibold text-warning">
          The preview shows the last Run — edit the code and Run again to see changes.
        </p>
      ) : null}
      {status === "running" ? (
        <p
          className="rounded-box border border-base-300 bg-base-200/60 px-3 py-2 text-xs font-semibold leading-relaxed text-base-content/70"
          data-testid="preview-no-session-note"
        >
          Preview has no party session — multiplayer games show “Connecting” here. Run{" "}
          <span className="font-bold">Test multiplayer</span> (arena) or{" "}
          <span className="font-bold">Play with friends</span> (party) to connect real players.
        </p>
      ) : null}
      <div
        ref={containerRef}
        className="h-[40vh] min-h-64 overflow-hidden rounded-box border-2 border-base-300 bg-base-100"
        data-testid="runtime-frame-container"
      />
    </section>
  );
}
