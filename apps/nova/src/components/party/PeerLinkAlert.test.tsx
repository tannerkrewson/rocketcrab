import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PeerLinkAlert } from "./PeerLinkAlert";
import { PartyDiagnosticsPanel } from "./PartyDiagnostics";
import type { PartyDiagnostics } from "../../lib/party/engine";

it("shows a generic, non-alarming connecting alert with no player name", () => {
  render(<PeerLinkAlert status="connecting" phase="lobby" onRetry={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("Connecting to a player…");
  expect(screen.queryByRole("button")).toBeNull();
});

it("shows a failure alert whose retry button runs the reconnect action in the lobby", () => {
  const onRetry = vi.fn();
  render(<PeerLinkAlert status="failed" phase="lobby" onRetry={onRetry} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn't connect to a player.");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it("shows the same failure alert with no retry button while playing", () => {
  const onRetry = vi.fn();
  render(<PeerLinkAlert status="failed" phase="playing" onRetry={onRetry} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn't connect to a player.");
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(onRetry).not.toHaveBeenCalled();
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
  expect(screen.getAllByText("relayed")).toHaveLength(1);
});
