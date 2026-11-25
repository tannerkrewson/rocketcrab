import { useEffect, useState } from "react";
import {
  clarityEnabled,
  clarityPublicDocument,
  getClarityPreference,
  setClarityPreference,
} from "../../lib/clarity";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

export function SessionReplaySettings() {
  const [choice, setChoice] = useState(getClarityPreference);
  const [open, setOpen] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    if (!clarityEnabled) return;
    const syncChoice = () => setChoice(getClarityPreference());
    window.addEventListener("storage", syncChoice);
    window.addEventListener("pageshow", syncChoice);
    return () => {
      window.removeEventListener("storage", syncChoice);
      window.removeEventListener("pageshow", syncChoice);
    };
  }, []);
  if (!clarityEnabled) return null;

  function choose(allowed: boolean) {
    const saved = setClarityPreference(allowed);
    setSaveFailed(allowed && !saved);
    if (!saved && allowed) return;
    setChoice(allowed);
    setOpen(false);
  }

  const actions = (
    <div className="flex flex-wrap justify-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => choose(false)}>
        Keep replay off
      </Button>
      <Button variant="primary" size="sm" onClick={() => choose(true)}>
        Allow replay
      </Button>
    </div>
  );
  const description = (
    <p>
      Help improve Rocketcrab by sharing clicks, scrolling, and session replays of public pages with
      Microsoft Clarity. Replay uses analytics cookies on the home, about, and Nova introduction
      pages. Microsoft may use the data for its own services, including advertising.{" "}
      <a
        href="https://privacy.microsoft.com/en-us/privacystatement"
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-4"
      >
        Microsoft Privacy Statement
      </a>
    </p>
  );
  const error = saveFailed ? (
    <p role="status">Your browser couldn’t save this choice. Replay is off.</p>
  ) : null;

  return clarityPublicDocument && choice === null ? (
    <section aria-label="Session replay" className="flex max-w-md flex-col gap-2 pb-2">
      {description}
      {actions}
      {error}
    </section>
  ) : (
    <>
      <Button variant="tertiary" size="sm" onClick={() => setOpen(true)}>
        Session replay settings
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Session replay settings">
        <div className="flex flex-col gap-3 pb-3">
          {description}
          <p>Replay is {choice === true ? "allowed" : "off"}.</p>
          {actions}
          {error}
        </div>
      </Dialog>
    </>
  );
}
