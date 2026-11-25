import { describe, expect, it } from "vitest";
import reference from "./nova-api-reference.md?raw";
import { buildMasterPrompt, buildMasterPromptWithGame } from "./master-prompt";

/**
 * The prompt text itself is pinned by the snapshot; these tests guard the
 * properties a wording change must never lose.
 */
const prompt = buildMasterPrompt();
const normalized = prompt.replace(/\s+/g, " ");

describe("master prompt", () => {
  it("embeds the AI API reference verbatim, so the API rules live in one file", () => {
    expect(prompt).toContain(reference);
  });

  it("names no AI vendor and says it works with any chat service", () => {
    const lower = normalized.toLowerCase();
    for (const vendor of ["chatgpt", "claude", "gemini", "copilot", "grok", "openai", "anthropic"])
      expect(lower).not.toContain(vendor);
    expect(normalized).toContain("any AI chat service");
  });

  it("keeps the interview, phones-first, one-document and single-code-block rules", () => {
    expect(normalized).toContain("Never write code before you understand the game");
    expect(normalized).toContain("Phones first");
    expect(normalized).toContain("One self-contained HTML document");
    expect(normalized).toContain("single fenced code block tagged `html`");
    expect(normalized).toContain("Prefer this whenever the game can work this way");
    expect(normalized).toContain("Held input goes in controls");
  });

  it("tells games to render without a party (the preview has no session)", () => {
    expect(normalized).toContain("never wait for the party");
    expect(normalized).toContain('`nova.connectionStatus` stays `"disconnected"`');
  });

  it("matches the committed snapshot", () => {
    expect(prompt).toMatchSnapshot();
  });
});

describe("master prompt with an existing game", () => {
  it("appends the game, its title and a continue instruction after the plain prompt", () => {
    const withGame = buildMasterPromptWithGame("<p>hi</p>", "Card Sharks");
    expect(withGame.startsWith(prompt)).toBe(true);
    expect(withGame).toContain("Title: Card Sharks");
    expect(withGame).toContain("```html\n<p>hi</p>\n```");
    expect(withGame).toContain("Continue and improve this exact game");
  });

  it("omits the title line when there is no title", () => {
    const withGame = buildMasterPromptWithGame("<p>hi</p>", "  ");
    expect(withGame).not.toContain("Title:");
  });
});
