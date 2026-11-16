import { cn } from "../../lib/cn";

export interface BrandLogoProps {
  /**
   * Height of the mark in px (the mark is squarish, so width ≈ size too).
   */
  size?: number;
  /** Cap height at min(size, 16vw) so large marks fit on phones. */
  responsive?: boolean;
  /** Use the flat no-glow mark for busy backgrounds; glow is the default. */
  variant?: "glow" | "no-glow";
  /** Alias for variant="no-glow". */
  glow?: boolean;
  className?: string;
}

/** Decorative brand mark; callers must provide their own accessible label. */
export function BrandLogo({
  size = 32,
  responsive = false,
  variant = "glow",
  glow = true,
  className,
}: BrandLogoProps) {
  const noGlow = variant === "no-glow" || glow === false;
  const height = responsive ? `min(${size}px, 16vw)` : `${size}px`;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center overflow-visible", className)}
      aria-hidden="true"
      data-testid="brand-logo"
    >
      {/* Animate the img height itself when the party header compacts;
          parent transitions do not animate a child's inline height. */}
      <img
        src={noGlow ? "/rocketcrab-logo-no-glow.svg" : "/rocketcrab-logo.svg"}
        alt=""
        draggable={false}
        className="block transition-[height] duration-300 ease-out motion-reduce:transition-none"
        style={{ height }}
      />
    </span>
  );
}
