import { Link } from "@tanstack/react-router";
import { cn } from "../../lib/cn";
import { BrandLogo } from "./BrandLogo";

export interface BrandHeaderProps {
  /** Logo height in px (default 24). */
  size?: number;
  /** Faded treatment for in-party browsing so the browser stays the focus. */
  dimmed?: boolean;
  /**
   * Render as a plain row instead of a link home. Compact in-party contexts
   * use this so the brand row can't yank the player out of the party.
   */
  noLink?: boolean;
  className?: string;
}

/**
 * Small rocketcrab.com brand row (2t1.1/2t1.7): logo + monospace domain,
 * centered. The homepage keeps the big hero; every sub-page (browse / my
 * games / about / build / game details) reuses this compact row so the
 * brand never disappears after leaving home. Links home by default (mark +
 * text are decorative via BrandLogo; the link carries the accessible
 * label); party contexts pass `noLink` so the row stays inert.
 */
export function BrandHeader({
  size = 24,
  dimmed = false,
  noLink = false,
  className,
}: BrandHeaderProps) {
  const inner = (
    <>
      <BrandLogo size={size} />
      <span className="font-title text-lg font-black text-base-content">
        rocketcrab<span className="text-primary">.com</span>
      </span>
    </>
  );
  const classes = cn(
    "flex items-center justify-center gap-2 self-center transition-opacity",
    dimmed ? "opacity-50 hover:opacity-80" : "hover:opacity-70",
    className,
  );
  if (noLink) {
    return (
      <div className={classes} data-testid="browser-brand-row" aria-hidden="true">
        {inner}
      </div>
    );
  }
  return (
    <Link to="/" aria-label="rocketcrab.com — home" className={classes}>
      {inner}
    </Link>
  );
}
