import { createFileRoute, redirect } from "@tanstack/react-router";

/** `/join`, linked from external games: home with the party-code box open. */
export const Route = createFileRoute("/join")({
  beforeLoad: () => {
    throw redirect({ to: "/", search: { join: true }, replace: true });
  },
});
