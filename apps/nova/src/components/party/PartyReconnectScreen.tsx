import { Loader2, RefreshCw, WifiOff } from "lucide-react";
import type { PartyEngineState } from "../../lib/party/engine";
import { Button } from "../ui/Button";

export interface PartyReconnectScreenProps {
  state: PartyEngineState;
  onReconnect: () => void;
  onLeave: () => void;
}

/** Reconnect progress and recovery controls, including an exit outside the game frame. */
export function PartyReconnectScreen({ state, onReconnect, onLeave }: PartyReconnectScreenProps) {
  const reconnecting = state.phaseDetail?.includes("Reconnecting") ?? false;
  const attempts = state.reconnectAttempts;
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-10 text-center">
      <WifiOff className="h-12 w-12 text-warning" aria-hidden="true" />
      <h1 className="text-2xl font-black">Connection lost</h1>
      <p className="text-foreground/70">{state.phaseDetail}</p>
      {attempts > 0 ? (
        <p className="text-sm font-semibold text-foreground/60" aria-live="polite">
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
        <Button variant="danger" soft size="md" className="w-full" onClick={onLeave}>
          Leave party
        </Button>
      </div>
      <p className="text-xs text-foreground/50">
        {state.connectionState === "suspended"
          ? "Your connection was suspended (phone backgrounding or a network switch). Rejoining with a fresh connection."
          : "Backgrounding a phone can drop the connection; the party stays open while you reconnect."}
      </p>
    </div>
  );
}
