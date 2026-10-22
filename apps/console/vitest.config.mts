import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Inline (empty) PostCSS config, so Vite does not load the app's Tailwind
  // pipeline, which is Next-only and irrelevant to these unit tests.
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Pure lib functions. The few that touch the DOM opt into jsdom per file.
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
