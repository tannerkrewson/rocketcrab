import { Loader2, RefreshCw, WifiOff } from "lucide-react";
import type { PartyEngineState } from "../../lib/party/engine";
import { Button } from "../ui/Button";

export interface PartyReconnectScreenProps {
  state: PartyEngineState;
  onReconnect: () => void;
  onLeave: () => void;
}

/**
 * The reconnect screen (P4, M1): the party connection dropped (Mobile
 * Safari backgrounding, relay loss, network switch — threat T15). The
 * party is still open; reconnect with a fresh connection ID, or leave.
 * Shows reconnect progress (attempt count) and auto-retry status so a
 * phone user always knows the shell is working on it (issue requirement:
 * display reconnect progress). The Leave button is the emergency exit and
 * lives outside any game frame.
 */
export function PartyReconnectScreen({ state, onReconnect, onLeave }: PartyReconnectScreenProps) {
  const reconnecting = state.phaseDetail?.includes("Reconnecting") ?? false;
  const attempts = state.reconnectAttempts;
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-10 text-center">
      <WifiOff className="h-12 w-12 text-warning" aria-hidden="true" />
      <h1 className="text-2xl font-black">Connection lost</h1>
      <p className="text-base-content/70">{state.phaseDetail}</p>
      {attempts > 0 ? (
        <p className="text-sm font-semibold text-base-content/60" aria-live="polite">
          {attempts === 1 ? "First reconnect attempt…" : `Reconnect attempt ${attempts}`}
          {" · "}
          <span className="text-warning">retrying automatically</span>
        </p>
      ) : null}
      <div className="flex w-full max-w-xs flex-col items-center gap-2">
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={onReconnect}
          disabled={reconnecting}
        >
          {reconnecting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              Reconnecting…
            </>
          ) : (
            <>
              <RefreshCw className="h-5 w-5" aria-hidden="true" />
              Reconnect now
            </>
          )}
        </Button>
        <Button variant="outline" size="md" className="w-full" onClick={onLeave}>
          Leave party
        </Button>
      </div>
      <p className="text-xs text-base-content/50">
        {state.connectionState === "suspended"
          ? "Your connection was suspended (phone backgrounding or a network switch). Rejoining with a fresh connection."
          : "Backgrounding a phone can drop the connection; the party stays open while you reconnect."}
      </p>
    </div>
  );
}
