import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:5180",
      "/health": "http://localhost:5180"
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"]
  }
});
