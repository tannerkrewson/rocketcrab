import { Link, createFileRoute } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "../lib/toast";
import { BrandLogo } from "../components/layout/BrandLogo";
import { Button, buttonStyles } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { usePartyEngine } from "../lib/party/use-party";
import { clarityEvent } from "../lib/clarity";

/** The secondary menu: glass buttons sized to the longest label (button-stack). */
const MORE_LINK = buttonStyles("default", "lg", undefined, true);

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  // Joining needs a friend's invite link, so Join party explains how to get one.
  const [joinHelpOpen, setJoinHelpOpen] = useState(false);

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
      state.phase === "switching" ||
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
        <BrandLogo />
        <h1 className="font-title text-[2.5rem] font-black leading-none text-foreground sm:text-5xl">
          rocketcrab<span className="text-primary">.com</span>
        </h1>
        <p className="text-lg text-foreground/70">party games for phones</p>
        <Link
          to="/build"
          data-testid="nova-card"
          className="relative mt-4 -mb-1 block w-full max-w-md overflow-hidden rounded-2xl bg-[#060b1f] rc-molten-blue px-6 py-4 text-center transition-transform active:scale-[0.98] motion-reduce:transition-none"
        >
          <span className="relative block text-lg font-black [text-shadow:0_1px_12px_rgb(0_0_0/0.8)]">
            Introducing <span className="text-nova-text">Nova</span>
          </span>
          <span className="relative block text-sm text-foreground/85 [text-shadow:0_1px_8px_rgb(0_0_0/0.8)]">
            Build your own games and play them with friends, instantly.
          </span>
        </Link>
      </section>

      <section aria-label="Start or join a party" className="button-row">
        <Button
          variant="primary"
          size="lg"
          onClick={() => {
            clarityEvent("join_help_opened");
            setJoinHelpOpen(true);
          }}
        >
          Join party
        </Button>
        <Link
          to="/party"
          onClick={() => clarityEvent("start_party_clicked")}
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
        <Link
          to="/browse"
          onClick={() => clarityEvent("browse_games_clicked")}
          className={MORE_LINK}
        >
          Browse games
        </Link>
        <Link to="/about" className={MORE_LINK}>
          About
        </Link>
      </section>

      <a
        href="mailto:tannerkrewson@gmail.com?subject=Rocketcrab%20support"
        className={buttonStyles("tertiary", "md", "w-full max-w-md")}
      >
        <Mail className="size-4" aria-hidden="true" />
        Having issues? Email Tanner
      </a>

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
