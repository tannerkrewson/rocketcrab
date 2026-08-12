import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { JoinScreen } from "../components/party/JoinScreen";
import { PartyExperience } from "../components/party/PartyExperience";
import { partyEngine } from "../lib/party/engine";
import { importInviteFromLocation } from "../lib/party/invite-import";

export const Route = createFileRoute("/join")({
  component: JoinPage,
});

/**
 * The join route (P2/P4): four-letter code entry, plus invite-link joining.
 * Invite secrets arrive in the URL fragment (ADR-0011); the fragment is
 * parsed and imported into session memory BEFORE the party route renders,
 * then stripped from the URL so the secret does not linger in history.
 */
function JoinPage() {
  const [joinError, setJoinError] = useState<string | null>(null);

  // Import the invite fragment (if any) once per page load.
  useEffect(() => {
    const invite = importInviteFromLocation({
      hash: window.location.hash,
      pathname: window.location.pathname,
      search: window.location.search,
    });
    if (invite !== null) {
      void partyEngine.joinByInvite(invite);
    }
  }, []);

  const state = partyEngine.getState();

  const handleJoin = (code: string) => {
    setJoinError(null);
    void partyEngine.joinByCode(code).then(() => {
      const latest = partyEngine.getState();
      if (latest.phase === "error" && latest.lastError !== null) {
        setJoinError(latest.lastError);
      }
    });
  };

  if (state.phase === "idle" || state.phase === "error") {
    // Idle: show the code form (with any join error inline). Error: the
    // join failed (rejected, not found, timeout) — show the form again so
    // the player can try another code or an invite link.
    return (
      <JoinScreen
        error={joinError ?? (state.phase === "error" ? state.lastError : null)}
        joining={false}
        onSubmit={handleJoin}
      />
    );
  }
  return <PartyExperience />;
}
