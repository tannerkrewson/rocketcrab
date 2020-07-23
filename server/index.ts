import next from "next";
import express, { RequestHandler } from "express";
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

    const app: express.Application = express();
    app.use(json());

    const http = createServer(app);
    const io: SocketIO.Server = socketio(http);

    const rocketCrab = initRocketCrab(dev);

    attachAPIHandlers(app, rocketCrab);
    attachSocketHandlers(io, rocketCrab);

    app.get("*", (nextHandler as unknown) as RequestHandler);

    await http.listen(port);

    console.log(`> Ready on http://localhost:${port}`); // eslint-disable-line no-console
})();
