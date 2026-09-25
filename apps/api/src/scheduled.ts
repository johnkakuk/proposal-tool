import type { Env } from "./env.js";
import { serviceClient } from "./lib/supabase.js";
import { retryPendingSignedPdfs } from "./services/afterSigning.js";
import { expireProposals, remindExpiringSoon, sendDailyDigests } from "./services/notify.js";

/** Cron jobs (SPEC §13). Schedules are defined in wrangler.jsonc. Each job is isolated so one failure doesn't stop the rest. */
export async function handleScheduled(controller: ScheduledController, env: Env): Promise<void> {
  const db = serviceClient(env);
  const run = async (name: string, job: () => Promise<unknown>) => {
    try {
      await job();
    } catch (e) {
      console.error(`Cron job "${name}" failed:`, e);
    }
  };
  switch (controller.cron) {
    case "0 * * * *":
      await run("expire proposals", () => expireProposals(env, db));
      await run("expiring soon", () => remindExpiringSoon(env, db));
      // Runs hourly; sends only at 07:00 in the owner's timezone (DST-safe).
      await run("daily digest", () => sendDailyDigests(env, db));
      await run("retry signed PDFs", () => retryPendingSignedPdfs(env, db));
      return;
    case "0 10 * * *":
      // 10:00 UTC ≈ 03:00 Pacific.
      await run("keep-alive", async () => {
        const { error } = await db.from("settings").select("id").limit(1);
        if (error) throw new Error(error.message);
      });
      await run("otp cleanup", async () => {
        await db.from("otp_codes").delete().lt("expires_at", new Date(Date.now() - 86_400_000).toISOString());
      });
      // Phase 6: heatmap rollup + raw-point cleanup.
      return;
    default:
      console.warn(`Unknown cron: ${controller.cron}`);
  }
}
