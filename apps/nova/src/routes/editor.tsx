import { createFileRoute } from "@tanstack/react-router";
import { EditorPage } from "../components/editor/EditorPage";

export const Route = createFileRoute("/editor")({
  component: EditorRoutePage,
});

/** A blank editor; saved games open through the library's edit route. */
function EditorRoutePage() {
  return <EditorPage />;
}
