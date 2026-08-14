import { Activity, RefreshCw, Wifi } from "lucide-react";
import { useState } from "react";
import type { PartyDiagnostics } from "../../lib/party/engine";

export interface PartyDiagnosticsPanelProps {
  diagnostics: PartyDiagnostics | null;
  onRefresh: () => void;
  /** Rendezvous greeter display name (kept accessible here, 10.7). */
  greeterName?: string | null;
  /** Current internal authority display name (kept accessible here, 10.7). */
  authorityName?: string | null;
}

function connectionLabel(state: string): string {
  switch (state) {
    case "connected":
      return "Connected";
    case "joining":
      return "Connecting";
    case "suspended":
      return "Suspended";
    case "disconnected":
      return "Disconnected";
    case "idle":
      return "Idle";
    default:
      return state;
  }
}

/**
 * Connection diagnostics for the party (P4): relay sockets, join errors,
 * peer latency samples, and the transport's identity — the same telemetry
 * the P1 adapter exposes. Purely informational. The greeter/authority role
 * summary (10.7) lives here too: those roles are diagnostic until S3
 * formalizes authority, so the lobby itself no longer shows them.
 */
export function PartyDiagnosticsPanel({
  diagnostics,
  onRefresh,
  greeterName,
  authorityName,
}: PartyDiagnosticsPanelProps) {
  const [open, setOpen] = useState(false);
  if (diagnostics === null) {
    return null;
  }
  const relayCount = diagnostics.relays?.length ?? 0;
  const connectedRelays = diagnostics.relays?.filter((relay) => relay.connected).length ?? 0;

  return (
    <details
      className="collapse collapse-arrow border-2 border-base-300 bg-base-100"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="collapse-title flex items-center gap-2 text-sm font-bold">
        <Activity className="h-4 w-4" aria-hidden="true" />
        Connection diagnostics
        <span className="badge badge-ghost badge-sm">
          {connectionLabel(diagnostics.connectionState)}
        </span>
        <span className="badge badge-ghost badge-sm" title="Connected relays">
          {connectedRelays}/{relayCount} relays
        </span>
      </summary>
      <div className="collapse-content flex flex-col gap-2 text-xs">
        {greeterName !== undefined || authorityName !== undefined ? (
          <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-base-content/70">
            <span>greeter: {greeterName ?? "—"}</span>
            <span>authority: {authorityName ?? "—"}</span>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-base-content/70">
          <span>connection: {diagnostics.connectionState}</span>
          <span>connectionId: {diagnostics.selfConnectionId}</span>
          <span>room: {diagnostics.room}</span>
          <span>session: {diagnostics.sessionId ?? "—"}</span>
          <span title="TURN credential state (P0)">turn: {diagnostics.turn ?? "—"}</span>
        </div>
        {diagnostics.relays !== null ? (
          <div className="flex flex-col gap-1">
            <span className="font-bold text-base-content/70">Relay sockets</span>
            <ul className="flex flex-col gap-1">
              {diagnostics.relays.length === 0 ? (
                <li className="text-base-content/50">No relay sockets observed yet.</li>
              ) : (
                diagnostics.relays.map((relay) => (
                  <li key={relay.url} className="flex items-center gap-2">
                    <Wifi
                      className={relay.connected ? "h-3 w-3 text-success" : "h-3 w-3 text-error"}
                      aria-hidden="true"
                    />
                    <span className="break-all">{relay.url}</span>
                    <span className="ml-auto text-base-content/50">
                      {relay.connected ? "connected" : `readyState ${relay.readyState}`}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : null}
        {diagnostics.joinErrors !== null && diagnostics.joinErrors.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="font-bold text-base-content/70">Join errors</span>
            <ul className="flex flex-col gap-1 text-error">
              {diagnostics.joinErrors.map((error, index) => (
                <li key={`${error.category}-${index}`}>
                  {error.category}: {error.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {diagnostics.lastQuality.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="font-bold text-base-content/70">Peer latency (last sample)</span>
            <ul className="flex flex-col gap-1">
              {diagnostics.lastQuality.map((sample) => (
                <li key={`${sample.memberId}-${sample.sampledAt}`}>
                  {sample.memberId}: {sample.pingMs === null ? "no answer" : `${sample.pingMs} ms`}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-1">
          <button
            type="button"
            className="btn btn-outline btn-xs font-bold"
            onClick={onRefresh}
            title="Re-sample connection quality and relay state"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>
    </details>
  );
}
