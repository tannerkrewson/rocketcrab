import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NOVA_API_VERSION } from "@rocketcrab/nova-api";
import { describe, expect, it } from "vitest";
import { MASTER_PROMPT_VERSION, buildMasterPrompt } from "./master-prompt";

/**
 * Master prompt template tests (A4). The prompt is the single artifact users
 * copy into AI chat services, so its content is pinned here:
 *
 * - every behavior from the issue is asserted present,
 * - the prompt is vendor-neutral (acceptance: no dependency on a specific
 *   AI vendor),
 * - all three modes are distinguished and state mode is preferred,
 * - the embedded Nova API reference matches the versioned fixture, and the
 *   fixture matches the live docs file — an API change fails this test
 *   until the fixture and template version are updated (acceptance: API
 *   changes require prompt tests to be updated),
 * - the complete prompt text is snapshotted (versioned, committed).
 */

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const DOCS_REFERENCE_PATH = join(TEST_DIR, "../../../../../docs/api/nova-api-ai-reference.md");
const FIXTURE_PATH = join(TEST_DIR, "fixtures/nova-api-reference-v1.md");

const prompt = buildMasterPrompt();
// Phrase assertions must survive the prompt's line wrapping: collapse any
// run of whitespace (including newlines) to single spaces first.
const normalized = prompt.replace(/\s+/g, " ");

describe("master prompt — issue behaviors", () => {
  it("instructs the chatbot to interview the user before writing code (1)", () => {
    expect(normalized).toContain("Interview the user before writing any code");
    expect(normalized).toContain("Never write code before you understand the game");
  });

  it("asks concrete questions about rules, players, turns, controls, visuals, sound, device use, and pace (2)", () => {
    for (const topic of [
      "Rules",
      "Players",
      "Turn structure",
      "Controls",
      "Visuals",
      "Sound",
      "Device use",
      "Game pace",
    ]) {
      expect(normalized).toContain(`**${topic}**`);
    }
  });

  it("decides between state, simulation, and raw mode (3)", () => {
    expect(normalized).toContain("Choose the mode: state, simulation, or raw");
    expect(normalized).toContain("**state (default)**");
    expect(normalized).toContain("**simulation**");
    expect(normalized).toContain("**raw**");
  });

  it("prefers state mode unless the game genuinely needs another mode (4)", () => {
    expect(normalized).toContain("Prefer state mode unless the game genuinely needs another mode");
  });

  it("builds for phones first (5)", () => {
    expect(normalized).toContain("Build for phones first");
    expect(normalized).toContain("one-column layout, large tap targets, readable text");
    expect(normalized).toContain("env(safe-area-inset-*)");
  });

  it("produces exactly one complete HTML document (6)", () => {
    expect(normalized).toContain("exactly ONE complete HTML document");
  });

  it("puts all custom HTML, CSS, and JavaScript in that document (7)", () => {
    expect(normalized).toContain("ALL custom HTML, CSS, and JavaScript in that single document");
  });

  it("allows normal remote CDNs and assets (8)", () => {
    expect(normalized).toContain("remote CDNs and assets");
  });

  it("pins dependency versions (9)", () => {
    expect(normalized).toContain("PIN every dependency to an exact version");
    expect(normalized).toContain('never "latest"');
  });

  it("avoids npm, CLI tools, hosting, repositories, and extra files (10)", () => {
    expect(normalized).toContain(
      "Never require npm, command-line tools, hosting, a repository, or additional files",
    );
    expect(normalized).toContain("self-contained and pasteable");
  });

  it("requires the documented Nova API (11)", () => {
    expect(normalized).toContain("Use the documented Nova API");
    expect(normalized).toContain("nova.defineGame(...)");
    expect(normalized).toContain("nova.ready()");
    expect(normalized).toContain("never invent methods");
  });

  it("handles player join, leave, reconnect, and errors (12)", () => {
    expect(normalized).toContain("joining and leaving");
    expect(normalized).toContain("connection changes and reconnects");
    expect(normalized).toContain("API errors");
    expect(normalized).toContain("stale_revision");
  });

  it("avoids permanent host assumptions (13)", () => {
    expect(normalized).toContain("Never assume a permanent host");
    expect(normalized).toContain('Never elect or detect a "host"');
  });

  it("provides visible errors when browser capabilities are unavailable (14)", () => {
    expect(normalized).toContain("Fail visibly when capabilities are unavailable");
    expect(normalized).toContain(
      "show a clear on-screen error message instead of failing silently",
    );
  });

  it("returns the final game in one code block suitable for pasting into Nova (15)", () => {
    expect(normalized).toContain("Return the final game in ONE code block");
    expect(normalized).toContain("single fenced code block");
    expect(normalized).toContain("ready to paste into Nova");
  });
});

