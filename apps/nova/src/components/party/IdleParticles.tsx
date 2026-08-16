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
 * Per-orb config (5cl.6, rebalanced n6o): stable hardcoded variety —
 * distinct positions spread across the container, sizes, colors, breathing
 * durations and delays. Opacities stay low so the text reads on top. n6o
 * rebalances the vertical spread (the old tops ran 4–72% with three big
 * orbs in the bottom half): the two largest orbs now sit on the middle
 * band next to the headline with two above and two below, so the glow
 * reads centered instead of bottom-heavy.
 */
const ORBS = [
  {
    className: "h-32 w-56 bg-primary/35 blur-2xl",
    left: "8%",
    top: "26%",
    breathe: "7s",
    delay: "1.1s",
  },
  {
    className: "h-28 w-48 bg-secondary/30 blur-2xl",
    left: "64%",
    top: "28%",
    breathe: "9s",
    delay: "2.6s",
  },
  {
    className: "h-36 w-64 bg-accent/30 blur-2xl",
    left: "30%",
    top: "42%",
    breathe: "8s",
    delay: "0.4s",
  },
  {
    className: "h-32 w-56 bg-primary/30 blur-2xl",
    left: "72%",
    top: "46%",
    breathe: "10s",
    delay: "3.9s",
  },
  {
    className: "h-24 w-44 bg-secondary/25 blur-xl",
    left: "16%",
    top: "58%",
    breathe: "6s",
    delay: "2.1s",
  },
  {
    className: "h-20 w-36 bg-accent/35 blur-xl",
    left: "46%",
    top: "18%",
    breathe: "11s",
    delay: "4.2s",
  },
  {
    className: "h-28 w-48 bg-primary/25 blur-2xl",
    left: "80%",
    top: "66%",
    breathe: "12s",
    delay: "1.4s",
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
          0% { transform: scale(0.94); opacity: 0.6; }
          50% { transform: scale(1.06); opacity: 0.9; }
          100% { transform: scale(0.94); opacity: 0.6; }
        }
        @media (prefers-reduced-motion: reduce) {
          /* Inline animation styles would otherwise beat this rule. */
          .rc-idle-orb {
            animation: none !important;
            opacity: 0.75;
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
              // n6o: negative animation-delay starts every orb MID-breath, so
              // the stagger never repeats as an entry flicker: on first paint
              // the orbs are already visibly breathing at their steady
              // mid-range opacity (no dark start, no sequential pop-ins).
              animation: `rc-orb-breathe ${orb.breathe} ease-in-out -${orb.delay} infinite alternate`,
            }}
          />
        ))}
      </div>
    </>
  );
}
