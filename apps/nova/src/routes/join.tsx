import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { JoinFlow } from "../components/party/JoinFlow";

export const Route = createFileRoute("/join")({
  component: JoinPage,
});

/**
 * The join route (P2/P4): four-letter code entry, plus invite-link joining.
 * The whole flow (fragment import, code entry, name editing, lobby
 * passthrough) lives in the shared {@link JoinFlow} component so the
 * short-code routes (`/join/:code`, `/:code` — 9fv.8) reuse it with the
 * code prefilled from the path. Invite secrets arrive in the URL fragment
 * (ADR-0011); the fragment is parsed and imported into session memory
 * BEFORE the party route renders, then stripped from the URL so the secret
 * does not linger in history.
 */
function JoinPage() {
  // File-route nesting: join.$code.tsx is a CHILD of /join, so a short-code
  // path (/join/cvvu) matches the child — render it (it renders the shared
  // flow with the code prefilled). Plain /join renders the flow directly;
  // /join?edit=name and the party-active passthrough stay on the flow.
  const codeChildMatched = useRouterState({
    select: (state) => state.matches.some((match) => match.routeId === "/join/$code"),
  });
  if (codeChildMatched) {
    return <Outlet />;
  }
  return <JoinFlow />;
}
