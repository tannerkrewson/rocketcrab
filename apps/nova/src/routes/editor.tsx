import { createFileRoute } from "@tanstack/react-router";
import { EditorPage } from "../components/editor/EditorPage";
import { readDraftSource } from "../lib/editor/draft-handoff";

export const Route = createFileRoute("/editor")({
  component: EditorRoutePage,
});

/**
 * The blank game editor (A4): the paste target for the master-prompt flow.
 * When the /build generator handed off a draft source (sessionStorage),
 * this route seeds the editor with it; otherwise the editor starts empty.
 * The component is keyed by the draft id so a new paste always remounts the
 * editor with the new source instead of keeping stale state.
 */
function EditorRoutePage() {
  const draft = readDraftSource();
  return <EditorPage key={draft?.gameId ?? "blank"} initialSource={draft?.source} />;
}
