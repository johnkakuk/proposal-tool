import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Runs Worker routes against the local Supabase stack (`pnpm db:start`).
export default defineConfig({
  resolve: { alias: { "cloudflare:workers": fileURLToPath(new URL("./test/stubs/cloudflare-workers.ts", import.meta.url)) } },
  test: {
    name: "api-integration",
    include: ["test/integration/**/*.test.ts"],
    globalSetup: ["test/integration/global-setup.ts"],
    testTimeout: 20_000,
    fileParallelism: false,
    // Transform the OAuth provider so the alias above applies to its import.
    server: { deps: { inline: ["@cloudflare/workers-oauth-provider"] } },
  },
});
