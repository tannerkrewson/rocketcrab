import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { getSavedPlayerName } from "../../lib/party/identity";
import { importInviteFromLocation, type ImportedInvite } from "../../lib/party/invite-import";
import { usePartyEngine } from "../../lib/party/use-party";
import { Button, buttonStyles } from "../ui/Button";
import { PartyExperience } from "./PartyExperience";
import { PartyResumeBanner } from "./PartyResumeBanner";
import { NameEntry } from "./NameEntry";
import { PartyShellHeader } from "./PartyShellHeader";

/**
 * Invites join automatically once the player has a name; without one, the
 * name step comes first. `?edit=name` reuses the same screen to rename.
 */
export function JoinFlow() {
  const search = useSearch({ strict: false }) as { edit?: "name" };
  const navigate = useNavigate();
  const { state, engine } = usePartyEngine();
  const [hasName, setHasName] = useState(() => getSavedPlayerName() !== null);
  // The invite fragment is imported (and stripped from the URL) once per page
  // load; hold it here until the player has a name. Until the import effect
  // runs, a fragment in the URL means an invite is probably on its way.
  const [invite, setInvite] = useState<ImportedInvite | null>(null);
  const [importing, setImporting] = useState(() => window.location.hash.length > 0);
  useEffect(() => {
    // StrictMode re-runs this; the importer returns null the second time, so
    // only ever store a real invite.
    const imported = importInviteFromLocation(window.location);
    if (imported !== null) setInvite(imported);
    setImporting(false);
  }, []);
  const joined = useRef(false);
  useEffect(() => {
    if (joined.current || invite === null || !hasName || engine.isActive()) return;
    joined.current = true;
    void engine.joinByInvite(invite);
  }, [engine, hasName, invite]);

  if (search.edit === "name")
    return (
      <NameEntry
        initialName={getSavedPlayerName() ?? ""}
        title="Your name"
        submitLabel="Save"
        onSubmit={(name) => {
          engine.setDisplayName(name);
          void navigate({ to: "/join", search: { edit: undefined } });
        }}
        secondary={
          <Button
            type="button"
            variant="tertiary"
            onClick={() => void navigate({ to: "/join", search: { edit: undefined } })}
          >
            Back
          </Button>
        }
      />
    );
  if (importing) return null;
  if (invite !== null && !hasName && !engine.isActive())
    return (
      <NameEntry
        description="Your friends will see this in the party."
        submitLabel="Join party"
        onSubmit={(name) => {
          engine.setDisplayName(name);
          setHasName(true);
        }}
      />
    );
  if (state.phase === "idle")
    return (
      <section className="mx-auto flex w-full max-w-md flex-col items-center gap-4 text-center">
        <PartyShellHeader />
        <PartyResumeBanner engine={engine} />
        <h1 className="text-2xl font-black">Join a party</h1>
        <p className="text-foreground/70">
          Open a friend&apos;s invite link, or scan their QR code with your phone&apos;s camera.
          You&apos;ll join automatically.
        </p>
        <Link to="/party" className={buttonStyles("primary")}>
          Start your own party
        </Link>
      </section>
    );
  return <PartyExperience onLeft={() => void navigate({ to: "/" })} />;
}
