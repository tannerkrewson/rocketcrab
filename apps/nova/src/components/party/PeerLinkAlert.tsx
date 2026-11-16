import { Alert } from "@heroui/react";
import type { PartyPhase, PeerLinkStatus } from "../../lib/party/engine";
import { Button } from "../ui/Button";

/**
 * Never name a peer: tunnel hooks do not identify pairs and names are
 * unknown before admission. Reconnect is offered only outside play because
 * it tears down the game; active games rely on transport re-announcement.
 */
export function PeerLinkAlert({
  status,
  phase,
  onRetry,
}: {
  status: Exclude<PeerLinkStatus, null>;
  phase: PartyPhase;
  onRetry: () => void;
}) {
  if (status === "connecting") {
    return (
      <Alert status="accent" role="status" className="mx-auto w-fit">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Description className="text-sm font-semibold">
            Connecting to a player…
          </Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }
  return (
    <Alert status="warning" role="alert" className="mx-auto w-fit">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description className="text-sm font-semibold">
          Couldn&apos;t connect to a player.
        </Alert.Description>
        {phase === "playing" ? null : (
          <div className="mt-2">
            <Button size="sm" variant="primary" onClick={onRetry}>
              Retry
            </Button>
          </div>
        )}
      </Alert.Content>
    </Alert>
  );
}
