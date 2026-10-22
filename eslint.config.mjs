import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.terraform/**",
      "**/.next/**",
      "**/playwright-report/**",
      "apps/api/src/db/types.ts",
      "apps/web/**",
      "apps/console/**",
      "packages/ui/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-console": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
  {
    // The API's records are "hot columns + jsonb" documents read through one generic
    // repository, so `any` is deliberate at that boundary (see apps/api/tsconfig.json).
    files: ["apps/api/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: ["apps/api/test/**", "apps/api/src/demo/**", "apps/api/src/cli.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["scripts/**", "db/**", "e2e/**", "**/*.config.*"],
    rules: { "no-console": "off" },
  }
);
