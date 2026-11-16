import type { CSSProperties } from "react";
import type { PartyEngine } from "../../lib/party/engine";
import { usePartyEngine } from "../../lib/party/use-party";

/** Seeded PRNG keeps star placement stable across mounts and server/client renders. */
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

/** Decorative CSS-only stars; the injected engine is a test seam for the playing-phase signal. */
export function StarfieldBackground({ engine }: { engine?: PartyEngine }) {
  const { state } = usePartyEngine(engine);
  // A game can be selected before the host starts it. Only the playing phase
  // mounts the full-screen shell and should remove the decorative field.
  if (state.phase === "playing") {
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
        className="pointer-events-none fixed inset-0 z-0"
      >
        {STARS.map((star, index) => (
          <span key={index} className="rc-star bg-foreground" style={star} />
        ))}
      </div>
    </>
  );
}
