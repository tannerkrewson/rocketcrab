import { createFileRoute } from "@tanstack/react-router";
import { Code2 } from "lucide-react";
import { PagePlaceholder } from "../../../components/ui/PagePlaceholder";

export const Route = createFileRoute("/games/$gameId/edit")({
  component: EditGamePage,
});

function EditGamePage() {
  return (
    <PagePlaceholder
      title="Edit game"
      description="Paste, edit, run, and fix your game's HTML here."
      icon={<Code2 />}
    >
      <p className="text-sm font-semibold text-base-content/50">
        The HTML editor lands here (issue U4).
      </p>
    </PagePlaceholder>
  );
}
