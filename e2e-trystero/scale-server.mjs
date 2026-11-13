import { defineConfig } from "vite";
import { WebSocketServer, WebSocket } from "ws";

// Test relay: dropping publishes prevents new peer negotiations without closing
// established data channels. This is not the production signaling server.
export default defineConfig({
  resolve: {
    alias: {
      "@trystero-p2p/ws-relay": new URL("./src/scale-transport-shim.js", import.meta.url).pathname,
    },
  },
  plugins: [
    {
      name: "scale-proof-relay",
      configureServer(server) {
        let blocked = false;
        let dropped = 0;
        const clients = new Map();
        const wss = new WebSocketServer({ noServer: true });
        server.middlewares.use("/control", (req, res) => {
          if (req.method === "POST") {
            blocked = req.url !== "/reset";
            if (!blocked) dropped = 0;
          }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ blocked, dropped }));
        });
        server.httpServer.on("upgrade", (req, socket, head) => {
          if (req.url !== "/signal") return;
          wss.handleUpgrade(req, socket, head, (ws) => {
            clients.set(ws, new Set());
            ws.on("message", (data) => {
              const message = JSON.parse(data.toString());
              if (message.type === "subscribe") clients.get(ws).add(message.topic);
              if (message.type === "unsubscribe") clients.get(ws).delete(message.topic);
              if (message.type === "publish") {
                if (blocked) {
                  dropped++;
                  return;
                }
                for (const [peer, topics] of clients) {
                  if (
                    peer !== ws &&
                    topics.has(message.topic) &&
                    peer.readyState === WebSocket.OPEN
                  )
                    peer.send(JSON.stringify({ topic: message.topic, payload: message.payload }));
                }
              }
            });
            ws.on("close", () => clients.delete(ws));
          });
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 5199, strictPort: true },
});
