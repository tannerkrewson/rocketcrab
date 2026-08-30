import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type AnimationEvent } from "react";
import { toast } from "sonner";
import { BrandLogo } from "../components/layout/BrandLogo";
import { Button, buttonStyles } from "../components/ui/Button";
import { writeToClipboard } from "../lib/editor/clipboard";
import { usePartyEngine } from "../lib/party/use-party";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

type LogoAnimationPhase = "idle" | "shake" | "launch" | "return";

const LOGO_ANIMATION_NAMES = {
  shake: "rc-logo-shake",
  launch: "rc-logo-launch",
  return: "rc-logo-return",
} as const;

const NEXT_LOGO_PHASE: Record<Exclude<LogoAnimationPhase, "idle">, LogoAnimationPhase> = {
  shake: "launch",
  launch: "return",
  return: "idle",
};

/**
 * Home screen (7.20 layout, 7.47 brand header): the crab logo and
 * rocketcrab.com title centered with the "party games for phones" tagline,
 * and the "Introducing Nova" alert below it (rocketcrab-2t1.8 dotted
 * outline; the aura, glowing orb, and twinkling stars were removed in
 * rocketcrab-5cl.6), Join/Start party soft-primary buttons (side by side
 * from sm, stacked full-width on phones — rocketcrab-5cl.5), and a
 * column of soft-default actions below (My games before Browse games since
 * rocketcrab-2t1.1). The stack hugs its content and is vertically centered
 * in the space above the shared footer (no recent-games browser since
 * 7.35). The title renders in the Inconsolata Variable brand font
 * (9fv.11.5), taps to copy the domain to the clipboard (9fv.11.4), and
 * scales down while pressed (rocketcrab-2t1.8). The mark is a separate
 * keyboard-accessible launch control (rocketcrab-aqn.5).
 */
function HomeComponent() {
  const [logoAnimationPhase, setLogoAnimationPhase] = useState<LogoAnimationPhase>("idle");

  const handleLogoLaunch = () => {
    if (logoAnimationPhase !== "idle") return;
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    setLogoAnimationPhase("shake");
  };

  const handleLogoAnimationEnd = (event: AnimationEvent<HTMLSpanElement>) => {
    if (event.target !== event.currentTarget) return;
    setLogoAnimationPhase((currentPhase) => {
      if (currentPhase === "idle") return currentPhase;
      if (LOGO_ANIMATION_NAMES[currentPhase] !== event.animationName) return currentPhase;
      return NEXT_LOGO_PHASE[currentPhase];
    });
  };

  const logoAnimationClass =
    logoAnimationPhase === "idle" ? undefined : LOGO_ANIMATION_NAMES[logoAnimationPhase];

  /** Tap-to-copy the brand title to the clipboard (rocketcrab-9fv.11.4). */
  const handleCopyTitle = async () => {
    const ok = await writeToClipboard("rocketcrab.com");
    if (ok) {
      toast.success("Copied rocketcrab.com to your clipboard.");
    } else {
      toast.error("Couldn't copy rocketcrab.com — copy it manually.");
    }
  };

  // rocketcrab-8z9: it must be impossible to sit in a party while on the
  // homepage. Every route to "/" (the lobby browser's exit links if they
  // slipped through, the native browser back button, a mid-flow navigate)
  // tears the party down instead of leaving a ghost party running.
  const { state, engine } = usePartyEngine();
  const leftRef = useRef(false);
  useEffect(() => {
    if (leftRef.current || !engine.isActive()) {
      return;
    }
    leftRef.current = true;
    const wasInParty =
      state.phase === "lobby" ||
      state.phase === "starting" ||
      state.phase === "playing" ||
      state.phase === "reconnecting";
    void engine.leaveParty().then(() => {
      if (wasInParty) {
        toast.success("You left the party.");
      }
    });
  }, [engine, state.phase]);

  return (
    <div className="flex min-h-[calc(100dvh-16rem)] flex-col items-center justify-center gap-10">
      <section className="flex flex-col items-center gap-3 text-center">
        <Button
          variant="default"
          aria-label="Launch Rocketcrab"
          title="Launch Rocketcrab"
          className="h-auto min-h-0 w-auto rounded-full border-0! bg-transparent! p-0 shadow-none hover:bg-transparent! active:bg-transparent!"
          onClick={handleLogoLaunch}
        >
          <span
            data-testid="logo-animation"
            className={logoAnimationClass}
            onAnimationEnd={handleLogoAnimationEnd}
          >
            <BrandLogo size={80} responsive />
          </span>
        </Button>
        <h1
          className="font-title cursor-pointer text-[2.5rem] font-black leading-none text-base-content transition-transform active:scale-95 sm:text-5xl"
          title="Copy rocketcrab.com to your clipboard"
          tabIndex={0}
          onClick={() => void handleCopyTitle()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void handleCopyTitle();
            }
          }}
        >
          rocketcrab<span className="text-primary">.com</span>
        </h1>
        <p className="text-lg text-base-content/70">party games for phones</p>
        {/* rocketcrab-2t1.8: dotted info alert below the tagline
            (rocketcrab-5cl.6: the daisyUI aura, the glowing orb, and the
            twinkling stars are gone — just the dotted outline and text). */}
        <Link
          to="/build"
          className="alert alert-info alert-outline mt-4 -mb-1 w-fit max-w-[calc(100vw-2rem)] cursor-pointer border-dotted transition-colors hover:bg-info/20 motion-reduce:transition-none"
        >
          <div className="min-w-0 text-center">
            <p className="text-base font-black">Introducing Nova</p>
            <p className="text-sm opacity-80">
              Build your own games and play them with friends, instantly.
            </p>
          </div>
        </Link>
      </section>

      {/* rocketcrab-5cl.5: on phones the two CTAs stack full-width so their
          labels never wrap; from sm they sit side by side again. */}
      <section
        aria-label="Start or join a party"
        className="flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row"
      >
        <Link
          to="/join"
          className={buttonStyles("primary", "lg", "w-full sm:w-auto sm:px-10", true)}
        >
          Join party
        </Link>
        <Link
          to="/party"
          search={{ gameId: undefined, mode: undefined, title: undefined }}
          className={buttonStyles("primary", "lg", "w-full sm:w-auto sm:px-10", true)}
        >
          Start party
        </Link>
      </section>

      <section aria-label="More" className="flex w-fit flex-col gap-2">
        <Link to="/build" className={buttonStyles("default", "lg", undefined, true)}>
          Build a game
        </Link>
        <Link to="/library" className={buttonStyles("default", "lg", undefined, true)}>
          My games
        </Link>
        <Link to="/browse" className={buttonStyles("default", "lg", undefined, true)}>
          Browse games
        </Link>
        <Link to="/about" className={buttonStyles("default", "lg", undefined, true)}>
          About
        </Link>
      </section>
    </div>
  );
}
