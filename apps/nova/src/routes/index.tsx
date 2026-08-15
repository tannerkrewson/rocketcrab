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
 * and the "Introducing Nova" alert below it (rocketcrab-2t1.8 dotted
 * outline; the aura, glowing orb, and twinkling stars were removed in
 * rocketcrab-5cl.6), Join/Start party soft-primary buttons (side by side
 * from sm, stacked full-width on phones — rocketcrab-5cl.5), and a
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
        <BrandLogo size={80} responsive />
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
        <div role="status" className="alert alert-info alert-outline w-fit border-dotted">
          <div className="text-center">
            <p className="text-sm font-black">Introducing Nova</p>
            <p className="text-xs opacity-80">
              Build your own games and play them with friends, instantly.
            </p>
          </div>
        </div>
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
