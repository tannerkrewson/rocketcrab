import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/library")({
  component: LibraryPlaceholder,
});

function LibraryPlaceholder() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6">
      <h2 className="text-3xl font-bold">My games</h2>
      <p className="text-base-content/70">The local game library lands here (see issue U2).</p>
    </main>
  );
}
