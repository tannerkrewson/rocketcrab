/**
 * Custom vitest browser-mode command: "rocketcrab".
 *
 * Vitest's own `page` (from `@vitest/browser/context`) is bound to the test
 * iframe and in v4.1.10 cannot navigate away from the vitest server, and its
 * locator `query()`/`element()` (used by `expect.element`) resolves elements
 * through the same-document selector engine, which cannot pierce cross-origin
 * frames. So to drive the *real* Rocketcrab app in real Chromium pages we use
 * the official browser-mode extension point: a server-side command that talks
 * to the provider's Playwright instance.
 *
 * The command owns:
 *  - "player" pages: real top-level pages, one isolated BrowserContext each
 *    (separate cookie jars — like separate phones). Indexed by the order they
 *    were opened.
 *  - "host" helpers: the host app is rendered in a nested iframe
 *    (`#host-app`) inside the vitest test iframe, so the tests can use
 *    vitest's `page` API for clicks/fills; this command reaches it through
 *    Playwright's frame locators for text reads / deeper nesting.
 *  - "game" helpers: the embedded game iframe (`just1.herokuapp.com`), which
 *    is intercepted and served the local mock game fixture.
 *
 * All results are JSON-serializable (the browser<->server command bridge
 * serializes over postMessage).
 */
import { defineBrowserCommand } from "@vitest/browser";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_GAME_FILE = path.join(__dirname, "mock-game.html");
const APP_URL = `http://localhost:${Number(process.env.ROCKETCRAB_TEST_PORT || 3010)}`;

export type RcOp =
    | "open"
    | "goto"
    | "fill"
    | "fillSubmit"
    | "joinByCode"
    | "click"
    | "press"
    | "waitFor"
    | "waitText"
    | "text"
    | "attr"
    | "url"
    | "count"
    | "eval"
    | "closeAll"
    // host (nested app iframe inside the vitest test iframe)
    | "hostWaitFor"
    | "hostWaitText"
    | "hostClick"
    | "hostFill"
    | "hostFillSubmit"
    | "hostPress"
    | "hostText"
    | "hostAttr"
    | "hostCount"
    | "hostUrl"
    // host's embedded game iframe (2 levels deep)
    | "hostGameWaitFor"
    | "hostGameWaitText"
    | "hostGameText"
    | "hostGameClick"
    | "hostGameFill"
    | "hostGameCount"
    // player's embedded game iframe (1 level deep)
    | "gameWaitFor"
    | "gameWaitText"
    | "gameText"
    | "gameClick"
    | "gameFill"
    | "gameCount";

export type RcPayload = {
    op: RcOp;
    i?: number;
    selector?: string;
    value?: string;
    key?: string;
    text?: string;
    name?: string;
    url?: string;
    code?: string;
    timeout?: number;
    submitSelector?: string;
};

type Player = { page: Page; context: BrowserContext };

const playersBySession = new Map<string, Player[]>();
const routedContexts = new WeakSet<BrowserContext>();

function getPlayers(sessionId: string): Player[] {
    return playersBySession.get(sessionId) ?? [];
}

const GAME_FRAME_SELECTOR = 'iframe[src*="just1.herokuapp.com"]';
const HOST_FRAME_SELECTOR = "#host-app";

/** The app frame of the host: vitest test iframe -> #host-app iframe. */
function hostFrame(ctx: { page: Page }): ReturnType<Page["frameLocator"]> {
    return ctx.page
        .frameLocator('[data-vitest="true"]')
        .frameLocator(HOST_FRAME_SELECTOR);
}

/** Host's embedded game frame (2 levels deep). */
function hostGameFrame(ctx: { page: Page }): ReturnType<Page["frameLocator"]> {
    return hostFrame(ctx).frameLocator(GAME_FRAME_SELECTOR);
}

/** Player page's embedded game frame (1 level deep). */
function gameFrame(page: Page): ReturnType<Page["frameLocator"]> {
    return page.frameLocator(GAME_FRAME_SELECTOR);
}

let mockHtmlPromise: Promise<string> | undefined;
function mockHtml(): Promise<string> {
    mockHtmlPromise ??= readFile(MOCK_GAME_FILE, "utf8");
    return mockHtmlPromise;
}

const MOCK_HOSTNAMES = ["just1.herokuapp.com", "www.qwiqwit.com"];

