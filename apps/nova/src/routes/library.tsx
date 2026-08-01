import { Link, createFileRoute } from "@tanstack/react-router";
import { Gamepad2 } from "lucide-react";
import { buttonStyles } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";

export const Route = createFileRoute("/library")({
  component: LibraryPage,
});

function LibraryPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-black">My games</h1>
        <p className="text-base-content/70">
          Games are saved right in this browser. Nothing is uploaded.
        </p>
      </header>
      <EmptyState
        icon={<Gamepad2 />}
        title="No saved games yet"
        description="Once you create or paste a game it will be listed here for testing, editing, and playing."
        action={
          <Link to="/create" className={buttonStyles("primary", "lg")}>
            Create a game
          </Link>
        }
      />
    </div>
  );
}
