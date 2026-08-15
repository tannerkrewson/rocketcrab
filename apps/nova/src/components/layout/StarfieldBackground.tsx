import { useRouterState } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { cn } from "../../lib/cn";

/**
 * Deterministic seeded PRNG (mulberry32) so the same starfield renders on
 * every mount — no flicker between re-renders, no SSR/CSR mismatch
 * (rocketcrab-5cl.4).
 */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A few dozen dots keeps it cheap on low-powered devices. */
const STAR_COUNT = 36;

/** Star placements/sizes/timings, randomized once at module load. */
const STARS: CSSProperties[] = (() => {
  const rand = mulberry32(0x5c1a4);
  return Array.from({ length: STAR_COUNT }, () => {
    const size = rand() < 0.75 ? 1 : 2;
    return {
      left: `${(rand() * 100).toFixed(2)}%`,
      top: `${(rand() * 100).toFixed(2)}%`,
      width: `${size}px`,
      height: `${size}px`,
      animation: `rc-star-twinkle ${(2.5 + rand() * 2.5).toFixed(2)}s ease-in-out ${(rand() * 4).toFixed(2)}s infinite`,
    };
  });
})();

/**
 * Subtle full-page twinkling-star background for the homepage (5cl.4),
 * always mounted in the shared AppLayout so leaving "/" fades the stars out
 * (opacity transition) and returning fades them back in. The field sits
 * behind the page content — negative z-index inside the shell's `isolate`
 * stacking context, above the shell's own background — and is decorative
 * only (aria-hidden) and pointer-events-none everywhere. No canvas, no JS
 * animation loop: ~36 CSS-only dots driven by one keyframe, mirroring the
 * IdleParticles approach (2t1.9); prefers-reduced-motion keeps the stars
 * static instead of twinkling.
 */
export function StarfieldBackground() {
  const isHome = useRouterState({ select: (state) => state.location.pathname === "/" });
  return (
    <>
      <style>{`
        .rc-star {
          position: absolute;
          border-radius: 9999px;
        }
        @keyframes rc-star-twinkle {
          0%, 100% { opacity: 0.08; }
          50% { opacity: 0.6; }
        }
        @media (prefers-reduced-motion: reduce) {
          /* Inline animation styles would otherwise beat this rule. */
          .rc-star {
            animation: none !important;
            opacity: 0.3;
          }
        }
      `}</style>
      <div
        aria-hidden="true"
        data-testid="home-starfield"
        className={cn(
          "pointer-events-none fixed inset-0 -z-10 transition-opacity duration-1000",
          isHome ? "opacity-100" : "opacity-0",
        )}
      >
        {STARS.map((star, index) => (
          <span key={index} className="rc-star bg-base-content" style={star} />
        ))}
      </div>
    </>
  );
}
