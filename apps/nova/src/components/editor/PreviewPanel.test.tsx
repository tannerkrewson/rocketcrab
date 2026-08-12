import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RefObject } from "react";
import { PreviewPanel } from "./PreviewPanel";

function makeRef(): RefObject<HTMLDivElement | null> {
  return { current: document.createElement("div") };
}

describe("PreviewPanel", () => {
  it("shows 'Not running' and no no-session note when idle", () => {
    render(<PreviewPanel containerRef={makeRef()} status="idle" onStop={vi.fn()} />);
    expect(screen.getByText("Not running")).toBeInTheDocument();
    expect(screen.queryByTestId("preview-no-session-note")).not.toBeInTheDocument();
  });

  it("shows 'Running' and the no-session note while running", () => {
    render(<PreviewPanel containerRef={makeRef()} status="running" onStop={vi.fn()} />);
    expect(screen.getByText("Running")).toBeInTheDocument();
    // rocketcrab-9fv.7.11: the preview has no party session, so games that
    // wait for a connection show "Connecting" here. The note makes that
    // legible and points the user at the arena/party flows.
    const note = screen.getByTestId("preview-no-session-note");
    expect(note).toHaveTextContent("Preview has no party session");
    expect(note).toHaveTextContent("Test multiplayer");
    expect(note).toHaveTextContent("Play with friends");
  });

  it("hides the no-session note when stopped", () => {
    render(<PreviewPanel containerRef={makeRef()} status="stopped" onStop={vi.fn()} />);
    expect(screen.queryByTestId("preview-no-session-note")).not.toBeInTheDocument();
  });

  it("renders the Stop control only while running or starting", () => {
    const { rerender } = render(
      <PreviewPanel containerRef={makeRef()} status="running" onStop={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    rerender(<PreviewPanel containerRef={makeRef()} status="idle" onStop={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });
});
