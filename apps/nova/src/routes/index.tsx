import { Link, createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { BrandLogo } from "../components/layout/BrandLogo";
import { buttonStyles } from "../components/ui/Button";
import { writeToClipboard } from "../lib/editor/clipboard";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

/**
 * Home screen (7.20 layout, 7.47 brand header): the crab logo and
 * rocketcrab.com title centered with the "party games for phones" tagline,
 * and the "Introducing Nova" alert below it (rocketcrab-2t1.8: dotted
 * outline with an info-colored glowing orb and softly twinkling stars),
 * Join/Start party soft-primary buttons side by side (Join first), and a
 * column of soft-default actions below (My games before Browse games since
 * rocketcrab-2t1.1). The stack hugs its content and is vertically centered
 * in the space above the shared footer (no recent-games browser since
 * 7.35). The title renders in the Inconsolata Variable brand font
 * (9fv.11.5), taps to copy the domain to the clipboard (9fv.11.4), and
 * scales down while pressed (rocketcrab-2t1.8).
 */
function HomeComponent() {
  /** Tap-to-copy the brand title to the clipboard (rocketcrab-9fv.11.4). */
  const handleCopyTitle = async () => {
    const ok = await writeToClipboard("rocketcrab.com");
    if (ok) {
      toast.success("Copied rocketcrab.com to your clipboard.");
    } else {
      toast.error("Couldn't copy rocketcrab.com — copy it manually.");
    }
  };

  return (
    <div className="flex min-h-[calc(100dvh-16rem)] flex-col items-center justify-center gap-10">
      <section className="flex flex-col items-center gap-3 text-center">
        <BrandLogo size={80} />
        <h1
          className="font-title cursor-pointer text-4xl font-black text-base-content transition-transform active:scale-95 sm:text-5xl"
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
        {/* rocketcrab-2t1.8: dotted info alert below the tagline, with the
            same soft glowing-orb family as the lobby idle orbs (info color)
            and a few gently twinkling stars. Purely decorative (aria-hidden)
            and CSS-only, scoped so the homepage stays self-contained.
            2t1.3: the whole alert wears the daisyUI aura in the nova/info
            color — the one aura on the page. */}
        <div className="aura text-info">
          <div
            role="status"
            className="alert alert-info alert-outline relative w-fit overflow-hidden border-dotted"
          >
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              <span className="rc-alert-orb absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-info/25 blur-2xl" />
              <span className="rc-alert-star absolute left-7 top-3 h-1 w-1 rounded-full bg-info" />
              <span
                className="rc-alert-star absolute right-10 top-5 h-1.5 w-1.5 rounded-full bg-info"
                style={{ animationDelay: "0.7s" }}
              />
              <span
                className="rc-alert-star absolute bottom-4 left-12 h-1 w-1 rounded-full bg-info"
                style={{ animationDelay: "1.4s" }}
              />
            </div>
            <style>{`
            @keyframes rc-alert-orb-breathe {
              0%, 100% { opacity: 0.7; transform: translate(-50%, -50%) scale(1); }
              50% { opacity: 1; transform: translate(-50%, -50%) scale(1.12); }
            }
            @keyframes rc-alert-star-twinkle {
              0%, 100% { opacity: 0.2; transform: scale(0.8); }
              50% { opacity: 1; transform: scale(1.15); }
            }
            .rc-alert-orb { animation: rc-alert-orb-breathe 6s ease-in-out infinite; }
            .rc-alert-star { animation: rc-alert-star-twinkle 2.4s ease-in-out infinite; }
            @media (prefers-reduced-motion: reduce) {
              .rc-alert-orb, .rc-alert-star { animation: none !important; }
            }
          `}</style>
            <div className="relative text-center">
              <p className="text-sm font-black">Introducing Nova</p>
              <p className="text-xs opacity-80">
                Build your own games and play them with friends, instantly.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section aria-label="Start or join a party" className="flex justify-center gap-3">
        <Link
          to="/join"
          className={buttonStyles("primary", "lg", "flex-1 px-4 sm:flex-none sm:px-10", true)}
        >
          Join party
        </Link>
        <Link
          to="/party"
          search={{ gameId: undefined, mode: undefined, title: undefined }}
          className={buttonStyles("primary", "lg", "flex-1 px-4 sm:flex-none sm:px-10", true)}
        >
          Start party
        </Link>
      </section>

      <section aria-label="More" className="flex w-fit flex-col gap-2">
        <Link to="/build" className={buttonStyles("neutral", "lg", undefined, true)}>
          Build a game
        </Link>
        <Link to="/library" className={buttonStyles("neutral", "lg", undefined, true)}>
          My games
        </Link>
        <Link to="/browse" className={buttonStyles("neutral", "lg", undefined, true)}>
          Browse games
        </Link>
        <Link to="/about" className={buttonStyles("neutral", "lg", undefined, true)}>
          About
        </Link>
      </section>
    </div>
  );
}
