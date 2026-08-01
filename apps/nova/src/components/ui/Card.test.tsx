import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./Card";

describe("Card", () => {
  it("renders title, description, children, and actions", () => {
    render(
      <Card
        title="Stats"
        description="Your numbers"
        actions={<button type="button">Details</button>}
      >
        <p>42</p>
      </Card>,
    );
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("Your numbers")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
  });

  it("omits optional sections when absent", () => {
    const { container } = render(<Card>Only body</Card>);
    expect(screen.getByText("Only body")).toBeInTheDocument();
    expect(container.querySelector("h2")).not.toBeInTheDocument();
  });
});
