import { createFileRoute } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { PagePlaceholder } from "../components/ui/PagePlaceholder";

export const Route = createFileRoute("/join")({
  component: JoinPage,
});

function JoinPage() {
  return (
    <PagePlaceholder
      title="Join a party"
      description="Got a four-letter code from a friend? Type it here and jump into their game."
      icon={<KeyRound />}
    >
      <p className="text-sm font-semibold text-base-content/50">
        Four-letter code entry lands here (issues P2 / P4).
      </p>
    </PagePlaceholder>
  );
}
