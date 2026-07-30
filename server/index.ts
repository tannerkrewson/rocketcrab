import next from "next";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

import attachAPIHandlers from "./api.ts";
import attachSocketHandlers from "./socket.ts";
import { initRocketCrab } from "./rocketcrab.ts";

const port = process.env.PORT || 3000;
const dev = process.env.NODE_ENV !== "production";

const nextApp = next({ dev });
const nextHandler = nextApp.getRequestHandler();

(async () => {
    await nextApp.prepare();

    const app: express.Application = express();
    app.use(express.json());

    const http = createServer(app);
    const io: Server = new Server(http);

    const rocketCrab = initRocketCrab(dev);

    attachAPIHandlers(app, rocketCrab);
    attachSocketHandlers(io, rocketCrab);

    app.use((req, res) => nextHandler(req, res));

    await http.listen(port);

    console.log(`> Ready on http://localhost:${port}`); // eslint-disable-line no-console
})();
