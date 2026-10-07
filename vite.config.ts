import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  build: { chunkSizeWarningLimit: 1500 },
  worker: { format: "es" },
  test: { include: ["tests/**/*.test.ts"] },
});
