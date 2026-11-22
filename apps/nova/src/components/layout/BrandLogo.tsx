import { useEffect, useRef, useState } from "react";

export function BrandLogo({ nova = false }: { nova?: boolean }) {
  const [launching, setLaunching] = useState(false);
  const crabRef = useRef<HTMLSpanElement>(null);

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
      aria-label="Launch Rocketcrab"
      className="block size-14 shrink-0 cursor-pointer touch-manipulation"
      onClick={() => setLaunching(true)}
    >
      <span ref={crabRef} className={launching ? "block rc-logo-launch" : "block"}>
        <img
          src={nova ? "/rocketcrab-logo-nova.svg" : "/rocketcrab-logo-no-glow.svg"}
          alt=""
          draggable={false}
          className="block size-14"
          width={56}
          height={56}
          data-testid="brand-logo"
        />
      </span>
    </button>
  );
}
