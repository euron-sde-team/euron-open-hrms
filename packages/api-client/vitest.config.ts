import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The client touches localStorage, location and the DOM (downloads), so the
    // tests run against jsdom. No network: requests go through a stub adapter.
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
});
