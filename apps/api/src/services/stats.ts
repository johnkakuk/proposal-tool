import { must, type ServiceContext } from "./context.js";
import { localTime } from "./notify.js";
import { getSettings } from "./settings.js";

/**
 * Dashboard stat row (SPEC §7.1). Periods are stated with each number so they read
 * unambiguously: sent / open rate over 30 days, win rate and time-to-sign over 90 days,
 * signed value for the current calendar month in the owner's timezone.
 */
export async function getDashboardStats(ctx: ServiceContext, now = new Date()) {
  const day = 86_400_000;
  const since90 = new Date(now.getTime() - 90 * day).toISOString();
  const [settings, rows] = await Promise.all([
    getSettings(ctx),
    ctx.db.from("proposals").select("id, status, sent_at, first_viewed_at, signed_at").eq("owner_id", ctx.ownerId).gte("sent_at", since90),
  ]);
  const proposals = must(rows, "load proposals") as { id: string; status: string; sent_at: string; first_viewed_at: string | null; signed_at: string | null }[];
  const within = (iso: string, days: number) => now.getTime() - Date.parse(iso) <= days * day;

  const sent30 = proposals.filter((p) => within(p.sent_at, 30));
  const signed90 = proposals.filter((p) => p.signed_at);
  const signMs = signed90.map((p) => Date.parse(p.signed_at!) - Date.parse(p.sent_at)).filter((ms) => ms >= 0);

  // Signed this month, in the owner's timezone
  const { date } = localTime(now, settings.timezone);
  const monthStartLocal = `${date.slice(0, 7)}-01`;
  const sigs = must(
    await ctx.db.from("signatures").select("consent_given_at, computed_totals").eq("owner_id", ctx.ownerId).gte("consent_given_at", new Date(now.getTime() - 32 * day).toISOString()),
    "load signatures",
  ) as { consent_given_at: string; computed_totals: { total: Record<string, number> } }[];
  const thisMonth = sigs.filter((s) => localTime(new Date(s.consent_given_at), settings.timezone).date >= monthStartLocal);
  const sum = (k: string) => thisMonth.reduce((a, s) => a + (s.computed_totals?.total?.[k] ?? 0), 0);

  return {
    sentLast30: sent30.length,
    openRate30: sent30.length ? sent30.filter((p) => p.first_viewed_at).length / sent30.length : null,
    winRate90: proposals.length ? signed90.length / proposals.length : null,
    signedThisMonth: { count: thisMonth.length, oneTimeCents: sum("one_time"), monthlyCents: sum("monthly"), quarterlyCents: sum("quarterly"), yearlyCents: sum("yearly") },
    avgTimeToSignMs: signMs.length ? Math.round(signMs.reduce((a, b) => a + b, 0) / signMs.length) : null,
  };
}
