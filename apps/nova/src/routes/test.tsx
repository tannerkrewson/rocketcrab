import { createFileRoute } from "@tanstack/react-router";
import { FlaskConical } from "lucide-react";
import { useMemo } from "react";
import { ArenaPage } from "../components/arena/ArenaPage";
import { EmptyState } from "../components/ui/EmptyState";
import { takeDraftArenaSource } from "../lib/arena/draft-source";

export const Route = createFileRoute("/test")({
  component: TestDraftPage,
});

/**
 * The U6 test arena in draft mode: test an unsaved editor source before
 * saving it to the library. The editor's Test-multiplayer action stores the
 * current source in sessionStorage (see lib/arena/draft-source.ts); the
 * arena consumes it here.
 */
function TestDraftPage() {
  const draft = useMemo(() => takeDraftArenaSource(), []);
  if (draft === null) {
    return (
      <EmptyState
        icon={<FlaskConical />}
        title="Nothing to test yet"
        description="Open a game in the editor and press Test multiplayer to run it here with several simulated players."
      />
    );
  }
  return <ArenaPage draftSource={draft} />;
}
