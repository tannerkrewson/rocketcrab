import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, buttonStyles } from "./Button";

describe("Button", () => {
  it("renders with default variant and fires onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Launch</Button>);

    const button = screen.getByRole("button", { name: "Launch" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass("btn", "btn-primary", "btn-md");

    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies variant and size classes", () => {
    render(
      <Button variant="secondary" size="lg">
        Big
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Big" })).toHaveClass("btn-secondary", "btn-lg");
  });

  it("applies the neutral variant (soft-default stack, 2t1.8)", () => {
    render(<Button variant="neutral">Neutral</Button>);
    expect(screen.getByRole("button", { name: "Neutral" })).toHaveClass("btn-neutral");
  });

  it("applies the soft style when soft is set (2t1.8)", () => {
    render(<Button soft>Soft</Button>);
    expect(screen.getByRole("button", { name: "Soft" })).toHaveClass("btn-soft");
    expect(screen.getByRole("button", { name: "Soft" })).toHaveClass("btn-primary");
  });

  it("keeps the solid look when soft is unset (backward compatible)", () => {
    render(<Button variant="neutral">Solid</Button>);
    expect(screen.getByRole("button", { name: "Solid" })).not.toHaveClass("btn-soft");
  });

  it("merges a custom className", () => {
    render(<Button className="w-full">Wide</Button>);
    expect(screen.getByRole("button", { name: "Wide" })).toHaveClass("w-full");
  });

  it("buttonStyles returns mergeable class string for links", () => {
    expect(buttonStyles("primary", "lg", "px-8")).toContain("btn-primary");
    expect(buttonStyles("primary", "lg", "px-8")).toContain("btn-lg");
    expect(buttonStyles("primary", "lg", "px-8")).toContain("px-8");
  });

  it("buttonStyles appends btn-soft for the soft flag (2t1.8)", () => {
    expect(buttonStyles("neutral", "lg", undefined, true)).toContain("btn-neutral");
    expect(buttonStyles("neutral", "lg", undefined, true)).toContain("btn-soft");
    expect(buttonStyles("primary", "lg", "px-8", true)).toContain("btn-primary");
    expect(buttonStyles("primary", "lg", "px-8", true)).toContain("btn-soft");
    expect(buttonStyles("primary", "lg", "px-8", true)).toContain("px-8");
    expect(buttonStyles("primary", "lg", "px-8")).not.toContain("btn-soft");
  });
});
