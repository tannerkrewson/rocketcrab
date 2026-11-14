import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PeerLinkAlert } from "./PeerLinkAlert";
import { PartyDiagnosticsPanel } from "./PartyDiagnostics";
import type { PartyDiagnostics } from "../../lib/party/engine";

it("shows a generic, non-alarming connecting alert with no player name", () => {
  render(<PeerLinkAlert status="connecting" onRetry={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("Connecting to a player…");
  expect(screen.queryByRole("button")).toBeNull();
});

it("shows a failure alert whose retry button runs the reconnect action", () => {
  const onRetry = vi.fn();
  render(<PeerLinkAlert status="failed" onRetry={onRetry} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn't connect to a player.");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it("marks only tunnelled admitted peers as relayed in diagnostics", () => {
  const diagnostics: PartyDiagnostics = {
    connectionState: "connected",
    selfConnectionId: "self",
    room: "room",
    sessionId: null,
    signalingConnected: true,
    joinErrors: null,
    peers: [
      { memberId: "m-native", connectionId: "c-native", displayName: "Native", tunnelled: false },
      { memberId: "m-relay", connectionId: "c-relay", displayName: "Relay", tunnelled: true },
    ],
    lastQuality: [],
    turn: null,
  };
  render(<PartyDiagnosticsPanel diagnostics={diagnostics} onRefresh={vi.fn()} />);
  expect(screen.getByText("Native")).toBeInTheDocument();
  expect(screen.getByText("Relay")).toBeInTheDocument();
  // Exactly one "relayed" badge: on the tunnelled peer only.
  expect(screen.getAllByText("relayed")).toHaveLength(1);
});
