import { PartyPopper, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import type { PartyEngine } from "../../lib/party/engine";
import {
  clearPartyRecovery,
  readPartyRecovery,
  type PartyRecoveryRecord,
} from "../../lib/party/party-recovery";
import { Button } from "../ui/Button";

export interface PartyResumeBannerProps {
  engine: PartyEngine;
}

export function PartyResumeBanner({ engine }: PartyResumeBannerProps) {
  const [record, setRecord] = useState<PartyRecoveryRecord | null>(() => readPartyRecovery());
  const [rejoining, setRejoining] = useState(false);

  if (record === null) {
    return null;
  }

  const handleRejoin = () => {
    if (rejoining) {
      return;
    }
    setRejoining(true);
    void engine
      .joinByInvite({
        secret: record.secret,
      })
      .then(() => {
        // Success unmounts the banner (the party experience takes over);
        // on failure (the engine's error phase) re-enable the button so
        // the player can retry or dismiss.
        setRejoining(false);
      });
  };

  const handleDismiss = () => {
    clearPartyRecovery();
    setRecord(null);
  };

  return (
    <section
      className="flex flex-col gap-3 rounded-box border-2 border-primary/40 bg-base-100 p-4"
      aria-label="Return to your party"
      data-testid="party-resume-banner"
    >
      <div className="flex flex-wrap items-center gap-2">
        <PartyPopper className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="text-lg font-black">Return to your party</h2>
      </div>
      <p className="text-sm text-base-content/70">
        This page reloaded while you were in a party
        {record.game !== null ? (
          <>
            {" "}
            playing <span className="font-bold">“{record.game.title}”</span>
          </>
        ) : null}
        . Rejoin if a friend is still connected.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="md" onClick={handleRejoin} disabled={rejoining}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {rejoining ? "Rejoining…" : "Rejoin party"}
        </Button>
        <Button variant="default" soft size="md" onClick={handleDismiss}>
          <X className="h-4 w-4" aria-hidden="true" />
          Not now
        </Button>
      </div>
    </section>
  );
}
