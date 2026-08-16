import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "accent"
  | "outline"
  | "danger"
  | "default"
  | "info";
export type ButtonSize = "md" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  accent: "btn-accent",
  outline: "btn-outline",
  danger: "btn-error",
  // 5cl.5: the plain daisyUI `btn` is the default button — the neutral
  // variant (btn-neutral) is gone; everywhere it was used now uses
  // "default" (with the same soft/plain treatment as before).
  default: "",
  // 7th pass: the build hero CTA uses the Nova brand color — daisyUI
  // `btn-info` (nova IS the info color, 2t1.3).
  info: "btn-info",
};

const sizeClasses: Record<ButtonSize, string> = {
  md: "btn-md",
  lg: "btn-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Soft (tinted) style — appends `btn-soft` (rocketcrab-2t1.8). */
  soft?: boolean;
}

/**
 * Shared button styling for both `<button>` and router `<Link>` elements.
 * Links should use `className={buttonStyles(...)}` to keep the same look and
 * touch-target size while preserving type-safe route props.
 */
export function buttonStyles(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
  soft = false,
) {
  return cn(
    "btn font-bold",
    variantClasses[variant],
    sizeClasses[size],
    soft && "btn-soft",
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  soft = false,
  className,
  ...props
}: ButtonProps) {
  return (
    <button type="button" className={buttonStyles(variant, size, className, soft)} {...props} />
  );
}
