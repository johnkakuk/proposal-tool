import { defineConfig } from "vitest/config";

// Runs Worker routes against the local Supabase stack (`pnpm db:start`).
export default defineConfig({
  test: {
    name: "api-integration",
    include: ["test/integration/**/*.test.ts"],
    globalSetup: ["test/integration/global-setup.ts"],
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
