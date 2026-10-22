import { defineConfig } from "vitest/config";

/**
 * Integration tests: the real API in-process against a real Postgres.
 *
 *   TEST_DATABASE_URL=postgres://hrms:hrms@localhost:5442/hrms_test pnpm test:integration
 *
 * The global setup migrates the database once and refuses anything that does not look
 * like a disposable test database. Files share that database, so they run one at a time;
 * each one truncates and seeds the state it needs.
 *
 * The same suite runs under every runtime option (storage, mail and key backends):
 * see scripts/test-matrix.sh.
 */
export default defineConfig({
  test: {
    include: ["apps/api/test/integration/**/*.int.test.ts"],
    globalSetup: ["apps/api/test/integration/global-setup.ts"],
    setupFiles: ["apps/api/test/integration/env.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
