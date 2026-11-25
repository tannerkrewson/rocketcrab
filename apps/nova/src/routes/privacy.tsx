import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button, buttonStyles } from "../components/ui/Button";
import { replayOptedOut, setReplayOptOut } from "../lib/clarity";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  const [optedOut, setOptedOut] = useState(replayOptedOut);
  const [saveFailed, setSaveFailed] = useState(false);
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4">
      <Link to="/" className={buttonStyles("secondary")}>
        Back to home
      </Link>
      <h1 className="text-3xl font-black">Privacy</h1>
      <p>
        Rocketcrab uses Google Analytics to count page visits, games played, party sizes, and
        connection outcomes.
      </p>
      <p>
        Microsoft Clarity uses cookies in supported regions to record clicks, scrolling, and page
        changes on the home, About, and Nova introduction pages. Microsoft may use the data for its
        own services, including Microsoft Advertising.{" "}
        <a
          href="https://privacy.microsoft.com/en-us/privacystatement"
          className="underline underline-offset-4"
        >
          Microsoft Privacy Statement
        </a>
      </p>
      <Button
        variant="secondary"
        onClick={() => {
          const saved = setReplayOptOut(!optedOut);
          setSaveFailed(!saved);
          if (saved) setOptedOut(!optedOut);
        }}
      >
        {optedOut ? "Restore default replay settings" : "Turn off session replay"}
      </Button>
      {saveFailed ? <p role="status">Your browser couldn’t save your replay preference.</p> : null}
    </div>
  );
}