describe("master prompt — acceptance criteria", () => {
  it("contains no dependency on a specific AI vendor", () => {
    const vendorNames = [
      "ChatGPT",
      "Claude",
      "Gemini",
      "Copilot",
      "Bard",
      "Grok",
      "LLaMA",
      "Mistral",
      "OpenAI",
      "Anthropic",
    ];
    const lower = normalized.toLowerCase();
    for (const vendor of vendorNames) {
      expect(lower).not.toContain(vendor.toLowerCase());
    }
    // The prompt must stay portable across services, and say so.
    expect(normalized).toContain("any AI chat service");
  });

  it("accurately distinguishes all three modes", () => {
    // State-mode contract (from the docs): Nova owns state, ordering, views, migration.
    expect(normalized).toContain(
      "Nova owns the canonical state, action ordering, deduplication, per-player views, and migration",
    );
    // Simulation: local copy per frame, Nova owns inputs, clock, snapshots, authority.
    expect(normalized).toContain(
      "The game runs a local simulation copy on every frame; Nova owns input ordering, the tick clock, snapshots, and authority",
    );
    // Raw: transport only, no synchronization or migration guarantees.
    expect(normalized).toContain(
      "Nova provides transport only, with no synchronization or migration guarantees",
    );
    // The embedded reference must also describe the modes (S1 source of truth).
    expect(normalized).toContain(
      "turn-based / card / board / trivia / drawing / voting / word / social games",
    );
  });

  it("is versioned with the template and Nova API versions", () => {
    expect(normalized).toContain(`template v${MASTER_PROMPT_VERSION}`);
    expect(normalized).toContain(`Nova API v${NOVA_API_VERSION}`);
    expect(normalized).toContain(`The Nova API reference (Nova API v${NOVA_API_VERSION})`);
    expect(MASTER_PROMPT_VERSION).toBe(1);
    expect(NOVA_API_VERSION).toBe(1);
  });

  it("embeds a versioned reference fixture that matches the live docs file (drift guard)", () => {
    const docsReference = readFileSync(DOCS_REFERENCE_PATH, "utf8");
    const fixture = readFileSync(FIXTURE_PATH, "utf8");
    // API changes to the docs fail here until the versioned fixture (and the
    // template version) are updated — "API changes require prompt tests to
    // be updated".
    expect(fixture).toBe(docsReference);
    // And the built prompt embeds that exact reference (raw, un-normalized).
    expect(prompt).toContain(fixture);
    // The fixture file is on disk next to the module and version-controlled.
    expect(existsSync(FIXTURE_PATH)).toBe(true);
  });

  it("keeps the minimal state-mode registration contract a generated game needs", () => {
    // A generated state-mode game must register and run with no setup: the
    // reference keeps the registration/lifecycle surface and the minimal
    // game inline (S1/S4 contract).
    expect(normalized).toContain("createInitialState");
    expect(normalized).toContain("actions:");
    expect(normalized).toContain("selectView");
    expect(normalized).toContain("nova.onStart");
    expect(normalized).toContain("Minimal game");
  });
});

describe("master prompt — versioned snapshot", () => {
  it("matches the committed prompt snapshot", () => {
    // Deliberate checkpoint: any wording/API change updates this snapshot
    // under review, keeping the shipped prompt versioned.
    expect(buildMasterPrompt()).toMatchSnapshot();
  });
});
