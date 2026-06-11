import express from "express";
import cors from "cors";
import http from "node:http";
import { config } from "./config.ts";
import { initSchema } from "./db.ts";
import { migrate } from "./migrate.ts";
import { seedDatabase } from "./seedData.ts";
import { api } from "./routes.ts";
import { initWebSocket } from "./ws.ts";
import { startWorkers } from "./workers.ts";
import { startBots } from "./bots.ts";

initSchema();
seedDatabase();
migrate(); // lagane migracije + backfill brojaca za postojece baze

const app = express();
// Iza proxy/tunela (Cloudflare) – da req.ip čita stvarni IP (za rate-limit po IP-u).
app.set("trust proxy", 1);
// CORS: ako je CORS_ORIGIN zadat -> ograniči na te domene; inače otvoreno (dev/tunnel).
app.use(cors(config.corsOrigin ? { origin: config.corsOrigin.split(",").map((s) => s.trim()) } : {}));
app.use(express.json());

// Dijagnostika "prekida veze": loguj svaki zahtev koji traje > 1s da vidimo sta koci.
app.use((req, res, next) => {
  const t0 = performance.now();
  res.on("finish", () => {
    const ms = performance.now() - t0;
    if (ms > 1000) console.warn(`[SLOW ${Math.round(ms)}ms] ${req.method} ${req.originalUrl} -> ${res.statusCode}`);
  });
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use("/api/v1/casino", api);

const server = http.createServer(app);
initWebSocket(server);
startWorkers();

server.listen(config.port, () => {
  console.log(`Casino Engine backend sluša na http://localhost:${config.port}`);
  console.log(`WebSocket (jackpotovi): ws://localhost:${config.port}/ws`);
  console.log(`Admin: ${config.adminUsername} / ${config.adminPassword}  |  Demo igrac: igrac1 / igrac123`);
  startBots();
});
