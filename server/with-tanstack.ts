/**
 * ARCH-01: TanStack Start + Express + Socket.IO Integration Proof
 *
 * This file demonstrates the preferred architecture: one Node process, one HTTP
 * server, with Express handling API/Socket.IO and TanStack Start handling web
 * routes.
 *
 * This is not the primary entry point yet. Run with:
 *   NODE_ENV=production node --experimental-strip-types server/with-tanstack.ts
 *
 * Architecture:
 *   1. Express creates the HTTP server
 *   2. Socket.IO attaches to the same port
 *   3. Express API routes (/api/*, /transfer/*) are registered first
 *   4. TanStack Start handles all other web routes (SSR + client)
 *   5. Single `node server/with-tanstack.ts` start command
 */
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import attachAPIHandlers from "./api.ts";
import attachSocketHandlers from "./socket.ts";
import { initRocketCrab } from "./rocketcrab.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || 3000;
const dev = process.env.NODE_ENV !== "production";

const TSR_SERVER_ENTRY = join(__dirname, "../dist/server/server.mjs");
const TSR_CLIENT_DIR = join(__dirname, "../dist/client");

async function main() {
    const app = express();
    app.use(express.json());

    const http = createServer(app);
    const io = new Server(http);

    const rocketCrab = initRocketCrab(dev);
    attachAPIHandlers(app, rocketCrab);
    attachSocketHandlers(io, rocketCrab);

    if (!dev) {
        // --- Production: TanStack Start handles web routes ---
        console.log("[ARCH-01] Loading TanStack Start handler...");
        const tsrModule = await import(TSR_SERVER_ENTRY);
        const tsrHandler = tsrModule.default;

        // Serve static client assets
        app.use("/assets", express.static(join(TSR_CLIENT_DIR, "assets")));

        // TanStack Start handles every request that isn't an API/transfer route
        app.use(async (req, res, next) => {
            // Skip routes handled by Express
            if (
                req.path.startsWith("/api/") ||
                req.path.startsWith("/transfer/")
            ) {
                return next();
            }

            try {
                // Build a Web API Request from the Express request
                const protocol = req.headers["x-forwarded-proto"] || "http";
                const host = req.headers.host || "localhost";
                const url = new URL(
                    req.originalUrl || req.url,
                    `${protocol}://${host}`,
                );

                const headers = new Headers();
                for (const [key, value] of Object.entries(req.headers)) {
                    if (value != null) {
                        if (Array.isArray(value)) {
                            value.forEach((v) => headers.append(key, v));
                        } else {
                            headers.set(key, String(value));
                        }
                    }
                }

                let body: BodyInit | undefined;
                if (req.method !== "GET" && req.method !== "HEAD") {
                    body = JSON.stringify(req.body);
                    headers.set("content-type", "application/json");
                }

                const webRequest = new Request(url.toString(), {
                    method: req.method,
                    headers,
                    body,
                });

                const webResponse = await tsrHandler.fetch(webRequest);

                // Copy status
                res.status(webResponse.status);

                // Copy headers
                webResponse.headers.forEach((value, key) => {
                    res.setHeader(key, value);
                });

                // Send body
                const responseBody = await webResponse.text();
                res.send(responseBody);
            } catch (err) {
                console.error("[ARCH-01] TanStack Start handler error:", err);
                next(err);
            }
        });
    } else {
        // --- Dev: placeholder — will use TanStack Start Vite dev proxy later ---
        app.use((_req, res) => {
            res.status(200).json({
                message:
                    "ARCH-01 spike: Dev mode — replace with Vite dev server proxy",
            });
        });
    }

    await new Promise<void>((resolve) => http.listen(port, resolve));

    console.log(`[ARCH-01] Ready on http://localhost:${port}`);
    console.log(`[ARCH-01] Mode: ${dev ? "development" : "production"}`);
    console.log(`[ARCH-01] Express API: /api/new, /api/new-public, /api/stats`);
    console.log(`[ARCH-01] Transfer: /transfer/:gameid/:uuid?`);
    console.log(`[ARCH-01] Web routes: TanStack Start SSR (production)`);
}

main().catch((err) => {
    console.error("[ARCH-01] Failed to start:", err);
    process.exit(1);
});
