import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { getSavedPlayerName } from "../../lib/party/identity";
import { importInviteFromLocation } from "../../lib/party/invite-import";
import { usePartyEngine } from "../../lib/party/use-party";
import { Button, buttonStyles } from "../ui/Button";
import { PartyExperience } from "./PartyExperience";
import { PartyResumeBanner } from "./PartyResumeBanner";
import { PartyShellHeader } from "./PartyShellHeader";

/** Invites auto-join with the saved/generated identity; name editing is optional. */
export function JoinFlow() {
  const search = useSearch({ strict: false }) as { edit?: "name" };
  const navigate = useNavigate();
  const { state, engine } = usePartyEngine();
  const [name, setName] = useState(() => getSavedPlayerName() ?? "");
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    const invite = importInviteFromLocation(window.location);
    if (invite !== null && !engine.isActive()) void engine.joinByInvite(invite);
  }, [engine]);
  if (search.edit === "name")
    return (
      <section className="mx-auto flex w-full max-w-md flex-col gap-4">
        <PartyShellHeader />
        <h1 className="text-2xl font-bold">Your name</h1>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            engine.setDisplayName(name.trim());
            void navigate({ to: "/join", search: { edit: undefined } });
          }}
        >
          <label htmlFor="player-name" className="text-sm font-bold">
            Your player name
          </label>
          <input
            id="player-name"
            className="input input--primary w-full"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={24}
            autoComplete="nickname"
          />
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Save
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void navigate({ to: "/join", search: { edit: undefined } })}
          >
            Back
          </Button>
        </form>
      </section>
    );
  if (state.phase === "idle")
    return (
      <section className="mx-auto flex w-full max-w-md flex-col gap-4">
        <PartyShellHeader />
        <PartyResumeBanner engine={engine} />
        <h1 className="text-2xl font-bold">Join a private party</h1>
        <p>
          Open a friend's invite link or scan their QR code with your phone's camera. You'll join
          automatically.
        </p>
        <Link to="/party" className={buttonStyles("primary")}>
          Start a party
        </Link>
      </section>
    );
  return <PartyExperience onLeft={() => void navigate({ to: "/" })} />;
}
