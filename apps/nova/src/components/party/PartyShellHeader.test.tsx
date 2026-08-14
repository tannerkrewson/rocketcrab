import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PartyShellHeader } from "./PartyShellHeader";

/**
 * Party shell header tests (7.22): the classic-style header shows the
 * rocket + crab logo, the big mono room code, and the lowercase phonetic
 * spelling. Clicking the code copies the invite link. The invite details
 * (QR / URL / copy row) moved to the lobby's invite card (10.5) — the
 * header stays the classic identity.
 */

const INVITE_URL = "http://localhost:5173/join#code=RCRB&secret=invite-secret";

afterEach(() => {
  cleanup();
});

describe("PartyShellHeader", () => {
  it("renders the logo and the big mono code with lowercase phonetic spelling", () => {
    render(<PartyShellHeader code="RCRB" inviteUrl={INVITE_URL} />);
    expect(screen.getByTestId("party-code")).toHaveTextContent("RCRB");
    const phonetic = screen.getByText(/romeo charlie romeo bravo/i);
    expect(phonetic).toBeInTheDocument();
    // 10.5: the phonetic is lowercase (never ALL CAPS), consistent with the
    // join page.
    expect(phonetic.textContent).toBe("(romeo charlie romeo bravo)");
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

  it("never renders the invite URL text (10.5 / ADR-0011)", () => {
    render(<PartyShellHeader code="RCRB" inviteUrl={INVITE_URL} />);
    expect(screen.queryByText(INVITE_URL)).not.toBeInTheDocument();
    expect(screen.queryByText(/invite-secret/)).not.toBeInTheDocument();
  });

  it("suppresses the phonetic spelling when disabled (classic join page)", () => {
    render(<PartyShellHeader code="RCRB" disablePhonetic />);
    expect(screen.queryByText(/romeo charlie romeo bravo/i)).not.toBeInTheDocument();
  });
});
