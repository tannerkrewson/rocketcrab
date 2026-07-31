/**
 * In-game user flows, end-to-end in real Chromium.
 *
 * The host starts "Just One" (a game whose connectToGame generates the room
 * URL locally). The embedded game iframe points at just1.herokuapp.com, which
 * is intercepted by the `rocketcrab` command and served the local mock game
 * fixture (test/browser/mock-game.html). The mock game implements the full
 * party-game loop — writing prompts, answering prompts, voting on answers,
 * and showing the winner + leaderboard — synced across the players' iframes
 * via BroadcastChannel, so the whole flow runs in real browsers.
 */
import { afterEach, describe, expect, it } from "vitest";
import { rc } from "./driver";
import {
    createPartyAsHost,
    joinPartyAsPlayer,
    selectAndStartJustOne,
    startMockGame,
    unmountHostApp,
    waitForMockGameReady,
} from "./helpers";

type Target = number | "host";

const hostIs = (t: Target): boolean => t === "host";

async function fillOn(t: Target, selector: string, value: string): Promise<void> {
    if (hostIs(t)) {
        await rc({ op: "hostGameFill", selector, value });
    } else {
        await rc({ op: "gameFill", i: t as number, selector, value });
    }
}

async function clickOn(t: Target, selector: string): Promise<void> {
    if (hostIs(t)) {
        await rc({ op: "hostGameClick", selector });
    } else {
        await rc({ op: "gameClick", i: t as number, selector });
    }
}

async function waitOn(t: Target, selector: string, text: string): Promise<void> {
    if (hostIs(t)) {
        await rc({ op: "hostGameWaitText", selector, text });
    } else {
        await rc({ op: "gameWaitText", i: t as number, selector, text });
    }
}

async function countOn(t: Target, selector: string): Promise<number> {
    const n = hostIs(t)
        ? await rc({ op: "hostGameCount", selector })
        : await rc({ op: "gameCount", i: t as number, selector });
    return Number(n);
}

/** Submit a prompt; when `isLast`, the whole party advances to answers. */
async function submitPrompt(t: Target, text: string, isLast: boolean): Promise<void> {
    await fillOn(t, '[data-testid="prompt-input"]', text);
    await clickOn(t, '[data-testid="submit-prompt"]');
    if (isLast) {
        await waitOn(t, '[data-testid="phase"]', "answers");
    } else {
        await waitOn(t, '[data-testid="prompts-count"]', "submitted");
    }
}

/** Answer the 3 other players' prompts one at a time. */
async function answerAll(t: Target, isLast: boolean): Promise<void> {
    const answers = ["pineapple", "octopus", "teal"];
    for (let k = 0; k < 3; k++) {
        await fillOn(t, '[data-testid="answer-input"]', answers[k]);
        await clickOn(t, '[data-testid="submit-answer"]');
        if (isLast && k === 2) {
            await waitOn(t, '[data-testid="phase"]', "votes");
        } else {
            await waitOn(t, '[data-testid="answers-count"]', `${k + 1}/3`);
        }
    }
}

/**
 * Vote on 3 prompts. Everyone votes for Alice's answer whenever she is an
 * option (she answered every prompt she didn't write), which makes Alice the
 * overall winner. Otherwise (prompt written by Alice) they pick the first
 * option. When `isLast`, the whole party advances to results.
 */
async function voteAll(t: Target, isLast: boolean): Promise<void> {
    const aliceOption = '[data-testid="vote-option"][data-answerer="Alice"]';
    for (let k = 0; k < 3; k++) {
        const aliceCount = await countOn(t, aliceOption);
        if (aliceCount > 0) {
            await clickOn(t, aliceOption);
        } else {
            await clickOn(t, '[data-testid="vote-option"]');
        }
        if (isLast && k === 2) {
            await waitOn(t, '[data-testid="phase"]', "results");
        } else {
            await waitOn(t, '[data-testid="votes-count"]', `${k + 1}/3`);
        }
    }
}

