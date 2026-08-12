import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Code2, Play } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { storeDraftSource } from "../lib/editor/draft-handoff";

export const Route = createFileRoute("/examples")({
  component: ExamplesPage,
});

type ExampleMode = "state" | "simulation" | "raw";

interface ExampleGame {
  id: string;
  title: string;
  mode: ExampleMode;
  description: string;
  /** Lazy raw import keeps the example sources out of the main bundle. */
  load: () => Promise<{ default: string }>;
}

const modeLabel: Record<ExampleMode, string> = {
  state: "state mode",
  simulation: "simulation mode",
  raw: "raw mode",
};

const exampleGames: ExampleGame[] = [
  {
    id: "nova-quiz",
    title: "Nova Quiz",
    mode: "state",
    description:
      "A round-based trivia game with questions the host writes. Showcases state mode: actions, per-player views, join/leave handling, and mobile-first layout.",
    load: () => import("../../../../examples/games/nova-quiz.html?raw"),
  },
  {
    id: "nova-drift",
    title: "Nova Drift",
    mode: "simulation",
    description:
      "Every player steers a shared puck with the arrow keys. Showcases simulation mode: ordered inputs, the Nova tick clock, and authoritative snapshots.",
    load: () => import("../../../../examples/games/nova-drift.html?raw"),
  },
  {
    id: "raw-mode",
    title: "Chatter (raw mode sample)",
    mode: "raw",
    description:
      "Named channels exchanging structured chat messages and binary position samples. Showcases raw mode: reliable/ordered channels, targeted sends, and progress.",
    load: () => import("../../../../examples/games/raw-mode.html?raw"),
  },
];

/**
 * Complete example games (examples/games/): each one opens in the editor as
 * a new local draft so users can run, inspect, and modify a real game for
 * each mode (state, simulation, raw) — the same handoff the /create paste
 * target uses.
 */
export function ExamplesPage() {
  const navigate = useNavigate();
  const [openingId, setOpeningId] = useState<string | null>(null);

  const handleOpen = async (game: ExampleGame) => {
    if (openingId !== null) return;
    setOpeningId(game.id);
    try {
      const source = (await game.load()).default;
      storeDraftSource(source);
      await navigate({ to: "/editor" });
    } catch {
      toast.error("Couldn't load this example game.");
      setOpeningId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-black">Example games</h1>
        <p className="max-w-2xl text-base-content/70">
          Complete, single-file games that run on Nova — one per mode. Open any of them in the
          editor as a new draft to run it, read the code, and change it into your own game.
        </p>
      </header>

      <section aria-label="Example games" className="flex flex-col gap-4">
        {exampleGames.map((game) => (
          <Card
            key={game.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {game.title}
                <span className="badge badge-accent badge-outline font-bold">
                  {modeLabel[game.mode]}
                </span>
              </span>
            }
            description={game.description}
            actions={
              <Button
                variant="primary"
                onClick={() => void handleOpen(game)}
                disabled={openingId !== null}
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                {openingId === game.id ? "Opening…" : "Open in the editor"}
              </Button>
            }
          >
            <p className="flex items-center gap-1.5 text-xs font-semibold text-base-content/50">
              <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
              examples/games/{game.id}.html
            </p>
          </Card>
        ))}
      </section>
    </div>
  );
}
