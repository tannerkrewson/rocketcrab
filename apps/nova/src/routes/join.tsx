import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { JoinScreen } from "../components/party/JoinScreen";
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
 *
 * 2t1.9: the join is a SINGLE step — the code is submitted straight to the
 * engine with the player's existing (saved or generated) name; the player
 * is only asked for a name once they are in the lobby, via the same
 * name-editing page the lobby's pencil opens (`/join?edit=name`). The
 * code/name state lives HERE (not in JoinScreen) so it survives the
 * joining → error transition: "Try again" keeps the typed code (7.10).
 */
function JoinPage() {
  // 2t1.9: `?edit=name` opens the name-editing page (the same name step as
  // the old two-step join), reached from the lobby's pencil and the
  // no-name prompt. Read loosely (no validateSearch) so existing
  // search-less /join links keep working.
  const search = Route.useSearch() as { edit?: "name" };
  const navigate = useNavigate();
  const [joinError, setJoinError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState(() => getSavedPlayerName() ?? "");

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

  // 2t1.9: joining is code-only — no name prompt up front. The player's
  // saved (or generated) name goes in as-is; the name is asked later, in
  // the lobby (see handleSaveName).
  const handleJoin = (submittedCode: string) => {
    setJoinError(null);
    if (submittedCode.length === 0) {
      return;
    }
    void partyEngine.joinByCode(submittedCode).then(() => {
      const latest = partyEngine.getState();
      if (latest.phase === "error" && latest.lastError !== null) {
        setJoinError(latest.lastError);
      } else {
        // Joined — next time the form shows (after leaving a party) it
        // starts again at the code step.
        setCode("");
      }
    });
  };

  // 2t1.9: save the edited name (identity is persisted, 7.5) and return to
  // the party — the engine is still active, so /join renders the lobby.
  const handleSaveName = (submittedName: string) => {
    if (submittedName.trim().length > 0) {
      partyEngine.setDisplayName(submittedName);
    }
    void navigate({ to: "/join", search: { edit: undefined } });
  };

  // 2t1.9: the name-editing page — the same name step as the old join
  // flow, opened from the lobby (pencil / no-name prompt). It renders
  // whether or not a party is active: saving returns to the lobby.
  if (search.edit === "name") {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <PartyShellHeader />
        <JoinScreen
          mode="edit"
          error={null}
          joining={false}
          code={code}
          onCodeChange={setCode}
          name={name}
          onNameChange={setName}
          onSubmit={(_code, submittedName) => handleSaveName(submittedName)}
          onBack={() => void navigate({ to: "/join", search: { edit: undefined } })}
        />
      </div>
    );
  }

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
          code={code}
          onCodeChange={setCode}
          name={name}
          onNameChange={setName}
          onSubmit={(submittedCode) => handleJoin(submittedCode)}
          onBack={() => void navigate({ to: "/join", search: { edit: undefined } })}
        />
      </div>
    );
  }
  // 2t1.9: leaving a joined party returns to the homepage (route "/").
  return <PartyExperience onLeft={() => void navigate({ to: "/" })} />;
}
