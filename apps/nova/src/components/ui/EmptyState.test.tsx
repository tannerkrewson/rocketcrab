import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders title and description", () => {
    render(<EmptyState title="No games yet" description="Create one first." />);
    expect(screen.getByText("No games yet")).toBeInTheDocument();
    expect(screen.getByText("Create one first.")).toBeInTheDocument();
  });

  it("renders an action node", () => {
    render(<EmptyState title="Empty" action={<button type="button">Go</button>} />);
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("renders the icon inside an aria-hidden wrapper", () => {
    render(<EmptyState title="Empty" icon={<span data-testid="icon" />} />);
    const wrapper = screen.getByTestId("icon").parentElement;
    expect(wrapper).toHaveAttribute("aria-hidden", "true");
  });
});
