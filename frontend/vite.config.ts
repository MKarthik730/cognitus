import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8001",
      "/ws": {
        target: "ws://localhost:8001",
        ws: true,
      },
    },
  },
});
