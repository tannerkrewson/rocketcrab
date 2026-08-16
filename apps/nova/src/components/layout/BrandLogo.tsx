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
 * for everything.
 */
export function BrandLogo({ size = 32, responsive = false, className }: BrandLogoProps) {
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
        src="/rocketcrab-logo.svg"
        alt=""
        draggable={false}
        className="block transition-[height] duration-300 ease-out motion-reduce:transition-none"
        style={{ height }}
      />
    </span>
  );
}
