import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { parseInviteFragment } from "@rocketcrab/party";
import { JoinScreen } from "../components/party/JoinScreen";
import { PartyExperience } from "../components/party/PartyExperience";
import { partyEngine } from "../lib/party/engine";

export const Route = createFileRoute("/join")({
  component: JoinPage,
});

/** Module-level guard so StrictMode's double effect run never joins twice. */
let inviteHandled = false;

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
    if (inviteHandled) {
      return;
    }
    inviteHandled = true;
    const data = parseInviteFragment(window.location.hash);
    if (data !== null && data.secret !== undefined) {
      // The secret lives in engine/PartySession memory from here on; remove
      // the fragment from the address bar and history.
      history.replaceState(null, "", window.location.pathname + window.location.search);
      void partyEngine.joinByInvite({
        secret: data.secret,
        ...(data.code !== undefined ? { code: data.code } : {}),
      });
    } else if (window.location.hash.length > 0) {
      // A fragment with no valid invite data: drop it (ADR-0011 hygiene).
      history.replaceState(null, "", window.location.pathname + window.location.search);
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
