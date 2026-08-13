import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "accent" | "outline" | "danger";
export type ButtonSize = "md" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  accent: "btn-accent",
  outline: "btn-outline",
  danger: "btn-error",
};

const sizeClasses: Record<ButtonSize, string> = {
  md: "btn-md",
  lg: "btn-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
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
) {
  return cn("btn font-bold", variantClasses[variant], sizeClasses[size], className);
}

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  return <button type="button" className={buttonStyles(variant, size, className)} {...props} />;
}
