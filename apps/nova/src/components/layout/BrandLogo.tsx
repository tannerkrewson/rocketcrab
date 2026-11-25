import { useEffect, useRef, useState } from "react";

export function BrandLogo({ nova = false }: { nova?: boolean }) {
  const [launching, setLaunching] = useState(false);
  const crabRef = useRef<HTMLSpanElement>(null);
  const logo = nova ? "/rocketcrab-logo-nova.svg" : "/rocketcrab-logo-no-glow.svg";

  useEffect(() => {
    if (!launching) return;
    let active = true;
    const reset = () => {
      if (active) setLaunching(false);
    };
    // Reset the launch pad even if the browser cancels the flight.
    const flight = crabRef.current?.getAnimations?.()[0];
    if (flight) {
      void flight.finished.then(reset, reset);
    } else {
      reset();
    }
    return () => {
      active = false;
    };
  }, [launching]);

  return (
    <button
      type="button"
      aria-label="Launch rocketcrab"
      className="block size-14 shrink-0 cursor-pointer touch-manipulation"
      onClick={() => setLaunching(true)}
    >
      <span ref={crabRef} className={launching ? "block rc-logo-launch" : "block"}>
        {/* The same mark twice: the crab without its resting flame, and the
            flame alone, so the flame can fade as the launch exhaust takes over. */}
        <span className="relative block size-14">
          <img
            src={logo}
            alt=""
            draggable={false}
            className="rc-logo-body block size-14"
            width={56}
            height={56}
            data-testid="brand-logo"
          />
          <img
            src={logo}
            alt=""
            draggable={false}
            className="rc-logo-flame absolute inset-0 block size-14"
            width={56}
            height={56}
          />
        </span>
      </span>
    </button>
  );
}
