import { Link, createRootRoute } from "@tanstack/react-router";
import { AppLayout } from "../components/layout/AppLayout";
import { ErrorPanel } from "../components/ui/ErrorPanel";
import { buttonStyles } from "../components/ui/Button";

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: RootErrorComponent,
  notFoundComponent: RootNotFoundComponent,
});

function RootComponent() {
  return <AppLayout />;
}

function messageFromError(error: unknown): string | undefined {
  if (error instanceof Error && error.message) return error.message;
  return undefined;
}

function RootErrorComponent({ error }: { error: unknown }) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12">
      <ErrorPanel title="This page hit a snag" message={messageFromError(error)} />
      <div className="mt-6">
        <Link to="/" className={buttonStyles("secondary")}>
          Back to home
        </Link>
      </div>
    </main>
  );
}

function RootNotFoundComponent() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="text-6xl" aria-hidden="true">
        🚀
      </p>
      <h1 className="text-3xl font-black">Lost in space</h1>
      <p className="text-base-content/70">
        That page drifted off into the void. It doesn't exist (or hasn't been built yet).
      </p>
      <Link to="/" className={buttonStyles("primary", "lg")}>
        Back to home
      </Link>
    </main>
  );
}
