import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PartyShellHeader } from "./PartyShellHeader";
it("shows a safe title, never invite credentials", () => {
  const { container } = render(
    <PartyShellHeader inviteUrl={"https://example.com/join#secret=" + "A".repeat(43)} />,
  );
  expect(screen.getByText("Nova party")).toBeInTheDocument();
  expect(container.innerHTML).not.toContain("secret=");
});
