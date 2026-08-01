import { createFileRoute } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { PagePlaceholder } from "../components/ui/PagePlaceholder";

export const Route = createFileRoute("/play")({
  component: PlayPage,
});

function PlayPage() {
  return (
    <PagePlaceholder
      title="Play"
      description="The live game shell runs here with the game frame front and center and Nova's controls around it."
      icon={<Play />}
    >
      <p className="text-sm font-semibold text-base-content/50">
        The play shell lands here (issues P4 / S2).
      </p>
    </PagePlaceholder>
  );
}
