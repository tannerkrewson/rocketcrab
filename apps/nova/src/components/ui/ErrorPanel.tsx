import { AlertTriangle } from "lucide-react";
import { Button } from "./Button";
import { cn } from "../../lib/cn";

export interface ErrorPanelProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

/** Error alert used across the app for failed operations and route errors. */
export function ErrorPanel({
  title = "Something went wrong",
  message,
  onRetry,
  className,
}: ErrorPanelProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-box border-2 border-error/40 bg-error/10 p-5",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-6 w-6 shrink-0 text-error" aria-hidden="true" />
        <p className="font-black text-error">{title}</p>
      </div>
      {message ? <p className="text-base-content/80">{message}</p> : null}
      {onRetry ? (
        <div className="mt-1">
          <Button variant="default" soft onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
