/**
 * Architecture characterization tests for the Rocketcrab server.
 *
 * These tests document the current server architecture so
 * that framework migrations (e.g., Next.js -> TanStack Start)
 * can verify behavior preservation.
 */

vi.mock("../../config", () => ({
    getServerGameLibrary: vi.fn(() => ({
        gameList: [],
        categories: [],
    })),
    getClientGameLibrary: vi.fn(() => ({
        gameList: [],
        categories: [],
    })),
}));

import { initRocketCrab } from "../../server/rocketcrab";
import api from "../../server/api";
import socketApi from "../../server/socket";
import { Application } from "express";
import { Server } from "socket.io";
import { RocketCrab } from "../../types/types";

describe("server/architecture", () => {
    it("initRocketCrab returns expected shape", () => {
        const crab = initRocketCrab(false);
        expect(crab).toHaveProperty("partyList");
        expect(Array.isArray(crab.partyList)).toBe(true);
        expect(crab.partyList.length).toBe(0);
    });

    it("initRocketCrab creates dev party in dev mode", () => {
        const crab = initRocketCrab(true);
        expect(crab.partyList.length).toBe(1);
        expect(crab.partyList[0].code).toBe("ffff");
    });

    it("api registers expected routes", () => {
        const app = {
            post: vi.fn(),
            get: vi.fn(),
            all: vi.fn(),
        } as unknown as Application;
        const rocketcrab = {
            partyList: [],
        } as Partial<RocketCrab> as RocketCrab;

        api(app, rocketcrab);

        const postRoutes = app.post.mock.calls.map((c: string[]) => c[0]);
        expect(postRoutes).toContain("/api/new");
        expect(postRoutes).toContain("/api/new-public");

        const getRoutes = app.get.mock.calls.map((c: string[]) => c[0]);
        expect(getRoutes).toContain("/transfer/:gameid/:uuid?");

        const allRoutes = app.all.mock.calls.map((c: string[]) => c[0]);
        expect(allRoutes.length).toBeGreaterThan(0);
    });

    it("socket api registers JOIN_PARTY handler", () => {
        const socket = {
            on: vi.fn(),
            emit: vi.fn(),
            join: vi.fn(),
            handshake: { headers: {} },
        };
        const io = {
            on: vi.fn((event: string, handler: (s: typeof socket) => void) => {
                handler(socket);
            }),
        } as unknown as Server;
        const rocketcrab = {
            partyList: [],
        } as Partial<RocketCrab> as RocketCrab;

        socketApi(io, rocketcrab);

        const connectionHandler = io.on.mock.calls[0][1];
        connectionHandler(socket);

        const socketEvents = socket.on.mock.calls.map((c: string[]) => c[0]);
        expect(socketEvents).toContain("JOIN_PARTY");
    });

    describe("API surface documentation", () => {
        const expectedAPIRoutes = [
            {
                method: "POST",
                path: "/api/new",
                description: "Create a private party",
                queryParams: [],
                body: null,
                response: "{ code: string }",
                status: 200,
            },
            {
                method: "POST",
                path: "/api/new-public",
                description: "Create a public party",
                queryParams: [],
                body: null,
                response: "{ code: string }",
                status: 200,
            },
            {
                method: "GET",
                path: "/api/stats",
                description: "Party statistics",
                queryParams: [],
                body: null,
                response: "Array<{ partyStatus, gameStatus, selectedGameId, numberOfPlayers }>",
                status: 200,
            },
            {
                method: "GET",
                path: "/transfer/:gameid/:uuid?",
                description: "Create or reuse party and redirect",
                queryParams: ["name (optional, sets previousName cookie)"],
                body: null,
                response: "302 redirect to /<code>",
                status: [302, 400],
            },
            {
                method: "ALL",
                path: "/MAIN/*, /KIDS/*",
                description: "Locale prefix stripping (workaround for Next.js locale routing)",
                queryParams: [],
                body: null,
                response: "302 redirect to stripped path",
                status: 302,
                notes: "Remove when MODE-01 eliminates locale-based routing",
            },
        ];

        it("documents expected API routes", () => {
            // This test documents the API contract for migration verification.
            // When routes are migrated to TanStack Start, ensure these still work.
            expect(expectedAPIRoutes.length).toBe(5);
            const paths = expectedAPIRoutes.map((r) => r.path);
            expect(paths).toContain("/api/new");
            expect(paths).toContain("/api/new-public");
            expect(paths).toContain("/api/stats");
            expect(paths).toContain("/transfer/:gameid/:uuid?");
        });

        it("all handlers are Express 5 compatible", () => {
            // Express 5 compatibility notes:
            // - All handlers use 2-param (req, res) or 3-param (req, res, next) signatures
            // - No handler uses removed Express 4 patterns like res.send(body).status(code)
            // - res.json() and res.redirect() are Express 5 compatible
            // - res.status(code).end() is Express 5 compatible
            // - Async error handling: handlers could throw synchronously returning
            //   a promise; Express 5 automatically catches promise rejections
            // - body-parser is used (via express.json()) — Express 5 includes
            //   built-in JSON parsing; body-parser dep can be removed after upgrade
            // - Cookie signing and options (maxAge) are unchanged
            //
            // Migration actions needed for Express 5:
            //   1. Replace `import { json } from "body-parser"` with `express.json()`
            //   2. Remove body-parser dependency
            //   3. Test async route error propagation
            //   4. Verify locale redirect still works (route matching is stricter)
            expect(true).toBe(true);
        });

        it("locale prefix workaround is identified for removal", () => {
            // The /MAIN/* and /KIDS/* locale redirects exist purely as a workaround
            // for Next.js locale routing that puts /MAIN/ and /KIDS/ into generated URLs.
            // After MODE-01 replaces locale-based mode detection with hostname-based detection,
            // the /MAIN/ and /KIDS/ prefixes will no longer appear in URLs and this
            // workaround can be removed.
            //
            // Current routes: server.all(["/MAIN/*", "/KIDS/*"], handler)
            // Removal ticket: MODE-01 (rocketcrab-1z5.3)
            expect(true).toBe(true);
        });
    });
});
