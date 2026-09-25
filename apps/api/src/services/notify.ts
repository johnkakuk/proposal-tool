import {
  BrandSchema,
  NotificationPrefsSchema,
  defaultNotificationPrefs,
  formatCents,
  type Brand,
  type NotificationPrefs,
  type OwnerNotificationType,
  type PricingResult,
  type SignatureSnapshot,
} from "@bridger/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as T from "../emails/templates.js";
import type { EmailContent } from "../emails/layout.js";
import type { Env } from "../env.js";
import { sendEmail, type OutgoingEmail } from "../lib/email.js";

/**
 * Notification rules (SPEC §9, §13). Owner emails go to OWNER_EMAIL and respect the
 * per-type switches in settings.notification_prefs; client emails (sent copy, OTP,
 * signed copy) are transactional and always go. `dedupeKey` makes each email fire once.
 */

export interface OwnerContext {
  ownerId: string;
  brand: Brand | null;
  prefs: NotificationPrefs;
  timezone: string;
}

export async function ownerContext(db: SupabaseClient, ownerId: string): Promise<OwnerContext> {
  const { data } = await db.from("settings").select("brand, notification_prefs, timezone").eq("owner_id", ownerId).maybeSingle();
  const brand = BrandSchema.safeParse(data?.brand);
  const prefs = NotificationPrefsSchema.safeParse({ ...defaultNotificationPrefs(), ...(data?.notification_prefs ?? {}) });
  return { ownerId, brand: brand.success ? brand.data : null, prefs: prefs.success ? prefs.data : defaultNotificationPrefs(), timezone: data?.timezone ?? "America/Los_Angeles" };
}

interface ProposalInfo {
  id: string;
  owner_id: string;
  slug: string;
  title: string;
  status: string;
  expires_at: string | null;
  client: { name: string; company: string | null; email: string | null } | null;
}

export async function proposalInfo(db: SupabaseClient, id: string): Promise<ProposalInfo | null> {
  const { data } = await db.from("proposals").select("id, owner_id, slug, title, status, expires_at, client:clients(name, company, email)").eq("id", id).maybeSingle();
  return data as unknown as ProposalInfo | null;
}

const clientName = (p: ProposalInfo) => (p.client ? (p.client.company ?? p.client.name) : "Your client");
const base = (env: Env) => env.APP_URL.replace(/\/$/, "");
export const editorUrl = (env: Env, id: string) => `${base(env)}/app/proposals/${id}`;
export const publicUrl = (env: Env, slug: string) => `${base(env)}/p/${slug}`;

/** Sends an owner notification if its type is switched on. Returns whether an email went out. */
export async function notifyOwner(
  env: Env,
  db: SupabaseClient,
  owner: OwnerContext,
  type: OwnerNotificationType | "pdf_failed",
  content: EmailContent,
  opts: { proposalId?: string; dedupeKey?: string; attachments?: OutgoingEmail["attachments"] } = {},
): Promise<boolean> {
  if (type !== "pdf_failed" && !owner.prefs[type]) return false;
  const r = await sendEmail(env, db, { ownerId: owner.ownerId, to: env.OWNER_EMAIL, template: type, ...content, ...opts });
  return r.ok && !r.skipped;
}

// ---------------------------------------------------------------------------
// Event-driven notifications
// ---------------------------------------------------------------------------

