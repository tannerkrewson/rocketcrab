import { Button as HeroButton, type ButtonProps as HeroButtonProps } from "@heroui/react";
import { buttonVariants } from "@heroui/styles";
import { cn } from "../../lib/cn";

/** Nova button intents, mapped onto HeroUI's semantic variants. */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "accent"
  | "outline"
  | "danger"
  | "default"
  | "info"
  | "tertiary";
export type ButtonSize = "sm" | "md" | "lg";

type HeroVariant = NonNullable<HeroButtonProps["variant"]>;

function heroVariant(variant: ButtonVariant, soft: boolean): HeroVariant {
  switch (variant) {
    case "primary":
    case "info":
      return soft ? "secondary" : "primary";
    case "accent":
      return "primary";
    case "secondary":
      return "secondary";
    case "outline":
      return "outline";
    case "danger":
      return soft ? "danger-soft" : "danger";
    case "default":
      return soft ? "tertiary" : "secondary";
    case "tertiary":
      return "tertiary";
  }
}

export interface ButtonProps extends Omit<
  HeroButtonProps,
  "variant" | "size" | "className" | "children"
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children?: React.ReactNode;
  /** Native tooltip text (HeroUI forwards it to the button element). */
  title?: string;
  /** Compatibility alias for HeroUI's `isDisabled`. */
  disabled?: boolean;
}

/**
 * Shared HeroUI button. `variant`/`size` keep Nova's intent vocabulary while
 * HeroUI owns the visuals; `soft` maps to the nearest tinted HeroUI variant.
 */
export function Button({
  variant = "primary",
  size = "md",
  soft = false,
  className,
  disabled,
  ...props
}: ButtonProps & { soft?: boolean }) {
  return (
    <HeroButton
      variant={heroVariant(variant, soft)}
      size={size}
      isDisabled={disabled ?? props.isDisabled}
      className={cn("font-bold", className)}
      {...props}
    />
  );
}

/**
 * The same button styling for router `<Link>` elements, which must keep
 * type-safe route props instead of rendering a <button>.
 */
export function buttonStyles(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
  soft = false,
) {
  return cn("font-bold", buttonVariants({ variant: heroVariant(variant, soft), size }), className);
}
