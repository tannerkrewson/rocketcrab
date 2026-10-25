import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, buttonStyles } from "./Button";

describe("Button (HeroUI)", () => {
  it("renders and fires onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Launch</Button>);
    const button = screen.getByRole("button", { name: "Launch" });
    expect(button).toHaveClass("button", "button--primary", "button--md");
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("maps intent and size to HeroUI variants", () => {
    render(
      <Button variant="secondary" size="lg">
        Big
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Big" })).toHaveClass(
      "button--secondary",
      "button--lg",
    );
  });

  it("maps default to the neutral secondary variant", () => {
    render(<Button variant="default">Default</Button>);
    expect(screen.getByRole("button", { name: "Default" })).toHaveClass("button--secondary");
  });

  it("maps soft intents to tinted HeroUI variants", () => {
    render(<Button soft>Soft</Button>);
    expect(screen.getByRole("button", { name: "Soft" })).toHaveClass("button--secondary");
    render(
      <Button variant="danger" soft>
        Remove
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Remove" })).toHaveClass("button--danger-soft");
  });

  it("accepts disabled as an alias for isDisabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Disabled
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Disabled" });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("merges a custom className", () => {
    render(<Button className="w-full">Wide</Button>);
    expect(screen.getByRole("button", { name: "Wide" })).toHaveClass("w-full");
  });

  it("buttonStyles returns the same classes for router links", () => {
    expect(buttonStyles("primary", "lg", "px-8")).toContain("button--primary");
    expect(buttonStyles("primary", "lg", "px-8")).toContain("button--lg");
    expect(buttonStyles("primary", "lg", "px-8")).toContain("px-8");
    expect(buttonStyles("danger", "sm", undefined, true)).toContain("button--danger-soft");
  });
});
