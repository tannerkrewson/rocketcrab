/**
 * A cheap CSS-only idle animation for the lobby welcome card (10.6 / 11.7,
 * redesigned 5cl.6): a soft, ambient "alien" glow BEHIND the card content.
 * Several blurred, saturated gradient orbs breathe slowly from DIFFERENT
 * origins spread across the container, so the glow reads as multiple soft
 * light sources instead of one centered blob.
 *
 * The old decorative spinning dashed ring is gone (2t1.9), and the
 * single-centered glow is gone (5cl.6): each orb gets a stable hardcoded
 * position (left/top percentages), size, color, duration and delay so the
 * layout never reshuffles between renders. The orbs are a wide, low-opacity
 * background layer — the "Welcome to rocketcrab!" text stays readable on
 * top (2t1.9). Purely decorative (aria-hidden) and respects
 * `prefers-reduced-motion` — the orbs render static instead of animating.
 * The parent must be `position: relative` (the lobby welcome card is) and
 * clip with `overflow: hidden` so the blur stays inside.
 *
 * No dependencies, no canvas, no JS animation loop: just keyframes defined
 * in a scoped `<style>` tag so the component is self-contained (a sibling
 * agent applies a similar glow on the build-a-game page — this one lives
 * entirely here).
 */

/**
 * Per-orb config (5cl.6): stable hardcoded variety — distinct positions
 * spread across the container, sizes, colors, breathing durations and
 * delays. Opacities stay low so the text reads on top.
 */
const ORBS = [
  {
    className: "h-40 w-72 bg-primary/40 blur-2xl",
    left: "6%",
    top: "8%",
    breathe: "7s",
    delay: "0s",
  },
  {
    className: "h-32 w-56 bg-secondary/35 blur-2xl",
    left: "60%",
    top: "4%",
    breathe: "9s",
    delay: "1.4s",
  },
  {
    className: "h-28 w-48 bg-accent/35 blur-xl",
    left: "34%",
    top: "60%",
    breathe: "8s",
    delay: "0.7s",
  },
  {
    className: "h-36 w-64 bg-primary/30 blur-2xl",
    left: "70%",
    top: "52%",
    breathe: "10s",
    delay: "2.2s",
  },
  {
    className: "h-24 w-44 bg-secondary/30 blur-xl",
    left: "18%",
    top: "42%",
    breathe: "6s",
    delay: "1.8s",
  },
  {
    className: "h-20 w-36 bg-accent/30 blur-xl",
    left: "46%",
    top: "16%",
    breathe: "11s",
    delay: "3.1s",
  },
  {
    className: "h-32 w-52 bg-primary/25 blur-2xl",
    left: "78%",
    top: "72%",
    breathe: "12s",
    delay: "0.9s",
  },
];

export function IdleParticles() {
  return (
    <>
      <style>{`
        .rc-idle-glow {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
        }
        .rc-idle-orb {
          position: absolute;
          border-radius: 9999px;
        }
        @keyframes rc-orb-breathe {
          0% { transform: scale(0.92); opacity: 0.5; }
          50% { transform: scale(1.08); opacity: 0.85; }
          100% { transform: scale(0.92); opacity: 0.5; }
        }
        @media (prefers-reduced-motion: reduce) {
          /* Inline animation styles would otherwise beat this rule. */
          .rc-idle-orb {
            animation: none !important;
            opacity: 0.55;
          }
        }
      `}</style>
      <div className="rc-idle-glow" aria-hidden="true">
        {ORBS.map((orb, index) => (
          <span
            key={index}
            className={`rc-idle-orb ${orb.className}`}
            style={{
              left: orb.left,
              top: orb.top,
              animation: `rc-orb-breathe ${orb.breathe} ease-in-out ${orb.delay} infinite alternate`,
            }}
          />
        ))}
      </div>
    </>
  );
}
