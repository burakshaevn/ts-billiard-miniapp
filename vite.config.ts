import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  // Relative base keeps the build working at a domain root and inside a
  // GitHub Pages project path (https://user.github.io/repository/).
  base: process.env.VITE_BASE || "./",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    allowedHosts: [".e2b.app"],
    proxy: {
      "/ws": { target: "ws://127.0.0.1:3001", ws: true },
      "/api": "http://127.0.0.1:3001",
    },
  },
});
