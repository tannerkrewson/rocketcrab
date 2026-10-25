import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface PagePlaceholderProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Styled placeholder for routes still being built out. */
export function PagePlaceholder({
  title,
  description,
  icon,
  children,
  className,
}: PagePlaceholderProps) {
  return (
    <section
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-border bg-surface px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="text-4xl" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h1 className="text-2xl font-black">{title}</h1>
      {description ? <p className="max-w-md text-muted">{description}</p> : null}
      {children}
    </section>
  );
}
