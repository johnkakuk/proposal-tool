import type { Env } from "./env.js";
import { serviceClient } from "./lib/supabase.js";

/** Cron jobs (SPEC §13). Schedules are defined in wrangler.jsonc. */
export async function handleScheduled(controller: ScheduledController, env: Env): Promise<void> {
  switch (controller.cron) {
    case "0 * * * *":
      // Phase 5: mark expired proposals, "expiring in 3 days" emails, daily digest at 07:00 owner time.
      return;
    case "0 10 * * *":
      await keepAlive(env);
      // Phase 6: heatmap rollup + raw-point cleanup. Phase 4: OTP cleanup.
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