// ---------------------------------------------------------------------------
// Mock game state sync.
// The mock game iframes live in separate browser contexts (and the host's is
// a storage-partitioned third-party iframe), so BroadcastChannel can't share
// state between them. Instead the mock game POSTs its state to /__sync__ on
// the mocked origin; the route handler keeps a shared in-process store keyed
// by room and returns the merged state. This gives the mock game a real,
// deterministic backend.
// ---------------------------------------------------------------------------
type MockPhase = "lobby" | "prompts" | "answers" | "votes" | "results";

type MockState = {
    started: boolean;
    players: Array<{ name: string; isHost: boolean }>;
    prompts: Record<string, string>;
    answers: Record<string, Record<string, string>>;
    votes: Record<string, Record<string, string>>;
    phase: MockPhase;
};

const mockStore = new Map<string, MockState>();

function emptyMockState(): MockState {
    return {
        started: false,
        players: [],
        prompts: {},
        answers: {},
        votes: {},
        phase: "lobby",
    };
}

function mergeMockState(current: MockState, incoming: Partial<MockState>): MockState {
    const playerMap = new Map<string, { name: string; isHost: boolean }>();
    for (const p of [...current.players, ...(incoming.players ?? [])]) {
        const existing = playerMap.get(p.name);
        if (!existing || (!existing.isHost && p.isHost)) playerMap.set(p.name, p);
    }
    const players = [...playerMap.values()];
    const prompts = { ...current.prompts, ...(incoming.prompts ?? {}) };

    const answers: MockState["answers"] = {};
    for (const owner of new Set([
        ...Object.keys(current.answers),
        ...Object.keys(incoming.answers ?? {}),
    ])) {
        answers[owner] = {
            ...(current.answers[owner] ?? {}),
            ...((incoming.answers ?? {})[owner] ?? {}),
        };
    }
    const votes: MockState["votes"] = {};
    for (const owner of new Set([
        ...Object.keys(current.votes),
        ...Object.keys(incoming.votes ?? {}),
    ])) {
        votes[owner] = {
            ...(current.votes[owner] ?? {}),
            ...((incoming.votes ?? {})[owner] ?? {}),
        };
    }

    const started = current.started || !!incoming.started;
    const names = players.map((p) => p.name);
    const allPrompts =
        names.length > 0 && names.every((n) => typeof prompts[n] === "string");
    const ready = (set: Record<string, Record<string, string>>) =>
        names.length > 0 &&
        names.every((n) =>
            names.every((m) => m === n || typeof set[n]?.[m] === "string"),
        );

    let phase: MockPhase = started ? "prompts" : "lobby";
    if (allPrompts) phase = "answers";
    if (allPrompts && ready(answers)) phase = "votes";
    if (allPrompts && ready(votes)) phase = "results";

    return { started, players, prompts, answers, votes, phase };
}

async function ensureContextRoutes(context: BrowserContext): Promise<void> {
    if (routedContexts.has(context)) return;
    routedContexts.add(context);

    const html = await mockHtml();
    // Serve the local mock party game for the embedded game iframes, plus the
    // /__sync__ API that keeps the mock game state shared across contexts.
    await context.route(
        (url) => MOCK_HOSTNAMES.includes(url.hostname),
        async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.pathname === "/__sync__") {
                if (request.method() === "POST") {
                    let body: {
                        room?: string;
                        state?: Partial<MockState>;
                    } = {};
                    try {
                        body = JSON.parse(request.postData() ?? "{}");
                    } catch {
                        /* ignore */
                    }
                    const room = String(body.room ?? "unknown");
                    const merged = mergeMockState(
                        mockStore.get(room) ?? emptyMockState(),
                        body.state ?? {},
                    );
                    mockStore.set(room, merged);
                    await route.fulfill({
                        status: 200,
                        contentType: "application/json",
                        body: JSON.stringify(merged),
                    });
                    return;
                }
                const room = url.searchParams.get("room") ?? "unknown";
                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify(mockStore.get(room) ?? emptyMockState()),
                });
                return;
            }
            await route.fulfill({
                status: 200,
                contentType: "text/html",
                body: html,
            });
        },
    );
    // Never let the PWA service worker take over test pages.
    await context.route("**/sw.js", (route) => route.fulfill({ status: 204 }));
    // Deterministic GA behavior (no external network).
    await context.route(
        /googletagmanager\.com|google-analytics\.com|gtag/,
        (route) => route.fulfill({ status: 204 }),
    );
}

