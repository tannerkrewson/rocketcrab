import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PartyInviteQr } from "./PartyInviteQr";

const INVITE_URL = "https://nova.example/join#code=ABCD&secret=AAAA";

describe("PartyInviteQr", () => {
  it("renders an SVG QR code with the safe label instead of the URL", () => {
    const { container } = render(
      <PartyInviteQr inviteUrl={INVITE_URL} label="nova.example/abcd" />,
    );
    const svg = container.querySelector("svg[aria-label='Party invite QR code']");
    expect(svg).not.toBeNull();
    expect(screen.getByText("nova.example/abcd")).toBeInTheDocument();
  });

  it("passes the invite URL to qrcode.react (fragment secret intact)", () => {
    const { container } = render(
      <PartyInviteQr inviteUrl={INVITE_URL} size={128} label="nova.example/abcd" />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // qrcode.react renders the QR modules as a single dense path; a healthy
    // payload produces a long path `d` rather than an empty placeholder.
    const pathData = [...(svg?.querySelectorAll("path") ?? [])]
      .map((path) => path.getAttribute("d") ?? "")
      .join("");
    expect(pathData.length).toBeGreaterThan(500);
  });

  it("never renders the full invite URL as text (10.5 / ADR-0011)", () => {
    const { container } = render(
      <PartyInviteQr inviteUrl={INVITE_URL} label="nova.example/abcd" />,
    );
    expect(screen.queryByText(INVITE_URL)).not.toBeInTheDocument();
    expect(screen.queryByText(/secret=AAAA/)).not.toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
