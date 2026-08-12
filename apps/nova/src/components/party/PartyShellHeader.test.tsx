import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PartyShellHeader } from "./PartyShellHeader";

/**
 * Party shell header tests (7.22): the classic-style header shows the
 * rocket + crab logo, the big mono room code, the phonetic spelling, and —
 * when requested — the Nova-only invite QR + copy row. Clicking the code
 * copies the invite link.
 */

const INVITE_URL = "http://localhost:5173/join#code=RCRB&secret=invite-secret";

afterEach(() => {
  cleanup();
});

describe("PartyShellHeader", () => {
  it("renders the logo and the big mono code with phonetic spelling", () => {
    render(<PartyShellHeader code="RCRB" inviteUrl={INVITE_URL} />);
    expect(screen.getByTestId("party-code")).toHaveTextContent("RCRB");
    expect(screen.getByText(/romeo charlie romeo bravo/i)).toBeInTheDocument();
  });

  it("renders only the logo when no code is known yet", () => {
    render(<PartyShellHeader />);
    expect(screen.queryByTestId("party-code")).not.toBeInTheDocument();
    expect(screen.getByText("🦀🚀")).toBeInTheDocument();
  });

  it("copies the invite link when the code is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<PartyShellHeader code="RCRB" inviteUrl={INVITE_URL} />);
    await userEvent.click(screen.getByTestId("party-code"));
    expect(writeText).toHaveBeenCalledWith(INVITE_URL);
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  it("shows the invite QR + copy row when requested", () => {
    render(<PartyShellHeader code="RCRB" inviteUrl={INVITE_URL} showInviteDetails />);
    expect(screen.getByLabelText("Party invite QR code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy invite link/i })).toBeInTheDocument();
    expect(screen.getAllByText(INVITE_URL).length).toBeGreaterThan(0);
  });

  it("suppresses the phonetic spelling when disabled (classic join page)", () => {
    render(<PartyShellHeader code="RCRB" disablePhonetic />);
    expect(screen.queryByText(/romeo charlie romeo bravo/i)).not.toBeInTheDocument();
  });
});