function whitespaceInsensitiveRegex(text: string): RegExp {
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // \s* instead of \s+ — hasText matches against textContent, which has
    // no whitespace at block-element boundaries ("selected:Just One").
    return new RegExp(escaped.replace(/\s+/g, "\\s*"));
}

async function waitTextInFrame(
    frame: ReturnType<Page["frameLocator"]>,
    selector: string,
    text: string,
    timeout = 30_000,
): Promise<void> {
    await frame.locator(selector).first().waitFor({ state: "attached", timeout });
    try {
        await frame
            .locator(selector)
            .first()
            .filter({ hasText: whitespaceInsensitiveRegex(text) })
            .waitFor({ state: "visible", timeout });
    } catch (err) {
        const actual = await frame
            .locator(selector)
            .first()
            .innerText()
            .catch(() => "?");
        throw new Error(
            `${(err as Error).message} — actual text: ${JSON.stringify(actual).slice(0, 500)}`, { cause: err },
        );
    }
}

export const rocketcrabCommand = defineBrowserCommand<[payload: RcPayload]>(
    async (ctx, payload) => {
        const sessionId = ctx.sessionId;
        const browser = ctx.provider.browser as Browser;
        const vitestContext = ctx.context as BrowserContext;
        await ensureContextRoutes(vitestContext);

        const op = payload.op;
        const player = (i: number): Page => {
            const p = getPlayers(sessionId)[i];
            if (!p) throw new Error(`No player page at index ${i}. Call open() first.`);
            return p.page;
        };

        switch (op) {
            // --------------------------------------------------------- players
            case "open": {
                const context = await browser.newContext({
                    viewport: { width: 414, height: 896 },
                });
                await ensureContextRoutes(context);
                const page = await context.newPage();
                page.on("pageerror", (err) => {
                    console.log(`[player-pageerror] ${String(err).slice(0, 400)}`);
                });
                page.on("requestfailed", (req) => {
                    console.log(
                        `[player-requestfailed] ${req.resourceType()} ${req.url().slice(0, 120)} → ${req.failure()?.errorText ?? "?"}`,
                    );
                });
                let players = playersBySession.get(sessionId);
                if (!players) {
                    players = [];
                    playersBySession.set(sessionId, players);
                }
                players.push({ page, context });
                if (payload.url) {
                    await page.goto(payload.url, { waitUntil: "domcontentloaded" });
                }
                const openResult = { index: players.length - 1 };
                return openResult;
            }
            case "goto": {
                await player(payload.i!).goto(payload.url!, {
                    waitUntil: "domcontentloaded",
                });
                return { ok: true };
            }
            case "fill": {
                await player(payload.i!).locator(payload.selector!).fill(payload.value!);
                return { ok: true };
            }
            case "fillSubmit": {
                // Fill an input and keep refilling until the submit button
                // becomes enabled (React may reset the value during hydration,
                // and hydration can be delayed). If it never enables, reload
                // the page once and retry — guards against a hung initial load.
                const fillPage = player(payload.i!);
                const submitSel = payload.submitSelector!;
                for (let round = 0; round < 2; round++) {
                    if (round > 0) {
                        await fillPage.reload({ waitUntil: "domcontentloaded" });
                    }
                    for (let attempt = 0; attempt < 60; attempt++) {
                        await fillPage.locator(payload.selector!).fill(payload.value!);
                        const disabled = await fillPage
                            .locator(submitSel)
                            .first()
                            .getAttribute("disabled");
                        if (disabled === null) return { ok: true };
                        await fillPage.waitForTimeout(300);
                    }
                }
                throw new Error(
                    `Submit button "${submitSel}" never became enabled after filling "${payload.selector}" with "${payload.value}". ` +
                        `inputValue=${JSON.stringify(await fillPage.locator(payload.selector!).inputValue().catch(() => "?"))}`,
                );
            }
            case "joinByCode": {
                // The /join page: type the code and press Enter. The Enter
                // handler navigates directly (it is not gated by the Join
                // button's disabled state), which makes this resilient to the
                // input being typed before React has hydrated.
                const joinPage = player(payload.i!);
                const joinCode = payload.value!;
                const joinUrl = payload.url ?? "";
                // Wait for the app bundle to start (socket.io connects at
                // module scope) — speeds up hydration before typing.
                await joinPage
                    .waitForRequest((req) => req.url().includes("/socket.io/"), {
                        timeout: 20_000,
                    })
                    .catch(() => {});
                for (let round = 0; round < 3; round++) {
                    if (round > 0 && joinUrl) {
                        await joinPage
                            .goto(joinUrl, { waitUntil: "domcontentloaded" })
                            .catch(() => {});
                    }
                    for (let attempt = 0; attempt < 20; attempt++) {
                        const input = joinPage.locator('input[placeholder="abcd"]');
                        await input.click({ timeout: 2000 }).catch(() => {});
                        await input.press("ControlOrMeta+a").catch(() => {});
                        await input.type(joinCode, { delay: 40 }).catch(() => {});
                        const value = await input.inputValue().catch(() => "");
                        const disabled = await joinPage
                            .locator('button:has-text("Join")')
                            .first()
                            .getAttribute("disabled")
                            .catch(() => "");
                        if (value === joinCode && disabled === null) {
                            await input.press("Enter");
                            return { ok: true };
                        }
                        await joinPage.waitForTimeout(250);
                    }
                }
                throw new Error(
                    `joinByCode failed: typed "${joinCode}" but the Join button never became enabled`,
                );
            }
            case "click": {
                await player(payload.i!)
                    .locator(payload.selector!)
                    .first()
                    .click({ timeout: 20_000 });
                return { ok: true };
            }
            case "press": {
                await player(payload.i!).keyboard.press(payload.key!);
                return { ok: true };
            }
            case "waitFor": {
                await player(payload.i!).waitForSelector(payload.selector!, {
                    state: (payload as { state?: string }).state as
                        | "visible"
                        | "attached"
                        | "hidden"
                        | undefined,
                    timeout: payload.timeout ?? 30_000,
                });
                return { ok: true };
            }
            case "waitText": {
                await player(payload.i!)
                    .locator(payload.selector!)
                    .first()
                    .waitFor({ state: "attached", timeout: payload.timeout ?? 30_000 });
                await player(payload.i!)
                    .locator(payload.selector!)
                    .first()
                    .filter({ hasText: whitespaceInsensitiveRegex(payload.text!) })
                    .waitFor({ state: "visible", timeout: payload.timeout ?? 30_000 });
                return { ok: true };
            }
            case "text": {
                return await player(payload.i!).locator(payload.selector!).first().innerText();
            }
            case "attr": {
                return await player(payload.i!)
                    .locator(payload.selector!)
                    .first()
                    .getAttribute(payload.name!);
            }
            case "url": {
                return player(payload.i!).url();
            }
            case "count": {
                return await player(payload.i!).locator(payload.selector!).count();
            }
            case "eval": {
                return await player(payload.i!).evaluate(payload.code!);
            }

            // ---------------------------------------------------------- host
            case "hostWaitFor": {
                await hostFrame(ctx)
                    .locator(payload.selector!)
                    .first()
                    .waitFor({
                        state: (payload as { state?: string }).state as
                            | "visible"
                            | "attached"
                            | "hidden"
                            | undefined,
                        timeout: payload.timeout ?? 30_000,
                    });
                return { ok: true };
            }
            case "hostWaitText": {
                await waitTextInFrame(hostFrame(ctx), payload.selector!, payload.text!, payload.timeout);
                return { ok: true };
            }
            case "hostClick": {
                await hostFrame(ctx)
                    .locator(payload.selector!)
                    .first()
                    .click({ timeout: 20_000 });
                return { ok: true };
            }
            case "hostFill": {
                await hostFrame(ctx).locator(payload.selector!).fill(payload.value!);
                return { ok: true };
            }
            case "hostFillSubmit": {
                const frame = hostFrame(ctx);
                const submitSel = payload.submitSelector!;
                for (let attempt = 0; attempt < 60; attempt++) {
                    await frame.locator(payload.selector!).fill(payload.value!);
                    const disabled = await frame
                        .locator(submitSel)
                        .first()
                        .getAttribute("disabled");
                    if (disabled === null) return { ok: true };
                    await frame.locator("html").evaluate(() => new Promise((r) => setTimeout(r, 300)));
                }
                throw new Error(
                    `Submit button "${submitSel}" never became enabled after filling "${payload.selector}" with "${payload.value}". ` +
                        `inputValue=${JSON.stringify(await frame.locator(payload.selector!).inputValue().catch(() => "?"))} ` +
                        `buttonHTML=${String(
                            await frame
                                .locator(submitSel)
                                .first()
                                .evaluate((el) => (el as HTMLElement).outerHTML)
                                .catch(() => "?"),
                        ).slice(0, 400)}`,
                );
            }
            case "hostPress": {
                await hostFrame(ctx).locator("html").press(payload.key!);
                return { ok: true };
            }
            case "hostText": {
                return await hostFrame(ctx).locator(payload.selector!).first().innerText();
            }
            case "hostEval": {
                return await hostFrame(ctx).locator("html").evaluate(payload.code!);
            }
            case "hostAttr": {
                return await hostFrame(ctx)
                    .locator(payload.selector!)
                    .first()
                    .getAttribute(payload.name!);
            }
            case "hostCount": {
                return await hostFrame(ctx).locator(payload.selector!).count();
            }
            case "hostUrl": {
                const frames = ctx.page.frames();
                const appFrame = frames.find(
                    (f) => f.url().startsWith(APP_URL) && f !== frames[0],
                );
                return appFrame?.url() ?? null;
            }

            // ----------------------------------------------- host game frame
            case "hostGameWaitFor": {
                await hostGameFrame(ctx)
                    .locator(payload.selector!)
                    .first()
                    .waitFor({ state: "visible", timeout: payload.timeout ?? 30_000 });
                return { ok: true };
            }
            case "hostGameWaitText": {
                await waitTextInFrame(hostGameFrame(ctx), payload.selector!, payload.text!, payload.timeout);
                return { ok: true };
            }
            case "hostGameText": {
                return await hostGameFrame(ctx).locator(payload.selector!).first().innerText();
            }
            case "hostGameClick": {
                await hostGameFrame(ctx)
                    .locator(payload.selector!)
                    .first()
                    .click({ timeout: 20_000 });
                return { ok: true };
            }
            case "hostGameFill": {
                await hostGameFrame(ctx).locator(payload.selector!).fill(payload.value!);
                return { ok: true };
            }
            case "hostGameCount": {
                return await hostGameFrame(ctx).locator(payload.selector!).count();
            }

            // -------------------------------------------- player game frame
            case "gameWaitFor": {
                await gameFrame(player(payload.i!))
                    .locator(payload.selector!)
                    .first()
                    .waitFor({ state: "visible", timeout: payload.timeout ?? 30_000 });
                return { ok: true };
            }
            case "gameWaitText": {
                await waitTextInFrame(gameFrame(player(payload.i!)), payload.selector!, payload.text!, payload.timeout);
                return { ok: true };
            }
            case "gameText": {
                return await gameFrame(player(payload.i!))
                    .locator(payload.selector!)
                    .first()
                    .innerText();
            }
            case "gameClick": {
                await gameFrame(player(payload.i!))
                    .locator(payload.selector!)
                    .first()
                    .click({ timeout: 20_000 });
                return { ok: true };
            }
            case "gameFill": {
                await gameFrame(player(payload.i!)).locator(payload.selector!).fill(payload.value!);
                return { ok: true };
            }
            case "gameCount": {
                return await gameFrame(player(payload.i!)).locator(payload.selector!).count();
            }

            // --------------------------------------------------------- misc
            case "closeAll": {
                const players = getPlayers(sessionId);
                await Promise.allSettled(
                    players.map(({ context }) => context.close().catch(() => undefined)),
                );
                playersBySession.delete(sessionId);
                mockStore.clear();
                return { ok: true };
            }
            case "clearAppState": {
                // Clear the app's cookies (e.g. lastPartyState, which makes
                // the app skip the name-entry screen for returning players).
                try {
                    await vitestContext.clearCookies({ domain: "localhost" });
                } catch {
                    /* ignore */
                }
                return { ok: true };
            }
            default:
                throw new Error(`Unknown rocketcrab command op: ${String(op)}`);
        }
    },
);
