/**
 * A cheap CSS-only idle animation for the lobby welcome card (10.6): a few
 * soft particles drift upward inside a small rounded area. Purely
 * decorative (aria-hidden) and respects `prefers-reduced-motion` — the
 * particles render static instead of animating.
 *
 * No dependencies, no canvas, no JS animation loop: just keyframes defined
 * in a scoped `<style>` tag so the component is self-contained.
 */

const PARTICLES = [
  { left: "12%", className: "h-2 w-2 bg-primary/60", delay: "0s", duration: "4.5s" },
  { left: "30%", className: "h-3 w-3 bg-secondary/50", delay: "1.2s", duration: "5.5s" },
  { left: "52%", className: "h-2 w-2 bg-accent/60", delay: "0.6s", duration: "4s" },
  { left: "72%", className: "h-3 w-3 bg-primary/40", delay: "2s", duration: "6s" },
  { left: "88%", className: "h-2 w-2 bg-secondary/60", delay: "1.6s", duration: "5s" },
];

export function IdleParticles() {
  return (
    <>
      <style>{`
        .rc-idle-particles {
          position: relative;
          height: 6rem;
          width: 100%;
          overflow: hidden;
        }
        .rc-idle-particle {
          position: absolute;
          bottom: -0.5rem;
          border-radius: 9999px;
          animation-name: rc-float-up;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
        }
        @keyframes rc-float-up {
          0% { transform: translateY(0) scale(1); opacity: 0; }
          15% { opacity: 0.9; }
          85% { opacity: 0.7; }
          100% { transform: translateY(-6.5rem) scale(1.2); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .rc-idle-particle {
            animation: none;
            opacity: 0.6;
          }
        }
      `}</style>
      <div className="rc-idle-particles" aria-hidden="true">
        {PARTICLES.map((particle, index) => (
          <span
            key={index}
            className={`rc-idle-particle ${particle.className}`}
            style={{
              left: particle.left,
              animationDelay: particle.delay,
              animationDuration: particle.duration,
            }}
          />
        ))}
      </div>
    </>
  );
}
