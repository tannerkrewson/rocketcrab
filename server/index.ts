import next from "next";
import express from "express";
import { json } from "body-parser";
import { createServer } from "http";
import socketio from "socket.io";

import attachAPIHandlers from "./api";
import attachSocketHandlers from "./socket";
import { initRocketCrab } from "./rocketcrab";

const port = process.env.PORT || 3000;
const dev = process.env.NODE_ENV !== "production";

const nextApp = next({ dev });
const nextHandler = nextApp.getRequestHandler();

(async () => {
    await nextApp.prepare();

    const app = express();
    app.use(json());

    const http = createServer(app);
    const io = socketio(http);

    const rocketCrab = initRocketCrab();

    attachAPIHandlers(app, rocketCrab);
    attachSocketHandlers(io, rocketCrab);

    app.get("*", nextHandler);

    await http.listen(port);

    console.log(`> Ready on http://localhost:${port}`); // eslint-disable-line no-console
})();
