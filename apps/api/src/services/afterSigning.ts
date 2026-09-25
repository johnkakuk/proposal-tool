import { formatCents } from "@bridger/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { escapeHtml, sendEmail } from "../lib/email.js";
import { attemptSignedPdf, toBase64 } from "./pdf.js";
import type { SignatureRow } from "./public.js";

/**
 * Background work after a signature (SPEC §8.2 step 6): render and store the signed PDF,
 * then email the signer their copy and notify John. Phase 5 replaces these plain emails
 * with the branded templates (including the QuickBooks checklist) and preference checks.
 */
export async function afterSigning(env: Env, db: SupabaseClient, signatureId: string): Promise<void> {
  const ok = await attemptSignedPdf(env, db, signatureId);
  if (!ok) return; // the hourly cron retries, then emails go out from there

  await sendSignedEmails(env, db, signatureId);
}

export async function sendSignedEmails(env: Env, db: SupabaseClient, signatureId: string): Promise<void> {
  const sig = (await db.from("signatures").select("*, proposal:proposals(owner_id, slug, title)").eq("id", signatureId).single()).data as
    | (SignatureRow & { owner_id: string; proposal_id: string; proposal: { owner_id: string; slug: string; title: string } })
    | null;
  if (!sig?.pdf_path) return;

  const { data: file } = await db.storage.from("signed-pdfs").download(sig.pdf_path);
  const bytes = file ? new Uint8Array(await file.arrayBuffer()) : null;
  const base = env.APP_URL.replace(/\/$/, "");
  const link = `${base}/p/${sig.proposal.slug}`;
  const certLink = `${link}/certificate`;
  const title = sig.proposal.title;
  const filename = `${title} - signed.pdf`.replace(/[\\/:*?"<>|]+/g, "-");
  // Attach when reasonably small; otherwise link (SPEC §9).
  const attach = bytes && bytes.length < 8_000_000 ? [{ filename, contentBase64: toBase64(bytes) }] : undefined;

  await sendEmail(env, db, {
    ownerId: sig.owner_id,
    proposalId: sig.proposal_id,
    to: sig.signer_email,
    template: "signed_copy",
    replyTo: env.OWNER_EMAIL,
    subject: `Your signed copy: ${title}`,
    text: `Thanks for signing "${title}". ${attach ? "Your signed copy is attached." : `Download your signed copy: ${link}`}\nCertificate ${sig.certificate_id}: ${certLink}`,
    html: `<p>Thanks for signing <strong>${escapeHtml(title)}</strong>.</p><p>${attach ? "Your signed copy is attached." : `<a href="${link}">Download your signed copy</a>.`}</p><p>Certificate <a href="${certLink}">${sig.certificate_id}</a></p>`,
    attachments: attach,
  });

  const totals = (sig.snapshot as { totals?: { total?: Record<string, number> } }).totals?.total ?? {};
  const lines = Object.entries(totals)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k.replace("_", "-")}: ${formatCents(v)}`)
    .join(", ");
  await sendEmail(env, db, {
    ownerId: sig.owner_id,
    proposalId: sig.proposal_id,
    to: env.OWNER_EMAIL,
    template: "owner_signed",
    subject: `✅ Signed: ${title} — ${sig.signer_company ?? sig.signer_name}`,
    text: `${sig.signer_name} (${sig.signer_email}) signed "${title}". Totals: ${lines || "—"}. Certificate ${sig.certificate_id}: ${certLink}`,
    html: `<p><strong>${escapeHtml(sig.signer_name)}</strong> (${escapeHtml(sig.signer_email)}) signed <strong>${escapeHtml(title)}</strong>.</p><p>Totals: ${escapeHtml(lines || "—")}</p><p><a href="${certLink}">Certificate ${sig.certificate_id}</a></p>`,
    attachments: attach,
  });
}

/** Hourly cron: retry signed PDFs that failed (rate limits, transient errors), then send the emails. */
export async function retryPendingSignedPdfs(env: Env, db: SupabaseClient): Promise<void> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data } = await db.from("signatures").select("id").is("pdf_path", null).gte("created_at", since).order("created_at").limit(3);
  for (const s of data ?? []) {
    if (await attemptSignedPdf(env, db, s.id as string)) await sendSignedEmails(env, db, s.id as string);
  }
}
