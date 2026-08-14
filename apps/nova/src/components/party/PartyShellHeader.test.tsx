import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PartyShellHeader } from "./PartyShellHeader";

/**
 * Party shell header tests (7.22 / 11.6): the classic-style header shows
 * the rocket + crab logo, ONE lobby page title — "origin/lowercase-code"
 * (e.g. "localhost/rcrb") styled like the homepage title — and the
 * lowercase phonetic spelling. Tapping the title copies the invite link;
 * the cursor + title attribute hint that it is copyable. The invite
 * details (QR / URL / copy row) live in the lobby's invite card (10.5) —
 * the header stays the classic identity.
 */

const INVITE_URL = "http://localhost:5173/join#code=RCRB&secret=invite-secret";

afterEach(() => {
  cleanup();
});

describe("PartyShellHeader", () => {
  it("renders the logo and one origin+code title with lowercase phonetic spelling", () => {
    render(<PartyShellHeader code="RCRB" inviteUrl={INVITE_URL} />);
    const title = screen.getByTestId("party-title");
    // The title is ONE "origin/code" string; the code is lowercase and is
    // never shown separately from the title.
    expect(title.textContent).toBe(`${window.location.host}/rcrb`);
    expect(screen.queryByText("RCRB")).not.toBeInTheDocument();
    const phonetic = screen.getByText(/romeo charlie romeo bravo/i);
    expect(phonetic).toBeInTheDocument();
    // 10.5: the phonetic is lowercase (never ALL CAPS), consistent with the
    // join page.
    expect(phonetic.textContent).toBe("(romeo charlie romeo bravo)");
  });

  it("renders only the logo when no code is known yet", () => {
    render(<PartyShellHeader />);
    expect(screen.queryByTestId("party-title")).not.toBeInTheDocument();
    expect(screen.getByText("🦀🚀")).toBeInTheDocument();
  });

  it("copies the invite link when the title is tapped", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<PartyShellHeader code="RCRB" inviteUrl={INVITE_URL} />);
    const title = screen.getByTestId("party-title");
    // Cursor + title attribute hint that the title is copyable.
    expect(title).toHaveClass("cursor-pointer");
    expect(title).toHaveAttribute("title", "Copy the invite link");
    await userEvent.click(title);
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
    expect(screen.queryByText("(romeo charlie romeo bravo)")).not.toBeInTheDocument();
  });
});
