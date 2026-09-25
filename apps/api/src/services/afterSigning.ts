import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { onPdfFailed, onSigned } from "./notify.js";
import { MAX_PDF_ATTEMPTS, attemptSignedPdf, toBase64 } from "./pdf.js";

/**
 * Background work after a signature (SPEC §8.2 step 6): render and store the signed PDF,
 * then email the signer their copy and send John the signed summary. If the PDF can't
 * be made, the hourly cron retries; after the last attempt John is told (SPEC §12).
 */
export async function afterSigning(env: Env, db: SupabaseClient, signatureId: string): Promise<void> {
  const result = await attemptSignedPdf(env, db, signatureId);
  if (result.ok) await sendSignedEmails(env, db, signatureId);
  else if (result.attempts >= MAX_PDF_ATTEMPTS) await onPdfFailed(env, db, signatureId);
}

export async function sendSignedEmails(env: Env, db: SupabaseClient, signatureId: string): Promise<void> {
  const { data: sig } = await db.from("signatures").select("pdf_path").eq("id", signatureId).single();
  let bytes: Uint8Array | null = null;
  if (sig?.pdf_path) {
    const { data: file } = await db.storage.from("signed-pdfs").download(sig.pdf_path as string);
    bytes = file ? new Uint8Array(await file.arrayBuffer()) : null;
  }
  await onSigned(env, db, signatureId, { bytes, base64: bytes ? toBase64(bytes) : null });
}

/** Hourly cron: retry signed PDFs that failed (rate limits, transient errors), then send the emails. */
export async function retryPendingSignedPdfs(env: Env, db: SupabaseClient): Promise<void> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data } = await db.from("signatures").select("id").is("pdf_path", null).gte("created_at", since).order("created_at").limit(3);
  for (const s of data ?? []) await afterSigning(env, db, s.id as string);
}
