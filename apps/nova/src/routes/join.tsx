import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/join")({
  component: JoinPlaceholder,
});

function JoinPlaceholder() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6">
      <h2 className="text-3xl font-bold">Join a party</h2>
      <p className="text-base-content/70">Four-letter code entry lands here (see issue P2/P4).</p>
    </main>
  );
}
