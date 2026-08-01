import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

/** daisyUI-based card used across Nova pages. */
export function Card({ title, description, actions, className, children, ...props }: CardProps) {
  return (
    <div className={cn("card bg-base-100 shadow-sm", className)} {...props}>
      <div className="card-body gap-3">
        {title ? <h2 className="card-title text-xl font-black">{title}</h2> : null}
        {description ? <p className="text-base-content/70">{description}</p> : null}
        {children}
        {actions ? <div className="card-actions mt-2">{actions}</div> : null}
      </div>
    </div>
  );
}
