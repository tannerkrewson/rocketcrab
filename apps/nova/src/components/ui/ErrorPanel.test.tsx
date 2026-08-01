import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorPanel } from "./ErrorPanel";

describe("ErrorPanel", () => {
  it("renders an alert with title and message", () => {
    render(<ErrorPanel title="Boom" message="The runtime crashed." />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Boom")).toBeInTheDocument();
    expect(screen.getByText("The runtime crashed.")).toBeInTheDocument();
  });

  it("calls onRetry when Try again is clicked", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorPanel onRetry={onRetry} />);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("omits the retry button when no handler is provided", () => {
    render(<ErrorPanel />);
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});
