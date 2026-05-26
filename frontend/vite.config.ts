import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": "http://backend:8000",
      "/ws": {
        target: "ws://backend:8000",
        ws: true,
      },
    },
  },
});
