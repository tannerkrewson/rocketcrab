/** Read quiz DOM state through __runtimeApi for arena and real-party specs. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame } from "@playwright/test";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** The nova-quiz fixture: the game the quiz specs play. */
export const NOVA_QUIZ_HTML = readFileSync(
  path.join(dirname, "..", "packages", "testing", "fixtures", "games", "nova-quiz.html"),
  "utf8",
);

export interface GameFrameState {
  roundChip: string | null;
  quizmaster: string | null;
  question: string | null;
  phase: "waiting" | "question" | "revealed" | "finished" | "unknown";
  spectator: boolean;
  revealButton: boolean;
  nextButton: boolean;
  answersList: boolean;
  scores: string | null;
  connChip: string | null;
}

/** Snapshot the game's DOM through the runtime frame's game window. */
export async function gameState(frame: Frame): Promise<GameFrameState | null> {
  return frame.evaluate(() => {
    const api = (window as unknown as { __runtimeApi: { getGameWindow(): Window | null } })
      .__runtimeApi;
    const doc = api.getGameWindow()?.document;
    if (doc === undefined) return null;
    const text = (selector: string): string | null =>
      doc.querySelector(selector)?.textContent?.trim() ?? null;
    const has = (selector: string): boolean => doc.querySelector(selector) !== null;
    const quizmaster = doc.querySelector(".quizmaster-line span")?.textContent?.trim() ?? null;
    const question = text('[data-testid="question"]');
    const answersList = has('[data-testid="answers-list"]');
    const gameOver = has('[data-testid="game-over"]');
    let phase: GameFrameState["phase"] = "unknown";
    if (has('[data-testid="waiting-line"]')) phase = "waiting";
    else if (question !== null && !answersList && !gameOver) phase = "question";
    else if (answersList && !gameOver) phase = "revealed";
    else if (gameOver) phase = "finished";
    return {
      roundChip: text('[data-testid="round-chip"]'),
      quizmaster,
      question,
      phase,
      spectator: has('[data-testid="spectator-banner"]'),
      revealButton: has('[data-action="reveal"]'),
      nextButton: has('[data-action="next"]'),
      answersList,
      scores: text('[data-testid="scores"]'),
      connChip: text('[data-testid="conn-chip"]'),
    };
  });
}

export async function waitForGameState(
  frame: Frame,
  predicate: (state: GameFrameState) => boolean,
  timeoutMs = 60_000,
): Promise<GameFrameState> {
  const deadline = Date.now() + timeoutMs;
  let last: GameFrameState | null = null;
  let lastError: unknown = null;
  for (;;) {
    try {
      last = await gameState(frame);
      lastError = null;
    } catch (error) {
      // The runtime frame reboots when the play view mounts; its API is not
      // there for a moment. Retry until the deadline, then report the error.
      lastError = error;
    }
    if (last !== null && predicate(last)) return last;
    if (Date.now() > deadline) {
      if (lastError !== null) throw lastError;
      throw new Error(
        `Timed out waiting for the game frame (last state: ${JSON.stringify(last)}).`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Dispatch a synthetic click inside one game frame. */
export async function clickInGame(frame: Frame, selector: string): Promise<void> {
  await frame.evaluate((clickSelector) => {
    const api = (window as unknown as { __runtimeApi: { getGameWindow(): Window | null } })
      .__runtimeApi;
    const element = api
      .getGameWindow()
      ?.document.querySelector(clickSelector) as HTMLElement | null;
    element?.click();
  }, selector);
}
