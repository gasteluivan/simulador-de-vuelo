import { defineConfig } from "vite";
export default defineConfig({
  optimizeDeps: { include: ["@mediapipe/tasks-vision"] },
  root: "client",
  publicDir: "public",
  server: {
    proxy: {
      "/ws": { target: "ws://localhost:3001", ws: true },
      "/api": "http://localhost:3001",
      "/wasm": "http://localhost:3001",
    },
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
    rollupOptions: { output: { manualChunks: { three: ["three"] } } },
  },
});
