import { Link, createFileRoute } from "@tanstack/react-router";
import { buttonStyles } from "../components/ui/Button";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

/**
 * Home screen (7.20 layout, 7.47 brand header): the crab logo and
 * rocketcrab.com title centered with an "Introducing Nova" alert directly
 * underneath, Join/Start party primary buttons side by side (Join first),
 * and a column of secondary actions below. The stack hugs its content and
 * is vertically centered in the space above the shared footer (no
 * recent-games browser since 7.35).
 */
function HomeComponent() {
  return (
    <div className="flex min-h-[calc(100dvh-16rem)] flex-col items-center justify-center gap-10">
      <section className="flex flex-col items-center gap-3 text-center">
        <img src="/crab.svg" alt="Rocketcrab logo" className="h-20 w-20" />
        <h1 className="text-4xl font-black tracking-tight text-base-content sm:text-5xl">
          rocketcrab<span className="text-primary">.com</span>
        </h1>
        <div
          role="status"
          className="alert alert-info flex w-fit flex-col items-center gap-0.5 px-6 py-2.5 text-center"
        >
          <p className="text-sm font-black">Introducing Nova</p>
          <p className="text-xs opacity-80">
            Build your own games and play them with friends, instantly.
          </p>
        </div>
        <p className="text-lg text-base-content/70">party games for phones</p>
      </section>

      <section aria-label="Start or join a party" className="flex justify-center gap-3">
        <Link
          to="/join"
          className={buttonStyles("primary", "lg", "flex-1 px-4 sm:flex-none sm:px-10")}
        >
          Join party
        </Link>
        <Link
          to="/party"
          search={{ gameId: undefined, mode: undefined, title: undefined }}
          className={buttonStyles("primary", "lg", "flex-1 px-4 sm:flex-none sm:px-10")}
        >
          Start party
        </Link>
      </section>

      <section aria-label="More" className="flex w-fit flex-col gap-2">
        <Link to="/build" className={buttonStyles("outline", "lg")}>
          Build a game
        </Link>
        <Link to="/library" className={buttonStyles("outline", "lg")}>
          My games
        </Link>
        <Link to="/about" className={buttonStyles("outline", "lg")}>
          About
        </Link>
      </section>
    </div>
  );
}
