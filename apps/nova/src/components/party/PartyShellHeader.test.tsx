import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PartyShellHeader } from "./PartyShellHeader";
it("shows the rocketcrab.com brand row, never invite credentials", () => {
  const { container } = render(
    <PartyShellHeader inviteUrl={"https://example.com/join#secret=" + "A".repeat(43)} />,
  );
  expect(screen.getByTestId("browser-brand-row")).toHaveTextContent("rocketcrab.com");
  expect(container.innerHTML).not.toContain("secret=");
});
