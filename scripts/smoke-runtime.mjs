import assert from "node:assert/strict";

// Creates one in-memory party. Run only against the explicitly approved target.
const base = process.argv[2];
if (!base) throw new Error("Usage: node scripts/smoke-runtime.mjs <base-url>");
const origin = new URL(base);
for (const path of ["/", "/join", "/library"]) {
    const response = await fetch(new URL(path, origin));
    assert.equal(response.status, 200, path);
    const html = await response.text();
    if (path === "/") {
        const asset = html.match(/src="([^" ]*\/_next\/static\/[^" ]+\.js)"/);
        assert(asset, "homepage script asset");
        const result = await fetch(new URL(asset[1], origin));
        assert.equal(result.status, 200, asset[1]);
        await result.arrayBuffer();
    }
    console.log(`HTTP ${path}: OK`);
}
const response = await fetch(new URL("/api/new", origin), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
});
assert.equal(response.status, 200);
const { code } = await response.json();
assert(code, "party code");
const party = await fetch(new URL(`/${code}`, origin));
assert.equal(party.status, 200);
await party.text();
console.log("Create party and render party page: OK");

const wsUrl = new URL("/socket.io/?EIO=4&transport=websocket", origin);
wsUrl.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
await new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => finish(new Error("WebSocket timeout")), 10000);
    function finish(error) {
        clearTimeout(timer);
        socket.close();
        if (error) reject(error);
        else resolve();
    }
    socket.addEventListener("error", () => finish(new Error("WebSocket error")));
    socket.addEventListener("message", ({ data }) => {
        if (typeof data !== "string") return;
        if (data.startsWith("0")) socket.send("40");
        else if (data.startsWith("40")) finish();
        else if (data === "2") socket.send("3");
    });
});
console.log("Engine.IO + Socket.IO WebSocket handshake: OK");
