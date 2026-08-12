import { createFileRoute } from "@tanstack/react-router";
import { EditorPage } from "../components/editor/EditorPage";

export const Route = createFileRoute("/create")({
  component: CreatePage,
});

/**
 * The create flow (U4): paste one complete HTML game (from the master-prompt
 * interview), run it in the live preview, fix it, then save it to the
 * library. The editor starts in "new game" mode — nothing is persisted
 * until the user saves.
 */
function CreatePage() {
  return <EditorPage />;
}
