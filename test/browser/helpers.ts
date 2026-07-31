/**
 * Shared helpers for the browser-mode E2E suite.
 *
 * The "host" player is driven through Vitest browser mode's `page` API (a
 * FrameLocator for the app rendered in a nested iframe inside the test
 * iframe). Additional players are real pages in isolated BrowserContexts,
 * driven through the `rocketcrab` custom command.
 */
import { mountHostApp, page, rc, unmountHostApp } from "./driver";
import { APP_URL } from "./constants";

export let host: ReturnType<typeof page.frameLocator>;

export async function mountHost(path = "/"): Promise<void> {
    host = await mountHostApp(APP_URL + path);
}

/** Host creates a party from the home page and enters a username. */
export async function createPartyAsHost(): Promise<string> {
    await mountHost("/");
    await host.getByRole("button", { name: "Start Party" }).click();
    await host.getByLabelText("Enter your name:").fill("Alice");
    await host.getByRole("button", { name: "Confirm" }).click();
    await rc({
        op: "hostWaitText",
        selector: "body",
        text: "Welcome to Rocketcrab!",
    });
    const url = (await rc({ op: "hostUrl" })) as string;
    const match = /\/([a-z]{4})$/.exec(url);
    if (!match) throw new Error(`Cannot extract party code from host URL: ${url}`);
    return match[1];
}

/** A new player (isolated browser context) joins a party via /join. */
export async function joinPartyAsPlayer(code: string, name: string): Promise<number> {
    const { index: i } = (await rc({ op: "open", url: `${APP_URL}/join` })) as {
        index: number;
    };
    await rc({ op: "joinByCode", i, value: code, url: `${APP_URL}/join` });
    await rc({ op: "waitFor", i, selector: "#player-name" });
    await rc({
        op: "fillSubmit",
        i,
        selector: "#player-name",
        submitSelector: 'button:has-text("Confirm")',
        value: name,
    });
    await rc({ op: "click", i, selector: 'button:has-text("Confirm")' });
    return i;
}

/** Host selects "Just One" from the game library and starts the game. */
export async function selectAndStartJustOne(): Promise<void> {
    await host.getByRole("button", { name: "Browse Games" }).click();
    await host.getByPlaceholder("Search").fill("Just One");
    await host.getByText("Just One", { exact: true }).click();
    await host.getByRole("button", { name: "Select" }).click();
    await rc({
        op: "hostWaitText",
        selector: "body",
        text: "You've selected: Just One",
    });
    await host.getByRole("button", { name: "Start Game" }).click();
}

/** Wait until every player's mock game iframe has all players registered. */
export async function waitForMockGameReady(playerIndexes: number[]): Promise<void> {
    await rc({
        op: "hostGameWaitText",
        selector: '[data-testid="player-count"]',
        text: String(playerIndexes.length + 1),
    });
    for (const i of playerIndexes) {
        await rc({
            op: "gameWaitText",
            i,
            selector: '[data-testid="player-count"]',
            text: String(playerIndexes.length + 1),
        });
    }
}

/** Host starts the mock game; everyone's mock moves to the prompts phase. */
export async function startMockGame(playerIndexes: number[]): Promise<void> {
    await rc({ op: "hostGameClick", selector: '[data-testid="start-game"]' });
    await rc({ op: "hostGameWaitText", selector: '[data-testid="phase"]', text: "prompts" });
    for (const i of playerIndexes) {
        await rc({ op: "gameWaitText", i, selector: '[data-testid="phase"]', text: "prompts" });
    }
}

export { unmountHostApp };
