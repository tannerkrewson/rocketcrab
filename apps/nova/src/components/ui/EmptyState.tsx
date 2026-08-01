import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** Friendly empty state for lists and sections that have nothing yet. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-box border-2 border-dashed border-base-300 bg-base-100 p-8 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="text-4xl" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <p className="text-lg font-bold">{title}</p>
      {description ? <p className="max-w-sm text-base-content/70">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
