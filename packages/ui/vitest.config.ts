import { defineConfig } from "vitest/config";

export default defineConfig({
  // React 19's automatic runtime, so test files need no `import React`.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