describe("in-game flows (mock party game)", () => {
    afterEach(async () => {
        unmountHostApp();
        await rc({ op: "closeAll" });
    });

    it("host starts a game and every player's iframe gets the rocketcrab identity params", async () => {
        const code = await createPartyAsHost();
        const bob = await joinPartyAsPlayer(code, "Bob");
        const cara = await joinPartyAsPlayer(code, "Cara");
        const players: Array<[number, string]> = [
            [bob, "Bob"],
            [cara, "Cara"],
        ];

        await selectAndStartJustOne();

        // Host's embedded game iframe loads the game with host params.
        await rc({ op: "hostGameWaitFor", selector: '[data-testid="mock-game"]' });
        const hostSrc = (await rc({
            op: "hostAttr",
            selector: 'iframe[src*="just1.herokuapp.com"]',
            name: "src",
        })) as string;
        const hostParams = new URL(hostSrc).searchParams;
        expect(hostParams.get("rocketcrab")).toBe("true");
        expect(hostParams.get("name")).toBe("Alice");
        expect(hostParams.get("ishost")).toBe("true");

        // Each player's embedded game iframe loads with non-host params.
        for (const [i, name] of players) {
            await rc({ op: "gameWaitFor", i, selector: '[data-testid="mock-game"]' });
            const src = (await rc({
                op: "eval",
                i,
                code: 'document.querySelector(\'iframe[src*="just1.herokuapp.com"]\').src',
            })) as string;
            const params = new URL(src).searchParams;
            expect(params.get("rocketcrab")).toBe("true");
            expect(params.get("name")).toBe(name);
            expect(params.get("ishost")).toBe("false");
        }

        // Everyone's game lobby shows all 4 players registered.
        await waitForMockGameReady([bob, cara]);
    });
    it("players play a full round: prompts, answers, votes, winner, leaderboard", async () => {
        const code = await createPartyAsHost();
        const bob = await joinPartyAsPlayer(code, "Bob");
        const cara = await joinPartyAsPlayer(code, "Cara");
        const dan = await joinPartyAsPlayer(code, "Dan");
        const players: Target[] = [bob, cara, dan];

        await selectAndStartJustOne();
        await waitForMockGameReady(players);

        // ---- Phase 0: host starts the mock game; everyone moves to prompts.
        await startMockGame(players);
        await submitPrompt("host", "What's the best pizza topping?", false);
        await submitPrompt(bob, "Name a sea creature.", false);
        await submitPrompt(cara, "Invent a new color.", false);
        await submitPrompt(dan, "What would a crab say?", true);
        for (const t of players) {
            await waitOn(t, '[data-testid="phase"]', "answers");
        }
        await waitOn("host", '[data-testid="phase"]', "answers");

        // ---- Phase 2: everyone answers the other 3 prompts. Dan (last) advances.
        await answerAll("host", false);
        await answerAll(bob, false);
        await answerAll(cara, false);
        await answerAll(dan, true);
        for (const t of players) {
            await waitOn(t, '[data-testid="phase"]', "votes");
        }
        await waitOn("host", '[data-testid="phase"]', "votes");

        // ---- Phase 3: everyone votes. Dan (last) advances to results.
        await voteAll("host", false);
        await voteAll(bob, false);
        await voteAll(cara, false);
        await voteAll(dan, true);

        // ---- Phase 4: results — winner + leaderboard on every player's screen.
        for (const t of ["host", ...players]) {
            await waitOn(t, '[data-testid="winner"]', "Alice wins!");
            await waitOn(
                t,
                '[data-testid="leaderboard-row"][data-player="Alice"]',
                "6 votes",
            );
        }
        const winner = await rc({ op: "hostGameText", selector: '[data-testid="winner"]' });
        expect(winner).toContain("Alice wins!");
        const rows = await rc({ op: "hostGameCount", selector: '[data-testid="leaderboard-row"]' });
        expect(rows).toBe(4);
    });

    it("host exits the game and all players return to the party lobby", async () => {
        const code = await createPartyAsHost();
        const bob = await joinPartyAsPlayer(code, "Bob");
        const cara = await joinPartyAsPlayer(code, "Cara");
        const players = [bob, cara];

        await selectAndStartJustOne();
        await waitForMockGameReady(players);

        // Host opens the in-game menu and exits to the party.
        await rc({ op: "hostClick", selector: 'button:has-text("▼ Menu")' });
        await rc({ op: "hostClick", selector: 'button:has-text("Exit to party")' });
        await rc({ op: "hostWaitText", selector: "body", text: "Are you sure?" });
        await rc({
            op: "hostClick",
            selector: 'button:has-text("Exit to party") >> nth=-1',
        });

        // Everyone lands back in the lobby with the game still selected.
        await rc({ op: "hostWaitText", selector: "body", text: "You've selected: Just One" });
        for (const i of players) {
            await rc({ op: "waitText", i, selector: "body", text: "Waiting for Alice to start..." });
        }
    });
});
