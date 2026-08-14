import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { JoinScreen, type JoinStep } from "../components/party/JoinScreen";
import { PartyExperience } from "../components/party/PartyExperience";
import { PartyResumeBanner } from "../components/party/PartyResumeBanner";
import { PartyShellHeader } from "../components/party/PartyShellHeader";
import { partyEngine } from "../lib/party/engine";
import { getSavedPlayerName } from "../lib/party/identity";
import { importInviteFromLocation } from "../lib/party/invite-import";

export const Route = createFileRoute("/join")({
  component: JoinPage,
});

/**
 * The join route (P2/P4): four-letter code entry, plus invite-link joining.
 * Invite secrets arrive in the URL fragment (ADR-0011); the fragment is
 * parsed and imported into session memory BEFORE the party route renders,
 * then stripped from the URL so the secret does not linger in history.
 * The code/name/step state lives HERE (not in JoinScreen) so it survives
 * the joining → error transition: "Try again" keeps the typed code (7.10)
 * and the step (7.47).
 */
function JoinPage() {
  const [joinError, setJoinError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState(() => getSavedPlayerName() ?? "");
  // Two-step join flow (7.47): room code first, player name second.
  const [step, setStep] = useState<JoinStep>("code");

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

  const handleJoin = (submittedCode: string, submittedName: string) => {
    setJoinError(null);
    if (submittedCode.length === 0) {
      return;
    }
    // 7.5: the player's name is asked on the join screen and applied to the
    // engine identity before the join so it is announced to peers.
    if (submittedName.trim().length > 0) {
      partyEngine.setDisplayName(submittedName);
    }
    void partyEngine.joinByCode(submittedCode).then(() => {
      const latest = partyEngine.getState();
      if (latest.phase === "error" && latest.lastError !== null) {
        setJoinError(latest.lastError);
      } else {
        // Joined — next time the form shows (after leaving a party) it
        // starts again at the code step.
        setStep("code");
      }
    });
  };

  if (state.phase === "idle" || state.phase === "error") {
    // Idle: show the code form (with any join error inline). Error: the
    // join failed (rejected, not found, timeout) — show the form again so
    // the player can try another code or an invite link. A saved recovery
    // record (page reload while in a party, M1) offers a one-tap rejoin
    // above the form.
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        {/* Classic party shell (7.22): logo header above the join form. */}
        <PartyShellHeader />
        <PartyResumeBanner engine={partyEngine} />
        <JoinScreen
          error={joinError ?? (state.phase === "error" ? state.lastError : null)}
          joining={false}
          step={step}
          onStepChange={setStep}
          code={code}
          onCodeChange={setCode}
          name={name}
          onNameChange={setName}
          onSubmit={handleJoin}
        />
      </div>
    );
  }
  return <PartyExperience />;
}
