/**
 * Rocketcrab lobby user flows, end-to-end in real Chromium.
 *
 * - Creating a party from the home page (short code in the URL)
 * - Joining a party by code via /join
 * - Entering a username
 * - Lobby sync: players see each other, host designation, kick, leave
 * - Party chat
 * - Invalid party codes
 */
import { afterEach, describe, expect, it } from "vitest";
import { rc } from "./driver";
import { APP_URL } from "./constants";
import {
    createPartyAsHost,
    joinPartyAsPlayer,
    unmountHostApp,
} from "./helpers";

describe("party lobby flows", () => {
    afterEach(async () => {
        unmountHostApp();
        await rc({ op: "closeAll" });
    });

    it("host creates a party from the home page and enters a username", async () => {
        const code = await createPartyAsHost();

        expect(code).toMatch(/^[a-z]{4}$/);

        // The lobby shows the host's own name and the empty player list.
        await rc({ op: "hostWaitText", selector: "body", text: "Alice" });
        await rc({ op: "hostWaitText", selector: "body", text: "Get your friends to join!" });
        // First player in an empty party sees the welcome message.
        await rc({ op: "hostWaitText", selector: "body", text: "Welcome to Rocketcrab!" });
    });

    it("a player joins by code and both players see each other in the lobby", async () => {
        const code = await createPartyAsHost();

        const i = await joinPartyAsPlayer(code, "Bob");

        // Host's lobby now shows Bob.
        await rc({ op: "hostWaitText", selector: "body", text: "Bob" });
        // Bob's lobby shows Alice and the Host designation.
        await rc({ op: "waitText", i, selector: "body", text: "Alice" });
        await rc({ op: "waitText", i, selector: "body", text: "Host" });
        // Host sees the host label too (both lobbies render "Host" on Alice).
        await rc({ op: "hostWaitText", selector: "body", text: "Host" });
    });

    it("chat messages sync between players", async () => {
        const code = await createPartyAsHost();
        const i = await joinPartyAsPlayer(code, "Bob");

        // Host expands the chat box and sends a message.
        await rc({ op: "hostClick", selector: 'button:has-text("▼ Show")' });
        await rc({ op: "hostWaitFor", selector: "input", timeout: 10_000 });
        await rc({
            op: "hostFillSubmit",
            selector: 'input:not([type="checkbox"])',
            submitSelector: 'button:has-text("Send")',
            value: "hello party!",
        });
        await rc({ op: "hostClick", selector: 'button:has-text("Send")' });

        // Bob expands chat and sees the host's message, then replies.
        await rc({ op: "click", i, selector: 'button:has-text("▼ Show")' });
        await rc({ op: "waitText", i, selector: "body", text: "hello party!" });
        await rc({
            op: "fillSubmit",
            i,
            selector: 'input:not([type="checkbox"])',
            submitSelector: 'button:has-text("Send")',
            value: "hey alice!",
        });
        await rc({ op: "click", i, selector: 'button:has-text("Send")' });

        await rc({ op: "hostWaitText", selector: "body", text: "hey alice!" });
    });

    it("joining with an invalid code shows an error and returns to /join", async () => {
        const { index: i } = (await rc({ op: "open", url: `${APP_URL}/join` })) as {
            index: number;
        };
        await rc({ op: "joinByCode", i, value: "zzzz", url: `${APP_URL}/join` });

        await rc({ op: "waitText", i, selector: "body", text: "does not exist" });
        const url = (await rc({ op: "url", i })) as string;
        expect(url).toContain("/join?invalid=zzzz");
    });

    it("host can kick a player", async () => {
        const code = await createPartyAsHost();
        const i = await joinPartyAsPlayer(code, "Bob");

        // Host clicks the kick control on Bob's name box.
        await rc({ op: "hostClick", selector: 'div.absolute:has-text("❌")' });
        await rc({ op: "hostWaitText", selector: "body", text: "Kick Bob?" });
        await rc({ op: "hostClick", selector: 'button:has-text("Kick player")' });
        // "Ban as well?" modal — choose "Just kick" (no ban).
        await rc({ op: "hostWaitText", selector: "body", text: "Ban Bob as well?" });
        await rc({ op: "hostClick", selector: 'button:has-text("Just kick")' });
        // Host gets a success modal.
        await rc({ op: "hostWaitText", selector: "body", text: "Kicked!" });
        await rc({ op: "hostClick", selector: 'button:has-text("OK")' });

        // The kicked player is disconnected and redirected to the home page.
        await rc({ op: "waitText", i, selector: "body", text: "Start Party" });
    });

    it("host can leave the party", async () => {
        await createPartyAsHost();

        await rc({ op: "hostClick", selector: 'button:has-text("Leave Party")' });
        await rc({ op: "hostWaitText", selector: "body", text: "Are you sure?" });
        // Modal confirm — there are two "Leave Party" buttons now; pick the modal one.
        await rc({ op: "hostClick", selector: 'button:has-text("Leave Party") >> nth=-1' });
        await rc({ op: "hostWaitText", selector: "body", text: "Start Party" });
    });
});
