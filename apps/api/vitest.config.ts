import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Integration tests need local Supabase: `pnpm test:integration`.
  test: { name: "api", include: ["test/**/*.test.ts"], exclude: [...configDefaults.exclude, "test/integration/**"] },
});
