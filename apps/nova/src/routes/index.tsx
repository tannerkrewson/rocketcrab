import { Link, createFileRoute } from "@tanstack/react-router";
import { Gamepad2 } from "lucide-react";
import { buttonStyles } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

/**
 * Home screen, conformed to classic rocketcrab's layout (7.20): tagline
 * centered at the top, Join/Start party primary buttons side by side, a
 * column of secondary actions below, and Nova's "Recent games" at the bottom.
 */
function HomeComponent() {
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col items-center gap-2 pt-6 text-center">
        <p className="text-5xl" aria-hidden="true">
          🦀🚀
        </p>
        <h1 className="text-4xl font-black tracking-tight text-base-content sm:text-5xl">
          Rocketcrab <span className="text-primary">Nova</span>
        </h1>
        <p className="text-lg text-base-content/70">party games for phones</p>
      </section>

      <section aria-label="Start or join a party" className="flex justify-center gap-3">
        <Link
          to="/party"
          search={{ gameId: undefined, mode: undefined, title: undefined }}
          className={buttonStyles("primary", "lg", "flex-1 px-4 sm:flex-none sm:px-10")}
        >
          Start party
        </Link>
        <Link
          to="/join"
          className={buttonStyles("primary", "lg", "flex-1 px-4 sm:flex-none sm:px-10")}
        >
          Join party
        </Link>
      </section>

      <section aria-label="More" className="mx-auto flex w-full max-w-xs flex-col gap-2">
        <Link to="/build" className={buttonStyles("outline", "lg", "w-full")}>
          Build a game
        </Link>
        <Link to="/library" className={buttonStyles("outline", "lg", "w-full")}>
          My games
        </Link>
        <Link to="/about" className={buttonStyles("outline", "lg", "w-full")}>
          About
        </Link>
      </section>

      <section aria-labelledby="recent-games-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="recent-games-heading" className="text-xl font-black">
            Recent games
          </h2>
          <Link to="/library" className="btn btn-ghost btn-sm font-bold">
            See all
          </Link>
        </div>
        <Card className="bg-base-100">
          <EmptyState
            icon={<Gamepad2 />}
            title="No games yet"
            description="Games you build or test will show up here. Start with a game idea and let the AI helper draft it for you."
            action={
              <Link to="/build" className={buttonStyles("primary")}>
                Build your first game
              </Link>
            }
          />
        </Card>
      </section>
    </div>
  );
}
