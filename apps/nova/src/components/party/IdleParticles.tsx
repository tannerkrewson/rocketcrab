/**
 * Decorative CSS-only ambient glow with stable orb placement. The parent
 * must be positioned and clip overflow to contain the blur. Reduced-motion
 * preferences leave the orbs static.
 */

/** Fixed orb positions keep the low-opacity glow stable across renders. */
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
              // Negative delays start mid-breath, avoiding sequential first-paint pop-ins.
              animation: `rc-orb-breathe ${orb.breathe} ease-in-out -${orb.delay} infinite alternate`,
            }}
          />
        ))}
      </div>
    </>
  );
}
