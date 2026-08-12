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

/**
 * One-tap rejoin after a page reload (M1; ADR-0012).
 *
 * Mobile Safari can discard and reload a backgrounded tab; the party
 * itself survives (greeter/authority roles migrate while the phone is
 * away), so when this page loads with a saved recovery record the shell
 * offers to rejoin the party exactly as it was — same four-letter code,
 * same invite secret, same player identity. Rejoining goes through the
 * normal invite path (ADR-0011); the P3 coordinator then re-fetches the
 * verified game source from the party. Dismissing clears the record.
 */
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
        ...(record.code !== null ? { code: record.code } : {}),
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
        {record.code !== null ? (
          <>
            {" "}
            (code <span className="font-mono font-bold">{record.code}</span>)
          </>
        ) : null}
        . The party is still open — rejoin where you left off.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="md" onClick={handleRejoin} disabled={rejoining}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {rejoining ? "Rejoining…" : "Rejoin party"}
        </Button>
        <Button variant="ghost" size="md" onClick={handleDismiss}>
          <X className="h-4 w-4" aria-hidden="true" />
          Not now
        </Button>
      </div>
    </section>
  );
}
