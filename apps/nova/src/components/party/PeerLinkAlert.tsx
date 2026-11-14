import { Alert } from "@heroui/react";
import type { PartyPhase, PeerLinkStatus } from "../../lib/party/engine";
import { Button } from "../ui/Button";

/**
 * Generic peer-link alert (PLAN.md §7 stages 2 and 4). It never names a
 * player: the tunnel hooks do not identify the peer, and a name is unknown
 * before admission. "connecting" is informational. "failed" offers a retry
 * (the engine's reconnect path) outside the game. During play there is no
 * button: Trystero re-attempts a failed pair on re-announce, and a reconnect
 * would tear down the running game.
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
