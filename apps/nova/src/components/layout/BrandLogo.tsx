import { cn } from "../../lib/cn";

export interface BrandLogoProps {
  /**
   * Height of the mark in px (the mark is squarish, so width ≈ size too).
   */
  size?: number;
  /**
   * Cap the mark height by viewport width (`min(size, 16vw)`) so oversized
   * marks scale down on phones (rocketcrab-5cl.5, homepage hero).
   */
  responsive?: boolean;
  /**
   * Which SVG to use (rocketcrab-5u7): "glow" (default) renders the soft
   * ambient halo (public/rocketcrab-logo.svg), "no-glow" renders the flat
   * mark (public/rocketcrab-logo-no-glow.svg). `glow={false}` is an alias
   * for "no-glow". Contexts that need a crisp mark on busy backgrounds
   * (in-game chrome, small inline buttons, …) can opt out.
   */
  variant?: "glow" | "no-glow";
  /** Alias for `variant={"no-glow"}` (rocketcrab-5u7). */
  glow?: boolean;
  className?: string;
}

/**
 * The Rocketcrab brand mark (rocketcrab-5cl.13): the single squarish
 * rocketcrab logo, glow version, replacing the old dual rocket+crab pair
 * (public/rocket.svg + public/crab.svg — deleted). Mark only, no text, and
 * decorative by default (aria-hidden), so callers pair it with their own
 * accessible label (link aria-label, heading text, …). The non-glowing
 * variant is committed too (public/rocketcrab-logo-no-glow.svg) for
 * contexts that want a flat mark; this component renders the glow version
 * for everything (rocketcrab-5u7: `variant="no-glow"` / `glow={false}`
 * switches to the flat mark).
 */
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
      className={cn("inline-flex items-center", className)}
      aria-hidden="true"
      data-testid="brand-logo"
    >
      {/* 480: the party shell header resizes the mark when it compacts
          (5cl.8) — the height must transition on the img itself (a parent
          transition never animates a child's inline style), motion-reduce
          safe like the header's own transition. */}
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
