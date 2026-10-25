import type { ReactNode } from "react";
import { Card as HeroCard } from "@heroui/react";
import { cn } from "../../lib/cn";

export interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
}

/** HeroUI card used across Nova pages. */
export function Card({ title, description, actions, className, children, id }: CardProps) {
  return (
    <HeroCard id={id} className={cn("w-full", className)}>
      {title || description ? (
        <HeroCard.Header>
          {title ? <HeroCard.Title>{title}</HeroCard.Title> : null}
          {description ? <HeroCard.Description>{description}</HeroCard.Description> : null}
        </HeroCard.Header>
      ) : null}
      {children ? <HeroCard.Content className="gap-3">{children}</HeroCard.Content> : null}
      {actions ? <HeroCard.Footer className="mt-2">{actions}</HeroCard.Footer> : null}
    </HeroCard>
  );
}
