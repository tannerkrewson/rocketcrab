import { createFileRoute } from "@tanstack/react-router";
import { FlaskConical } from "lucide-react";
import { PagePlaceholder } from "../../../components/ui/PagePlaceholder";

export const Route = createFileRoute("/games/$gameId/test")({
  component: TestGamePage,
});

function TestGamePage() {
  return (
    <PagePlaceholder
      title="Test arena"
      description="Run several simulated players on one page to see how your game plays before the real party."
      icon={<FlaskConical />}
    >
      <p className="text-sm font-semibold text-base-content/50">
        The multi-player test arena lands here (issue U6).
      </p>
    </PagePlaceholder>
  );
}
