// Test-only, in-memory signaling and tunnel. Not a production relay.
import { WebSocketServer, WebSocket } from "ws";

export function fallbackServer() {
  return {
    name: "fallback-fixture-server",
    configureServer(server) {
      const sockets = new WebSocketServer({ noServer: true });
      const subscriptions = new Map();
      const pairs = new Map();
      server.httpServer.on("upgrade", (request, socket, head) => {
        if (!request.url.startsWith("/fixture-ws/")) return;
        sockets.handleUpgrade(request, socket, head, (ws) => {
          if (request.url === "/fixture-ws/signal") {
            subscriptions.set(ws, new Set());
            ws.on("message", (data) => {
              const message = JSON.parse(data.toString());
              const topics = subscriptions.get(ws);
              if (message.type === "subscribe") topics.add(message.topic);
              if (message.type === "unsubscribe") topics.delete(message.topic);
              if (message.type === "publish") {
                for (const [other, otherTopics] of subscriptions) {
                  if (
                    other !== ws &&
                    otherTopics.has(message.topic) &&
                    other.readyState === WebSocket.OPEN
                  ) {
                    other.send(JSON.stringify({ topic: message.topic, payload: message.payload }));
                  }
                }
              }
            });
            ws.on("close", () => subscriptions.delete(ws));
            return;
          }
          const key = request.url;
          const pair = pairs.get(key) ?? [];
          if (pair.length >= 2) return ws.close();
          pair.push(ws);
          pairs.set(key, pair);
          if (pair.length === 2) pair.forEach((peer) => peer.send("ready"));
          ws.on("message", (data, isBinary) => {
            const other = pair.find((peer) => peer !== ws);
            if (other?.readyState === WebSocket.OPEN) other.send(data, { binary: isBinary });
          });
          ws.on("close", () => {
            pairs.delete(key);
            pair.forEach((peer) => {
              if (peer !== ws) peer.close();
            });
          });
        });
      });
    },
  };
}
