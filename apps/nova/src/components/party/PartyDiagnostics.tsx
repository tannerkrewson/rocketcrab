import { Alert } from "@heroui/react";
import { Activity, RefreshCw } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { useState } from "react";
import type { PartyDiagnostics } from "../../lib/party/engine";

export interface PartyDiagnosticsPanelProps {
  diagnostics: PartyDiagnostics | null;
  onRefresh: () => void;
  /** Shell host display name; kept in diagnostics rather than the lobby. */
  hostNameForDiagnostics?: string | null;
  /** Internal authority display name; kept in diagnostics rather than the lobby. */
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

/** Informational transport diagnostics, including internal host and authority roles. */
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

  return (
    <details
      className="glass group rounded-2xl"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-bold">
        <Activity className="h-4 w-4" aria-hidden="true" />
        Connection diagnostics
        <Badge>{connectionLabel(diagnostics.connectionState)}</Badge>
        <Badge>
          Signaling:{" "}
          {diagnostics.signalingConnected === null
            ? "unknown"
            : diagnostics.signalingConnected
              ? "connected"
              : "disconnected"}
        </Badge>
      </summary>
      <div className="flex flex-col gap-2 p-4 pt-0 text-xs">
        {diagnostics.signalingConnected === false ? (
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
        {diagnostics.peers.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="font-bold text-foreground/70">Peers</span>
            <ul className="flex flex-col gap-1">
              {diagnostics.peers.map((peer) => (
                <li key={peer.connectionId} className="flex flex-wrap items-center gap-2">
                  <span>{peer.displayName ?? peer.memberId}</span>
                  {peer.tunnelled ? (
                    <Badge title="This player's connection is relayed through Rocketcrab's servers, not direct.">
                      relayed
                    </Badge>
                  ) : null}
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
