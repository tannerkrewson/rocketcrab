import { createFileRoute } from "@tanstack/react-router";
import { EditorPage } from "../components/editor/EditorPage";
import { readDraftSource } from "../lib/editor/draft-handoff";

export const Route = createFileRoute("/editor")({
  component: EditorRoutePage,
});

/** Key by draft id so a new handoff remounts the editor instead of retaining stale state. */
function EditorRoutePage() {
  const draft = readDraftSource();
  return <EditorPage key={draft?.gameId ?? "blank"} initialSource={draft?.source} />;
}
