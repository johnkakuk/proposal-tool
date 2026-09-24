import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "apps/web",
      "apps/api",
      { test: { name: "db", include: ["supabase/tests/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 } },
    ],
  },
});
