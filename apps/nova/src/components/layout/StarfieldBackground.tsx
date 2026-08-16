import type { CSSProperties } from "react";
import type { PartyEngine } from "../../lib/party/engine";
import { usePartyEngine } from "../../lib/party/use-party";

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
 * Subtle full-page twinkling-star background (5cl.4, site-wide 22n): every
 * page gets the stars EXCEPT while a party is actively playing a game —
 * the in-game condition is `state.game !== null` on the shared party engine
 * (the full-screen play shell is up by then, so stars would be noise behind
 * the game). There is no fade logic: the field is simply present (or
 * unmounted in-game), and the stars twinkle in place. The field sits behind
 * the page content — negative z-index inside the shell's `isolate` stacking
 * context, above the shell's own background — and is decorative only
 * (aria-hidden) and pointer-events-none everywhere. No canvas, no JS
 * animation loop: ~36 CSS-only dots driven by one keyframe, mirroring the
 * IdleParticles approach (2t1.9); prefers-reduced-motion keeps the stars
 * static instead of twinkling.
 *
 * The optional `engine` is a test seam matching `usePartyEngine`'s own
 * injectable engine; production always uses the page singleton.
 */
export function StarfieldBackground({ engine }: { engine?: PartyEngine }) {
  const { state } = usePartyEngine(engine);
  // Bead 22n: in-game = the party engine has an active `game`. During the
  // lobby (and everywhere else) the stars stay up; once a game is live the
  // shell covers the screen and the stars unmount.
  if (state.game !== null) {
    return null;
  }
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
        data-testid="app-starfield"
        className="pointer-events-none fixed inset-0 -z-10"
      >
        {STARS.map((star, index) => (
          <span key={index} className="rc-star bg-base-content" style={star} />
        ))}
      </div>
    </>
  );
}
