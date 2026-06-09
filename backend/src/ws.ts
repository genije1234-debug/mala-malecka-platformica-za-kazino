import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { listJackpots } from "./services/jackpot.ts";

let wss: WebSocketServer | null = null;

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    // Posalji trenutno stanje odmah po konekciji.
    ws.send(JSON.stringify({ type: "jackpots", data: listJackpots() }));
  });
}

export function broadcast(message: unknown): void {
  if (!wss) return;
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

export function broadcastJackpots(): void {
  broadcast({ type: "jackpots", data: listJackpots() });
}
