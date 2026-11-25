import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PartyInviteQr } from "./PartyInviteQr";

const INVITE_URL = "https://nova.example/join#code=ABCD&secret=AAAA";

describe("PartyInviteQr", () => {
  it("draws the QR code on a canvas that fills its container", () => {
    const { container } = render(<PartyInviteQr inviteUrl={INVITE_URL} />);
    const qr = screen.getByRole("img", { name: "Party invite QR code" });
    expect(qr.tagName).toBe("CANVAS");
    expect(qr).toHaveStyle({ width: "100%" });
    // Session replay records DOM text and attributes, so the secret must be in neither.
    expect(container.innerHTML).not.toMatch(/secret|AAAA/);
  });
});
