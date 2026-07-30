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
            on: (event: string, handler: (s: typeof socket) => void) => {
                handler(socket);
            },
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
});
