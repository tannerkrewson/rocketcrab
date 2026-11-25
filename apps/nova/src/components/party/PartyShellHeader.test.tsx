import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { PartyShellHeader } from "./PartyShellHeader";

vi.mock("../../lib/toast", () => ({ toast: { success: vi.fn(), danger: vi.fn() } }));

it("shows the rocketcrab.com brand row, never invite credentials", () => {
  const { container } = render(<PartyShellHeader />);
  expect(screen.getByTestId("browser-brand-row")).toHaveTextContent("rocketcrab.com");
  expect(container.innerHTML).not.toContain("secret=");
});

it("shows the party code as an address with its spelling, and copies it", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const { container } = render(<PartyShellHeader code="abcd" />);
  const address = screen.getByRole("button", { name: "Copy the party link" });
  expect(address).toHaveTextContent("rocketcrab.com/abcd");
  expect(screen.getByText("(alpha bravo charlie delta)")).toBeVisible();
  // Session replay records attributes as-is, so the code stays in text only.
  const attributes = [...container.querySelectorAll("*")].flatMap((element) =>
    [...element.attributes].map((attribute) => attribute.value),
  );
  expect(attributes.filter((value) => value.includes("abcd"))).toEqual([]);
  await userEvent.click(address);
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/abcd`);
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
});
