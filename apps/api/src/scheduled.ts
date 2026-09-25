import type { Env } from "./env.js";
import { serviceClient } from "./lib/supabase.js";
import { retryPendingSignedPdfs } from "./services/afterSigning.js";

/** Cron jobs (SPEC §13). Schedules are defined in wrangler.jsonc. */
export async function handleScheduled(controller: ScheduledController, env: Env): Promise<void> {
  switch (controller.cron) {
    case "0 * * * *":
      await retryPendingSignedPdfs(env, serviceClient(env));
      // Phase 5: mark expired proposals, "expiring in 3 days" emails, daily digest at 07:00 owner time.
      return;
    case "0 10 * * *":
      await keepAlive(env);
      await serviceClient(env).from("otp_codes").delete().lt("expires_at", new Date(Date.now() - 86_400_000).toISOString());
      // Phase 6: heatmap rollup + raw-point cleanup.
      return;
    default:
      console.warn(`Unknown cron: ${controller.cron}`);
  }
}

/** A trivial query so the free-tier Supabase project isn't paused for inactivity. */
async function keepAlive(env: Env): Promise<void> {
  const { error } = await serviceClient(env).from("settings").select("id").limit(1);
  if (error) console.error("Supabase keep-alive failed", error.message);
}
