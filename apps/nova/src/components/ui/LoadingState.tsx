import { cn } from "../../lib/cn";

export interface LoadingStateProps {
  label?: string;
  className?: string;
}

/** Simple loading placeholder with a spinner and optional label. */
export function LoadingState({ label = "Loading…", className }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-3 p-8 text-base-content/70",
        className,
      )}
    >
      <span className="loading loading-spinner loading-lg text-primary" aria-hidden="true" />
      <p className="text-sm font-semibold">{label}</p>
      <span className="sr-only">Loading</span>
    </div>
  );
}
