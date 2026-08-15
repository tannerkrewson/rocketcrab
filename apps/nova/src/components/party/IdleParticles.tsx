/**
 * A cheap CSS-only idle animation for the lobby welcome card (10.6 / 11.7):
 * a soft, wide ambient glow BEHIND the card content — a few blurred,
 * saturated gradient blobs that slowly breathe, sized as a low band so the
 * "No game selected yet" / waiting text reads on top of the glow (2t1.9).
 *
 * The old decorative spinning dashed ring is gone (2t1.9): the orbs are no
 * longer a small floating element above the text but a larger, wider
 * background layer painted behind it. Purely decorative (aria-hidden) and
 * respects `prefers-reduced-motion` — the orbs render static instead of
 * animating. The parent must be `position: relative` (the lobby welcome
 * card is) and clip with `overflow: hidden` so the blur stays inside.
 *
 * No dependencies, no canvas, no JS animation loop: just keyframes defined
 * in a scoped `<style>` tag so the component is self-contained.
 */

/** Per-orb sizing + breathing config (saturated, wide band behind text). */
const ORBS = [
  {
    className: "h-44 w-80 bg-primary/50 blur-2xl",
    breathe: "7s",
  },
  {
    className: "h-32 w-56 bg-secondary/40 blur-2xl",
    breathe: "9s",
  },
  {
    className: "h-24 w-40 bg-accent/40 blur-xl",
    breathe: "8s",
  },
];

export function IdleParticles() {
  return (
    <>
      <style>{`
        .rc-idle-glow {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
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
              animation: `rc-orb-breathe ${orb.breathe} ease-in-out infinite alternate`,
            }}
          />
        ))}
      </div>
    </>
  );
}
