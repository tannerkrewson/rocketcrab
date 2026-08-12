import { Loader2, RefreshCw, WifiOff } from "lucide-react";
import type { PartyEngineState } from "../../lib/party/engine";
import { Button } from "../ui/Button";

export interface PartyReconnectScreenProps {
  state: PartyEngineState;
  onReconnect: () => void;
  onLeave: () => void;
}

/**
 * The reconnect screen (P4): the party connection dropped (Mobile Safari
 * backgrounding, relay loss, network switch — threat T15). The party is
 * still open; reconnect with a fresh connection ID, or leave.
 */
export function PartyReconnectScreen({ state, onReconnect, onLeave }: PartyReconnectScreenProps) {
  const reconnecting = state.phaseDetail?.includes("Reconnecting") ?? false;
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-10 text-center">
      <WifiOff className="h-12 w-12 text-warning" aria-hidden="true" />
      <h1 className="text-2xl font-black">Connection lost</h1>
      <p className="text-base-content/70">{state.phaseDetail}</p>
      <Button variant="primary" size="lg" onClick={onReconnect} disabled={reconnecting}>
        {reconnecting ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            Reconnecting…
          </>
        ) : (
          <>
            <RefreshCw className="h-5 w-5" aria-hidden="true" />
            Reconnect
          </>
        )}
      </Button>
      <Button variant="ghost" size="md" onClick={onLeave}>
        Leave party
      </Button>
    </div>
  );
}
