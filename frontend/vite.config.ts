import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // slušaj na svim interfejsima (LAN + tunel)
    allowedHosts: true, // dozvoli pristup preko tunela (trycloudflare/ngrok itd.)
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
      "/ws": { target: "ws://localhost:4000", ws: true },
    },
  },
});
