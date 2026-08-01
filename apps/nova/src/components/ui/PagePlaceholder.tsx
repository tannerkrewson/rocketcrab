import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface PagePlaceholderProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Temporary styled placeholder for routes built out by later issues. */
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
        "flex flex-col items-center justify-center gap-3 rounded-box border-2 border-base-300 bg-base-100 px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="text-4xl" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h1 className="text-2xl font-black">{title}</h1>
      {description ? <p className="max-w-md text-base-content/70">{description}</p> : null}
      {children}
    </section>
  );
}
