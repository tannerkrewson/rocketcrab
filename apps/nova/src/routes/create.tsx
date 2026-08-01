import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/create")({
  component: CreatePlaceholder,
});

function CreatePlaceholder() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6">
      <h2 className="text-3xl font-bold">Create a game</h2>
      <p className="text-base-content/70">The AI prompt workflow lands here (see issue U4).</p>
    </main>
  );
}
