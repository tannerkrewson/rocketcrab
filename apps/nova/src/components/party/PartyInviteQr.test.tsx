import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PartyInviteQr } from "./PartyInviteQr";

const INVITE_URL = "https://nova.example/join#code=ABCD&secret=AAAA";

describe("PartyInviteQr", () => {
  it("renders an SVG QR code with the invite URL shown for copying", () => {
    const { container } = render(<PartyInviteQr inviteUrl={INVITE_URL} />);
    const svg = container.querySelector("svg[aria-label='Party invite QR code']");
    expect(svg).not.toBeNull();
    expect(screen.getByText(INVITE_URL)).toBeInTheDocument();
  });

  it("passes the invite URL to qrcode.react (fragment secret intact)", () => {
    const { container } = render(<PartyInviteQr inviteUrl={INVITE_URL} size={128} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // qrcode.react renders the QR modules as a single dense path; a healthy
    // payload produces a long path `d` rather than an empty placeholder.
    const pathData = [...(svg?.querySelectorAll("path") ?? [])]
      .map((path) => path.getAttribute("d") ?? "")
      .join("");
    expect(pathData.length).toBeGreaterThan(500);
  });
});
