import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PartyInviteQr } from "./PartyInviteQr";

const INVITE_URL = "https://nova.example/join#code=ABCD&secret=AAAA";

describe("PartyInviteQr", () => {
  it("draws the QR code on a canvas with the safe label instead of the URL", () => {
    const { container } = render(
      <PartyInviteQr inviteUrl={INVITE_URL} label="nova.example/abcd" />,
    );
    expect(screen.getByRole("img", { name: "Party invite QR code" }).tagName).toBe("CANVAS");
    expect(screen.getByText("nova.example/abcd")).toBeInTheDocument();
    // Session replay records DOM text and attributes, so the secret must be in neither.
    expect(container.innerHTML).not.toMatch(/secret|AAAA/);
  });
});
