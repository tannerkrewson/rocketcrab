import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Code2, Play } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, buttonStyles } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { storeDraftSource } from "../lib/editor/draft-handoff";
import { exampleGames, exampleModeLabel, type ExampleGame } from "../lib/editor/example-games";

export const Route = createFileRoute("/examples")({
  component: ExamplesPage,
});

/**
 * Complete example games (examples/games/, shared with the /build flow):
 * each one opens in the editor as a new local draft so users can run,
 * inspect, and modify a real game for each mode (state, simulation, raw) —
 * the same handoff the /build paste target uses.
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
        <Link to="/" className={buttonStyles("default", "md", "w-fit", true)} title="Back to home">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to home
        </Link>
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
                  {exampleModeLabel[game.mode]}
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
