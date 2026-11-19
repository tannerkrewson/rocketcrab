import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type AnimationEvent } from "react";
import { toast } from "../lib/toast";
import { BrandLogo } from "../components/layout/BrandLogo";
import { NovaSilk } from "../components/backgrounds/NovaSilk";
import { Button, buttonStyles } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { writeToClipboard } from "../lib/editor/clipboard";
import { usePartyEngine } from "../lib/party/use-party";

/** The secondary menu: glass buttons sized to the longest label (button-stack). */
const MORE_LINK = buttonStyles("default", "lg", undefined, true);

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

function HomeComponent() {
  const [logoAnimationPhase, setLogoAnimationPhase] = useState<LogoAnimationPhase>("idle");
  // Joining needs a friend's invite link, so Join party explains how to get one.
  const [joinHelpOpen, setJoinHelpOpen] = useState(false);

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

  const handleCopyTitle = async () => {
    const ok = await writeToClipboard("rocketcrab.com");
    if (ok) {
      toast.success("Copied rocketcrab.com to your clipboard.");
    } else {
      toast.danger("Couldn't copy rocketcrab.com — copy it manually.");
    }
  };

  // Visiting home must leave any active party, including via the browser Back button.
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
    // vt-nova-home: fades back in once the Nova silk has shrunk into its card.
    <div className="vt-nova-home flex min-h-[calc(100dvh-16rem)] flex-col items-center justify-center gap-10">
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
          className="font-title cursor-pointer text-[2.5rem] font-black leading-none text-foreground transition-transform active:scale-95 sm:text-5xl"
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
        <p className="text-lg text-foreground/70">party games for phones</p>
        {/* Same satin as the /build hero; the shared view-transition name
            expands this card into the hero (and back via its back link). */}
        <Link
          to="/build"
          viewTransition={{ types: ["nova-open"] }}
          data-testid="nova-card"
          className="vt-nova-hero relative mt-4 -mb-1 block w-full max-w-md overflow-hidden rounded-2xl bg-background px-6 py-4 text-center transition-transform active:scale-[0.98] motion-reduce:transition-none"
        >
          <NovaSilk />
          <span className="relative block text-lg font-black [text-shadow:0_1px_12px_rgb(0_0_0/0.8)]">
            Introducing <span className="text-nova-text">Nova</span>
          </span>
          <span className="relative block text-sm text-foreground/85 [text-shadow:0_1px_8px_rgb(0_0_0/0.8)]">
            Build your own games and play them with friends, instantly.
          </span>
        </Link>
      </section>

      <section aria-label="Start or join a party" className="button-row">
        <Button variant="primary" size="lg" onClick={() => setJoinHelpOpen(true)}>
          Join party
        </Button>
        <Link
          to="/party"
          search={{ gameId: undefined, mode: undefined, title: undefined }}
          className={buttonStyles("primary", "lg")}
        >
          Start party
        </Link>
      </section>

      <section aria-label="More" className="button-stack">
        <Link to="/build" className={MORE_LINK}>
          Build a game
        </Link>
        <Link to="/library" className={MORE_LINK}>
          My games
        </Link>
        <Link to="/browse" className={MORE_LINK}>
          Browse games
        </Link>
        <Link to="/about" className={MORE_LINK}>
          About
        </Link>
      </section>

      <Dialog open={joinHelpOpen} onClose={() => setJoinHelpOpen(false)} title="Join a party">
        <div className="flex flex-col gap-4">
          <p className="leading-relaxed text-foreground/80">
            Ask a friend who&apos;s already in the party to send you their invite link, or scan the
            QR code on their screen with your phone&apos;s camera. Opening the link takes you
            straight into their party.
          </p>
          <Button variant="primary" className="self-end" onClick={() => setJoinHelpOpen(false)}>
            Got it
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
