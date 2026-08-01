// Local wss echo server for the spike's WebSocket capability test. The public
// echo service (echo.websocket.events) was unreachable from this network
// (DNS ENOTFOUND), so we run our own on port 5276 with the spike certs.
// SPIKE only.
import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const here = path.dirname(fileURLToPath(import.meta.url));
const cert = readFileSync(path.resolve(here, "../certs/cert.pem"));
const key = readFileSync(path.resolve(here, "../certs/key.pem"));

const server = createServer({ cert, key });
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.on("message", (data, isBinary) => {
    // echo back preserving text/binary framing so the client sees a string
    // for text payloads, not a Blob
    ws.send(data, { binary: isBinary });
  });
});

server.listen(5276, "0.0.0.0", () => {
  console.log("[echo-server] wss echo listening on https://localhost:5276");
});
