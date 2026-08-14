/**
 * A cheap CSS-only idle animation for the lobby welcome card (10.6 / 11.7):
 * a soft pulsing gradient orb — a blurred radial blob that slowly breathes
 * — wrapped by a faint rotating ring and two small drifting satellite
 * orbs. Purely decorative (aria-hidden) and respects
 * `prefers-reduced-motion` — the orbs render static instead of animating.
 *
 * Nothing is clipped: every element stays inside the container's bounds
 * (blur spread and drift are sized to fit the fixed-height area with
 * margin to spare) and the container does not set `overflow: hidden`, so
 * there are no invisible cut-off lines like the old floating particles.
 *
 * No dependencies, no canvas, no JS animation loop: just keyframes defined
 * in a scoped `<style>` tag so the component is self-contained.
 */

/** Per-orb sizing + animation config (drift loops stay inside the area). */
const ORBS = [
  {
    className: "h-14 w-14 bg-primary/35 blur-lg",
    breathe: "7s",
    drift: "rc-orb-drift-a",
    driftDuration: "10s",
  },
  {
    className: "h-10 w-10 bg-secondary/30 blur-lg",
    breathe: "9s",
    drift: "rc-orb-drift-b",
    driftDuration: "12s",
  },
  {
    className: "h-8 w-8 bg-accent/30 blur-md",
    breathe: "8s",
    drift: "rc-orb-drift-c",
    driftDuration: "11s",
  },
];

export function IdleParticles() {
  return (
    <>
      <style>{`
        .rc-idle-orbs {
          position: relative;
          height: 7rem;
          width: 100%;
        }
        .rc-idle-orb {
          position: absolute;
          top: 50%;
          left: 50%;
          border-radius: 9999px;
        }
        .rc-idle-ring {
          position: absolute;
          top: 50%;
          left: 50%;
          height: 6rem;
          width: 6rem;
          border-radius: 9999px;
          border: 2px dashed color-mix(in oklab, var(--color-primary) 18%, transparent);
          transform: translate(-50%, -50%);
          animation: rc-orb-spin 28s linear infinite;
        }
        @keyframes rc-orb-breathe {
          0% { transform: translate(-50%, -50%) scale(1); opacity: 0.75; }
          50% { transform: translate(-50%, -50%) scale(1.15); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 0.75; }
        }
        @keyframes rc-orb-drift-a {
          0% { transform: translate(-50%, -50%) translate(0, 0); }
          33% { transform: translate(-50%, -50%) translate(0.5rem, -0.5rem); }
          66% { transform: translate(-50%, -50%) translate(-0.4rem, 0.5rem); }
          100% { transform: translate(-50%, -50%) translate(0, 0); }
        }
        @keyframes rc-orb-drift-b {
          0% { transform: translate(-50%, -50%) translate(0, 0); }
          33% { transform: translate(-50%, -50%) translate(-0.7rem, 0.4rem); }
          66% { transform: translate(-50%, -50%) translate(0.5rem, -0.6rem); }
          100% { transform: translate(-50%, -50%) translate(0, 0); }
        }
        @keyframes rc-orb-drift-c {
          0% { transform: translate(-50%, -50%) translate(0, 0); }
          33% { transform: translate(-50%, -50%) translate(0.6rem, 0.5rem); }
          66% { transform: translate(-50%, -50%) translate(-0.5rem, -0.4rem); }
          100% { transform: translate(-50%, -50%) translate(0, 0); }
        }
        @keyframes rc-orb-spin {
          from { transform: translate(-50%, -50%) rotate(0deg); }
          to { transform: translate(-50%, -50%) rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          /* Inline animation styles would otherwise beat this rule. */
          .rc-idle-orb,
          .rc-idle-ring {
            animation: none !important;
            opacity: 0.7;
          }
        }
      `}</style>
      <div className="rc-idle-orbs" aria-hidden="true">
        <span className="rc-idle-ring" />
        {ORBS.map((orb, index) => (
          <span
            key={index}
            className={`rc-idle-orb ${orb.className}`}
            style={{
              animation: `rc-orb-breathe ${orb.breathe} ease-in-out infinite alternate, ${orb.drift} ${orb.driftDuration} ease-in-out infinite`,
            }}
          />
        ))}
      </div>
    </>
  );
}
