/**
 * TanStack Start + Express + Socket.IO Production Server
 *
 * One Node process, one HTTP server:
 *   1. Express handles /api/* and /transfer/* routes
 *   2. Socket.IO attaches to the same HTTP server
 *   3. TanStack Start (built by Vite) handles all other web routes
 *
 * Production:
 *   npm run build:app
 *   npm start
 *
 * Development:
 *   npm run dev (port 3000, with Vite HMR on port 3001)
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

const TSR_SERVER_ENTRY = join(__dirname, "../dist/server/server.js");
const TSR_CLIENT_DIR = join(__dirname, "../dist/client");

/**
 * Create a proxy request handler that forwards to the Vite dev server.
 * Used in development mode for TanStack Start HMR.
 */
function createViteDevProxy(vitePort: number) {
    return async (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction,
    ) => {
        // Skip API and transfer routes — those are handled by Express
        if (req.path.startsWith("/api/") || req.path.startsWith("/transfer/")) {
            return next();
        }

        const url = `http://localhost:${vitePort}${req.originalUrl || req.url}`;

        try {
            const proxyRes = await fetch(url, {
                method: req.method,
                headers: req.headers as Record<string, string>,
                body:
                    req.method !== "GET" && req.method !== "HEAD"
                        ? JSON.stringify(req.body)
                        : undefined,
            });

            res.status(proxyRes.status);
            proxyRes.headers.forEach((value, key) => {
                res.setHeader(key, value);
            });

            // Preserve the upstream response bytes. Using `text()` here
            // corrupts fonts, images, and other binary Vite assets while
            // proxying them through Express.
            const body = Buffer.from(await proxyRes.arrayBuffer());
            res.send(body);
        } catch (err) {
            console.warn(
                `[Vite proxy] Failed to proxy to ${url}:`,
                (err as Error).message,
            );
            res.status(502).send(
                "Vite dev server not available. Run `npm run dev` in another terminal.",
            );
        }
    };
}

async function main() {
    const app = express();
    app.use(express.json());

    const nodeHttpServer = createServer(app);
    const io = new Server(nodeHttpServer);

    const rocketCrab = initRocketCrab(dev);
    attachAPIHandlers(app, rocketCrab);
    attachSocketHandlers(io, rocketCrab);

    if (!dev) {
        // --- Production: TanStack Start handles web routes ---
        console.log("Loading TanStack Start handler...");
        const tsrModule = await import(TSR_SERVER_ENTRY);
        const tsrHandler = tsrModule.default;

        // Serve static client assets (hashed filenames from Vite build)
        app.use("/assets", express.static(join(TSR_CLIENT_DIR, "assets")));

        // Serve PWA-specific root-level files (service worker, manifest, icons)
        app.use("/sw.js", express.static(join(TSR_CLIENT_DIR, "sw.js")));
        app.use(
            "/manifest.webmanifest",
            express.static(join(TSR_CLIENT_DIR, "manifest.webmanifest")),
        );

        // TanStack Start catch-all for non-API routes
        app.use(async (req, res, next) => {
            if (
                req.path.startsWith("/api/") ||
                req.path.startsWith("/transfer/")
            ) {
                return next();
            }

            try {
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
                res.status(webResponse.status);
                webResponse.headers.forEach((value, key) => {
                    res.setHeader(key, value);
                });
                const responseBody = await webResponse.text();
                res.send(responseBody);
            } catch (err) {
                console.error("TanStack Start handler error:", err);
                next(err);
            }
        });
    } else {
        // --- Development: Proxy to Vite dev server ---
        console.log(
            "Development mode: proxying to Vite dev server on port 3001",
        );
        app.use(createViteDevProxy(3001));
    }

    await new Promise<void>((resolve) => nodeHttpServer.listen(port, resolve));

    console.log(`Rocketcrab ready on http://localhost:${port}`);
    console.log(`Mode: ${dev ? "development" : "production"}`);
    console.log(`Express API: /api/new, /api/new-public, /api/stats`);
    console.log(`Transfer: /transfer/:gameid/:uuid?`);
    if (dev) {
        console.log(`Web routes: Vite dev server at http://localhost:3001`);
    } else {
        console.log(`Web routes: TanStack Start SSR`);
    }
}

main().catch((err) => {
    console.error("Failed to start:", err);
    process.exit(1);
});
