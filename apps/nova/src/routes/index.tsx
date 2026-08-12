import { Link, createFileRoute } from "@tanstack/react-router";
import { Gamepad2, PlusCircle, Users } from "lucide-react";
import { buttonStyles } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

interface HomeAction {
  to: "/create" | "/join" | "/library" | "/party";
  label: string;
  description: string;
  icon: typeof PlusCircle;
  variant: "primary" | "secondary" | "outline";
}

const actions: HomeAction[] = [
  {
    to: "/create",
    label: "Create a game",
    description: "Copy the AI prompt, chat with a bot, paste the result.",
    icon: PlusCircle,
    variant: "primary",
  },
  {
    to: "/party",
    label: "Start a party",
    description: "Open a lobby now; pick a game before you play (classic flow).",
    icon: Users,
    variant: "secondary",
  },
  {
    to: "/join",
    label: "Join a party",
    description: "Enter a four-letter code from a friend.",
    icon: Users,
    variant: "outline",
  },
  {
    to: "/library",
    label: "My games",
    description: "Your saved games, ready to test and play.",
    icon: Gamepad2,
    variant: "outline",
  },
];

function HomeComponent() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col items-center gap-3 py-6 text-center">
        <p className="text-5xl" aria-hidden="true">
          🦀🚀
        </p>
        <h1 className="text-4xl font-black tracking-tight text-base-content sm:text-5xl">
          Rocketcrab <span className="text-primary">Nova</span>
        </h1>
        <p className="max-w-md text-lg text-base-content/70">
          Create, test, save, and play your own multiplayer browser games — no hosting, no accounts,
          no code setup.
        </p>
      </section>

      <section aria-label="Main actions" className="flex flex-col gap-4">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.to}
              to={action.to}
              className={buttonStyles(
                action.variant,
                "lg",
                "flex items-center gap-4 px-6 py-5 text-left",
              )}
            >
              <Icon className="h-7 w-7 shrink-0" aria-hidden="true" />
              <span className="flex flex-col">
                <span className="text-lg font-black">{action.label}</span>
                <span className="text-sm font-medium opacity-80">{action.description}</span>
              </span>
            </Link>
          );
        })}
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
            description="Games you create or test will show up here. Start with a game idea and let the AI helper draft it for you."
            action={
              <Link to="/create" className={buttonStyles("primary")}>
                Create your first game
              </Link>
            }
          />
        </Card>
      </section>
    </div>
  );
}
