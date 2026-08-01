import { createFileRoute } from "@tanstack/react-router";
import { ClipboardPenLine } from "lucide-react";
import { PagePlaceholder } from "../components/ui/PagePlaceholder";

export const Route = createFileRoute("/create")({
  component: CreatePage,
});

function CreatePage() {
  return (
    <PagePlaceholder
      title="Create a game"
      description="Copy one master prompt, let an AI chatbot interview you, then paste the finished HTML game right here."
      icon={<ClipboardPenLine />}
    >
      <p className="text-sm font-semibold text-base-content/50">
        The full prompt workflow lands here (issue U4).
      </p>
    </PagePlaceholder>
  );
}
