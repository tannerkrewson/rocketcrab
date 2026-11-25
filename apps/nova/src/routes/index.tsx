import { Link, createFileRoute } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "../lib/toast";
import { BrandLogo } from "../components/layout/BrandLogo";
import { InstallAppButton } from "../components/layout/InstallAppButton";
import { Button, buttonStyles } from "../components/ui/Button";
import { PartyCodeForm } from "../components/party/PartyCodeForm";
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
    <div className="flex min-h-[calc(100dvh-16rem)] flex-col items-center justify-center gap-8">
      <section className="flex flex-col items-center gap-3 text-center">
        <BrandLogo />
        <h1 className="font-title text-[2.5rem] font-black leading-none text-foreground sm:text-5xl">
          rocketcrab<span className="text-primary">.com</span>
        </h1>
        <p className="text-lg text-foreground/70">party games for phones</p>
      </section>

      <div className="flex w-full max-w-md flex-col gap-4">
        <Link
          to="/build"
          data-testid="nova-card"
          className="rc-nova-card block w-full overflow-hidden rounded-2xl px-6 py-4 text-center transition-transform active:scale-[0.98] motion-reduce:transition-none"
        >
          <span className="block text-lg font-black [text-shadow:0_1px_12px_rgb(0_0_0/0.6)]">
            Introducing <span className="text-nova-text">Nova</span>
          </span>
          <span className="block text-sm text-foreground/85 [text-shadow:0_1px_8px_rgb(0_0_0/0.6)]">
            Build your own games and play them with friends, instantly.
          </span>
        </Link>
        <a
          href="mailto:tannerkrewson@gmail.com?subject=Rocketcrab%20support"
          className="glass flex w-full items-center gap-4 rounded-2xl px-5 py-3.5 text-left text-sm font-semibold transition-transform active:scale-[0.98] motion-reduce:transition-none"
        >
          <Mail className="size-5 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            Enjoy the new Rocketcrab!
            <br />
            Email me if you have issues.
          </span>
          <span className="shrink-0 self-end">-Tanner</span>
        </a>
      </div>

      <div className="flex flex-col items-center gap-6">
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

        <InstallAppButton />

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
      </div>

      <Dialog open={joinHelpOpen} onClose={() => setJoinHelpOpen(false)} title="Join a party">
        <div className="flex flex-col gap-4">
          <p className="leading-relaxed text-foreground/80">
            Enter the code shown on your friend&apos;s screen, scan their QR code with your
            phone&apos;s camera, or open the invite link they sent you.
          </p>
          <PartyCodeForm />
        </div>
      </Dialog>
    </div>
  );
}
