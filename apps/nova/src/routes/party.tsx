import { createFileRoute } from "@tanstack/react-router";
import { PartyPopper } from "lucide-react";
import { PagePlaceholder } from "../components/ui/PagePlaceholder";

export const Route = createFileRoute("/party")({
  component: PartyPage,
});

function PartyPage() {
  return (
    <PagePlaceholder
      title="Party lobby"
      description="Your room code, invite link, player list, and game transfer status will appear here."
      icon={<PartyPopper />}
    >
      <p className="text-sm font-semibold text-base-content/50">
        The party lobby lands here (issue P4).
      </p>
    </PagePlaceholder>
  );
}
