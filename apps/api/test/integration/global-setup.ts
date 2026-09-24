import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

/** Reads URLs and keys from `supabase status` so tests hit the running local stack. */
export default function setup(project: TestProject) {
  let status: Record<string, string>;
  try {
    const out = execFileSync("npx", ["supabase", "status", "-o", "json"], { cwd: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    status = JSON.parse(out.slice(out.indexOf("{")));
  } catch {
    throw new Error("Local Supabase isn't running. Start it with `pnpm db:start`.");
  }
  project.provide("supabase", {
    url: status.API_URL!,
    anonKey: status.ANON_KEY!,
    serviceRoleKey: status.SERVICE_ROLE_KEY!,
    jwtSecret: status.JWT_SECRET!,
  });
}

declare module "vitest" {
  export interface ProvidedContext {
    supabase: { url: string; anonKey: string; serviceRoleKey: string; jwtSecret: string };
  }
}