/** Signed: signed copy to the signer (always) + the invoicing summary to John. */
export async function onSigned(env: Env, db: SupabaseClient, signatureId: string, pdf: { bytes: Uint8Array | null; base64: string | null }): Promise<void> {
  const { data: sig } = await db
    .from("signatures")
    .select("id, owner_id, proposal_id, signer_name, signer_email, signer_title, signer_company, certificate_id, snapshot, computed_totals")
    .eq("id", signatureId)
    .single();
  if (!sig) return;
  const p = await proposalInfo(db, sig.proposal_id as string);
  if (!p) return;
  const owner = await ownerContext(db, p.owner_id);
  const snapshot = sig.snapshot as SignatureSnapshot;
  const certificateUrl = `${publicUrl(env, p.slug)}/certificate`;
  const pdfUrl = `${base(env)}/api/public/proposals/${p.slug}/signed.pdf`;
  // Attach when reasonably small; otherwise link (SPEC §9).
  const attach = pdf.base64 && pdf.bytes && pdf.bytes.length < 8_000_000 ? [{ filename: `${p.title} - signed.pdf`.replace(/[\\/:*?"<>|]+/g, "-"), contentBase64: pdf.base64 }] : undefined;

  await sendEmail(env, db, {
    ownerId: p.owner_id,
    proposalId: p.id,
    to: sig.signer_email as string,
    template: "signed_copy",
    replyTo: env.OWNER_EMAIL,
    dedupeKey: `signed_copy:${signatureId}`,
    attachments: attach,
    ...T.signedCopy({ brand: owner.brand, title: p.title, certificateId: sig.certificate_id as string, certificateUrl, publicUrl: publicUrl(env, p.slug), attached: Boolean(attach) }),
  });

  await notifyOwner(
    env,
    db,
    owner,
    "signed",
    T.ownerSigned({
      brand: owner.brand,
      title: p.title,
      client: (sig.signer_company as string | null) ?? clientName(p),
      signer: { name: sig.signer_name as string, title: sig.signer_title as string | null, email: sig.signer_email as string, company: sig.signer_company as string | null },
      totals: sig.computed_totals as PricingResult,
      sectionTitles: Object.fromEntries(snapshot.pricing.sections.map((s) => [s.id, s.title])),
      pdfUrl,
      certificateUrl,
      certificateId: sig.certificate_id as string,
      editorUrl: editorUrl(env, p.id),
    }),
    { proposalId: p.id, dedupeKey: `owner_signed:${signatureId}`, attachments: attach },
  );
}

export async function onDeclined(env: Env, db: SupabaseClient, proposalId: string, reason: string | null): Promise<void> {
  const p = await proposalInfo(db, proposalId);
  if (!p) return;
  const owner = await ownerContext(db, p.owner_id);
  await notifyOwner(env, db, owner, "declined", T.ownerDeclined({ brand: owner.brand, title: p.title, client: clientName(p), reason, editorUrl: editorUrl(env, p.id) }), {
    proposalId: p.id,
    dedupeKey: `declined:${p.id}`,
  });
}

export async function onExtensionRequested(env: Env, db: SupabaseClient, proposalId: string, message: string | null): Promise<void> {
  const p = await proposalInfo(db, proposalId);
  if (!p) return;
  const owner = await ownerContext(db, p.owner_id);
  // At most one per proposal per day, however many times the client clicks.
  await notifyOwner(env, db, owner, "extension_requested", T.extensionRequested({ brand: owner.brand, title: p.title, client: clientName(p), message, editorUrl: editorUrl(env, p.id) }), {
    proposalId: p.id,
    dedupeKey: `extension_requested:${p.id}:${new Date().toISOString().slice(0, 10)}`,
  });
}

export async function onPdfFailed(env: Env, db: SupabaseClient, signatureId: string): Promise<void> {
  const { data: sig } = await db.from("signatures").select("proposal_id").eq("id", signatureId).single();
  const p = sig ? await proposalInfo(db, sig.proposal_id as string) : null;
  if (!p) return;
  const owner = await ownerContext(db, p.owner_id);
  await notifyOwner(env, db, owner, "pdf_failed", T.pdfFailed({ brand: owner.brand, title: p.title, client: clientName(p), editorUrl: editorUrl(env, p.id) }), {
    proposalId: p.id,
    dedupeKey: `pdf_failed:${signatureId}`,
  });
}

export const FIRST_VIEW_ACTIVE_MS = 5_000;
export const RETURN_GAP_MS = 12 * 3_600_000;

/**
 * View notifications (SPEC §9), called by tracking ingest (Phase 6) for real
 * (non-owner, non-bot) sessions only.
 *  - first view: the first session to reach 5 s of active time — once per proposal, ever
 *  - return visit: a new session starting 12+ h after the previous one ended — at most
 *    one email per proposal per 12 h
 */
export async function onViewActivity(
  env: Env,
  db: SupabaseClient,
  view: { proposalId: string; activeMs: number; sessionStart: string; previousSessionEnd: string | null; visitNumber: number; device?: string; where?: string },
): Promise<void> {
  const p = await proposalInfo(db, view.proposalId);
  if (!p) return;
  const owner = await ownerContext(db, p.owner_id);
  const common = { brand: owner.brand, title: p.title, client: clientName(p), editorUrl: editorUrl(env, p.id) };

  if (view.activeMs >= FIRST_VIEW_ACTIVE_MS) {
    await notifyOwner(env, db, owner, "first_view", T.firstView({ ...common, device: view.device, where: view.where }), { proposalId: p.id, dedupeKey: `first_view:${p.id}` });
  }
  if (view.previousSessionEnd) {
    const gap = Date.parse(view.sessionStart) - Date.parse(view.previousSessionEnd);
    if (gap >= RETURN_GAP_MS) {
      const window = Math.floor(Date.parse(view.sessionStart) / RETURN_GAP_MS);
      await notifyOwner(env, db, owner, "return_visit", T.returnVisit({ ...common, gapHours: gap / 3_600_000, visits: view.visitNumber }), {
        proposalId: p.id,
        dedupeKey: `return_visit:${p.id}:${window}`,
      });
    }
  }
}

export async function onAiDraftCreated(env: Env, db: SupabaseClient, proposalId: string, aiClient: string): Promise<void> {
  const p = await proposalInfo(db, proposalId);
  if (!p) return;
  const owner = await ownerContext(db, p.owner_id);
  await notifyOwner(env, db, owner, "ai_draft_created", T.aiDraftCreated({ brand: owner.brand, title: p.title, client: clientName(p), aiClient, editorUrl: editorUrl(env, p.id) }), {
    proposalId: p.id,
    dedupeKey: `ai_draft_created:${p.id}`,
  });
}

export async function onAiPublished(env: Env, db: SupabaseClient, proposalId: string, aiClient: string, version: number): Promise<void> {
  const p = await proposalInfo(db, proposalId);
  if (!p) return;
  const owner = await ownerContext(db, p.owner_id);
  await notifyOwner(
    env,
    db,
    owner,
    "ai_published",
    T.aiPublished({ brand: owner.brand, title: p.title, client: clientName(p), aiClient, publicUrl: publicUrl(env, p.slug), editorUrl: editorUrl(env, p.id) }),
    { proposalId: p.id, dedupeKey: `ai_published:${p.id}:v${version}` },
  );
}

// ---------------------------------------------------------------------------
// Scheduled (SPEC §13)
// ---------------------------------------------------------------------------

/** Hourly: mark proposals past expires_at as expired (audit + email). */
export async function expireProposals(env: Env, db: SupabaseClient, now = new Date()): Promise<string[]> {
  const { data } = await db
    .from("proposals")
    .update({ status: "expired" })
    .in("status", ["sent", "viewed"])
    .is("signed_at", null)
    .lte("expires_at", now.toISOString())
    .select("id, owner_id, expires_at");
  const expiredRows = (data ?? []) as { id: string; owner_id: string; expires_at: string }[];
  for (const r of expiredRows) {
    await db.from("audit_events").insert({ owner_id: r.owner_id, proposal_id: r.id, event_type: "expired", actor: "system", metadata: { expiresAt: r.expires_at } });
    const p = await proposalInfo(db, r.id);
    if (!p) continue;
    const owner = await ownerContext(db, r.owner_id);
    await notifyOwner(env, db, owner, "expired", T.expired({ brand: owner.brand, title: p.title, client: clientName(p), editorUrl: editorUrl(env, p.id) }), {
      proposalId: p.id,
      dedupeKey: `expired:${p.id}:${r.expires_at}`,
    });
  }
  return expiredRows.map((r) => r.id);
}

/** Hourly: "expires in 3 days" for unsigned proposals, once per expiry date. */
export async function remindExpiringSoon(env: Env, db: SupabaseClient, now = new Date()): Promise<number> {
  const until = new Date(now.getTime() + 3 * 86_400_000).toISOString();
  const { data } = await db.from("proposals").select("id, owner_id, expires_at").in("status", ["sent", "viewed"]).is("signed_at", null).gt("expires_at", now.toISOString()).lte("expires_at", until);
  let sent = 0;
  for (const r of (data ?? []) as { id: string; owner_id: string; expires_at: string }[]) {
    const p = await proposalInfo(db, r.id);
    if (!p) continue;
    const owner = await ownerContext(db, r.owner_id);
    const ok = await notifyOwner(env, db, owner, "expiring_soon", T.expiringSoon({ brand: owner.brand, title: p.title, client: clientName(p), expiresAt: r.expires_at, editorUrl: editorUrl(env, p.id), timezone: owner.timezone }), {
      proposalId: p.id,
      // Extending to a new date re-arms the reminder.
      dedupeKey: `expiring_soon:${p.id}:${r.expires_at}`,
    });
    if (ok) sent++;
  }
  return sent;
}

/** Local hour and date in a timezone, e.g. { hour: 7, date: "2026-09-25" }. */
export function localTime(now: Date, timeZone: string): { hour: number; date: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]),
  );
  return { hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}` };
}

/** Hourly check; sends the digest at 07:00 in the owner's timezone if enabled (default off). */
export async function sendDailyDigests(env: Env, db: SupabaseClient, now = new Date(), opts: { force?: boolean } = {}): Promise<number> {
  const { data: owners } = await db.from("settings").select("owner_id");
  let sent = 0;
  for (const { owner_id } of (owners ?? []) as { owner_id: string }[]) {
    const owner = await ownerContext(db, owner_id);
    if (!owner.prefs.daily_digest) continue;
    const local = localTime(now, owner.timezone);
    if (local.hour !== 7 && !opts.force) continue;

    const since = new Date(now.getTime() - 86_400_000).toISOString();
    const [sessions, signatures, expiring] = await Promise.all([
      db.from("view_sessions").select("proposal_id, proposal:proposals(id, title, client:clients(name, company))").eq("owner_id", owner_id).eq("is_owner", false).eq("is_bot", false).gte("session_start", since),
      db.from("signatures").select("proposal_id, signer_company, computed_totals, proposal:proposals(id, title, client:clients(name, company))").eq("owner_id", owner_id).gte("created_at", since),
      db
        .from("proposals")
        .select("id, title, expires_at, client:clients(name, company)")
        .eq("owner_id", owner_id)
        .in("status", ["sent", "viewed"])
        .gt("expires_at", now.toISOString())
        .lte("expires_at", new Date(now.getTime() + 3 * 86_400_000).toISOString()),
    ]);
    type P = { id: string; title: string; client: { name: string; company: string | null } | null };
    const nameOf = (p: P) => (p.client ? (p.client.company ?? p.client.name) : "No client");
    const views = new Map<string, { title: string; client: string; visits: number; editorUrl: string }>();
    for (const s of (sessions.data ?? []) as unknown as { proposal: P }[]) {
      const v = views.get(s.proposal.id) ?? { title: s.proposal.title, client: nameOf(s.proposal), visits: 0, editorUrl: editorUrl(env, s.proposal.id) };
      v.visits++;
      views.set(s.proposal.id, v);
    }
    const content = T.dailyDigest({
      brand: owner.brand,
      dateLabel: new Date(now).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: owner.timezone }),
      views: [...views.values()],
      signings: ((signatures.data ?? []) as unknown as { signer_company: string | null; computed_totals: PricingResult; proposal: P }[]).map((s) => ({
        title: s.proposal.title,
        client: s.signer_company ?? nameOf(s.proposal),
        total: Object.entries(s.computed_totals.total)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${formatCents(v)}${k === "one_time" ? "" : `/${k.replace("ly", "")}`}`)
          .join(" + ") || formatCents(0),
        editorUrl: editorUrl(env, s.proposal.id),
      })),
      expiring: ((expiring.data ?? []) as unknown as (P & { expires_at: string })[]).map((p) => ({
        title: p.title,
        client: nameOf(p),
        expiresOn: new Date(p.expires_at).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: owner.timezone }),
        editorUrl: editorUrl(env, p.id),
      })),
    });
    if (await notifyOwner(env, db, owner, "daily_digest", content, { dedupeKey: `daily_digest:${owner_id}:${local.date}` })) sent++;
  }
  return sent;
}
