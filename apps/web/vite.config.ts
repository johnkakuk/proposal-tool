import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In production, Cloudflare Worker routes send these paths to the Worker and everything
// else to Pages (SPEC §2). Locally, Vite proxies the same paths to `wrangler dev`, so the
// app sees a single origin with no CORS.
const WORKER = "http://127.0.0.1:8787";
const workerPaths = ["/api", "/mcp", "/oauth", "/.well-known", "/t/"];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(workerPaths.map((p) => [p, { target: WORKER, changeOrigin: false }])),
  },
});
