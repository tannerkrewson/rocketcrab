import { cn } from "../../lib/cn";

export interface BrandLogoProps {
  /**
   * Height of each mark in px. The rocket and crab share it, exactly like
   * classic's MainTitle (2.6em) and GameLayout (1.5em) logo compositions.
   */
  size?: number;
  className?: string;
}

/**
 * The Rocketcrab brand mark (rocketcrab-9fv.11.2): the real SVG logo, never
 * the 🦀🚀 emoji pair. Rocket left, crab right — the classic composition
 * from 83dae6d "use svgs for logo" (components/atoms/MainTitle.tsx) and
 * components/layout/GameLayout.tsx — each with its classic drop-shadow
 * glow: cyan on the rocket, red on the crab. Mark only, no text, and
 * decorative by default (aria-hidden), so callers pair it with their own
 * accessible label (link aria-label, heading text, …).
 */
export function BrandLogo({ size = 32, className }: BrandLogoProps) {
  const gap = Math.max(2, Math.round(size * 0.2));
  return (
    <span
      className={cn("inline-flex items-center", className)}
      style={{ gap: `${gap}px` }}
      aria-hidden="true"
      data-testid="brand-logo"
    >
      <img
        src="/rocket.svg"
        alt=""
        draggable={false}
        className="block"
        style={{ height: `${size}px`, filter: "drop-shadow(0 0 6px cyan)" }}
      />
      <img
        src="/crab.svg"
        alt=""
        draggable={false}
        className="block"
        style={{ height: `${size}px`, filter: "drop-shadow(0 0 6px #ff0000d9)" }}
      />
    </span>
  );
}
