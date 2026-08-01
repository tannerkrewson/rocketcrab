import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-5xl font-black tracking-tight text-primary">🚀🦀 Rocketcrab Nova</h1>
      <p className="text-center text-lg text-base-content/70">
        Create, test, save, and play user-generated multiplayer browser games.
      </p>
      <div className="flex w-full flex-col gap-3">
        <Link to="/create" className="btn btn-primary btn-lg">
          Create a game
        </Link>
        <Link to="/join" className="btn btn-secondary btn-lg">
          Join a party
        </Link>
        <Link to="/library" className="btn btn-outline btn-lg">
          My games
        </Link>
      </div>
    </main>
  );
}
