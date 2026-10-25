import { Chip } from "@heroui/react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type BadgeColor = "default" | "accent" | "success" | "warning" | "danger";

export interface BadgeProps {
  color?: BadgeColor;
  variant?: "soft" | "secondary";
  size?: "sm" | "md";
  className?: string;
  title?: string;
  children?: ReactNode;
}

/** Small HeroUI chip for statuses, counts, and categories. */
export function Badge({
  color = "default",
  variant = "soft",
  size = "sm",
  className,
  title,
  children,
}: BadgeProps) {
  return (
    <Chip
      color={color}
      variant={variant}
      size={size}
      className={cn("font-bold", className)}
      {...(title !== undefined ? { title } : {})}
    >
      {children}
    </Chip>
  );
}
