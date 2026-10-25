import { Alert } from "@heroui/react";
import { Activity, RefreshCw, Wifi } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { useState } from "react";
import type { PartyDiagnostics } from "../../lib/party/engine";

export interface PartyDiagnosticsPanelProps {
  diagnostics: PartyDiagnostics | null;
  onRefresh: () => void;
  /** Party shell host display name (kept accessible here, 10.7). */
  hostNameForDiagnostics?: string | null;
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
 * the P1 adapter exposes. Purely informational. The shell-host/authority
 * summary (10.7) lives here too: those roles are diagnostic, so the lobby
 * itself does not show them.
 */
export function PartyDiagnosticsPanel({
  diagnostics,
  onRefresh,
  hostNameForDiagnostics,
  authorityName,
}: PartyDiagnosticsPanelProps) {
  const [open, setOpen] = useState(false);
  if (diagnostics === null) {
    return null;
  }
  const relayCount = diagnostics.relays?.length ?? 0;
  const connectedRelays = diagnostics.relays?.filter((relay) => relay.connected).length ?? 0;
  const usableRelays =
    diagnostics.relays?.filter((relay) => relay.connected && !relay.degraded).length ?? 0;
  const relayHealth = diagnostics.relayHealth;

  return (
    <details
      className="group rounded-2xl border-2 border-border bg-surface"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-bold">
        <Activity className="h-4 w-4" aria-hidden="true" />
        Connection diagnostics
        <Badge>{connectionLabel(diagnostics.connectionState)}</Badge>
        <Badge
          title={
            relayCount === 0
              ? "No relay sockets observed yet"
              : `${usableRelays}/${relayCount} relays usable (open and accepting party traffic); ${connectedRelays} open sockets`
          }
        >
          {relayCount === 0 ? "0 relays" : `${usableRelays}/${relayCount} relays`}
        </Badge>
        {relayHealth !== null && relayHealth.degraded ? (
          <Badge color="warning" title="Usable relays below redundancy">
            degraded
          </Badge>
        ) : null}
      </summary>
      <div className="flex flex-col gap-2 p-4 pt-0 text-xs">
        {relayHealth !== null && relayHealth.degraded ? (
          <Alert status="warning" role="alert" className="mx-auto w-fit text-xs">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>
                Signaling degraded: {relayHealth.usable} of {relayHealth.total} relays usable —
                connected relays are rejecting or throttling party messages.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        {relayHealth !== null && relayHealth.signalingDown ? (
          <Alert status="danger" role="alert" className="mx-auto w-fit text-xs">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>No relay socket is open — signaling is down.</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        {hostNameForDiagnostics !== undefined || authorityName !== undefined ? (
          <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-foreground/70">
            <span>party host: {hostNameForDiagnostics ?? "—"}</span>
            <span>authority: {authorityName ?? "—"}</span>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-foreground/70">
          <span>connection: {diagnostics.connectionState}</span>
          <span>connectionId: {diagnostics.selfConnectionId}</span>
          <span>room: {diagnostics.room}</span>
          <span>session: {diagnostics.sessionId ?? "—"}</span>
          <span title="TURN credential state (P0)">turn: {diagnostics.turn ?? "—"}</span>
        </div>
        {diagnostics.relays !== null ? (
          <div className="flex flex-col gap-1">
            <span className="font-bold text-foreground/70">Relay sockets</span>
            <ul className="flex flex-col gap-1">
              {diagnostics.relays.length === 0 ? (
                <li className="text-foreground/50">No relay sockets observed yet.</li>
              ) : (
                diagnostics.relays.map((relay) => (
                  <li key={relay.url} className="flex items-center gap-2">
                    {relay.connected && !relay.degraded ? (
                      <span title="Open and accepting party traffic">
                        <Wifi className="h-3 w-3 text-success" aria-hidden="true" />
                      </span>
                    ) : relay.connected && relay.degraded ? (
                      <span title="Open but rejecting/throttling party traffic">
                        <Wifi className="h-3 w-3 text-warning" aria-hidden="true" />
                      </span>
                    ) : (
                      <Wifi className="h-3 w-3 text-danger" aria-hidden="true" />
                    )}
                    <span className="break-all">{relay.url}</span>
                    <span
                      className={`ml-auto whitespace-nowrap ${
                        relay.connected && relay.degraded
                          ? "font-bold text-warning"
                          : "text-foreground/50"
                      }`}
                    >
                      {relay.connected && !relay.degraded
                        ? "usable"
                        : relay.connected && relay.degraded
                          ? "rejecting"
                          : `readyState ${relay.readyState}`}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : null}
        {diagnostics.joinErrors !== null && diagnostics.joinErrors.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="font-bold text-foreground/70">Join errors</span>
            <ul className="flex flex-col gap-1 text-danger">
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
            <span className="font-bold text-foreground/70">Peer latency (last sample)</span>
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
          <Button
            size="sm"
            variant="default"
            soft
            onClick={onRefresh}
            title="Re-sample connection quality and relay state"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>
    </details>
  );
}
