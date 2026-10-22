import { defineConfig } from "vitest/config";

/**
 * Unit tests: pure logic, no database, no network. Integration tests (test/integration)
 * need Postgres and run from the repo root via vitest.integration.config.ts.
 */
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    setupFiles: ["./test/setup-env.ts"],
  },
});
