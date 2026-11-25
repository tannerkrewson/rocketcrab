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
        rocketcrab uses Google Analytics to count visits, games played, party sizes, and whether
        connections work.
      </p>
      <p>
        In the US and most of Canada, Microsoft Clarity records clicks and scrolling on the main
        pages and party screens so we can find and fix problems. It hides all text and anything you
        type, so names and invite links are never recorded, and it can't see inside games. It's off
        if your browser sends Global Privacy Control. Clarity uses cookies, and Microsoft may also
        use its data for its own services, including advertising.{" "}
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
