import { Spinner } from "@heroui/react";
import { cn } from "../../lib/cn";

export interface LoadingStateProps {
  label?: string;
  className?: string;
}

/** HeroUI spinner with an optional label. */
export function LoadingState({ label = "Loading…", className }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex flex-col items-center justify-center gap-3 p-8 text-muted", className)}
    >
      <Spinner aria-hidden="true" />
      <p className="text-sm font-semibold">{label}</p>
      <span className="sr-only">Loading</span>
    </div>
  );
}
