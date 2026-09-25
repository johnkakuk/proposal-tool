import puppeteer from "@cloudflare/puppeteer";
import { sha256Hex } from "@bridger/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { createRenderToken } from "../lib/renderToken.js";
import { must } from "./context.js";

/**
 * PDFs via Cloudflare Browser Rendering (SPEC §12). The browser loads the public print
 * view (`/p/:slug?print=1&token=…`); the token unlocks the certificate evidence.
 * Free plan: 10 browser-minutes/day, 1 new browser per 20 s. A render is a few seconds.
 */
export async function renderPdf(env: Env, slug: string): Promise<Uint8Array> {
  const token = await createRenderToken(env.SIGNING_SECRET, slug);
  const url = `${env.APP_URL.replace(/\/$/, "")}/p/${slug}?print=1&token=${encodeURIComponent(token)}`;
  const browser = await puppeteer.launch(env.BROWSER as unknown as Parameters<typeof puppeteer.launch>[0]);
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
    await page.waitForSelector("[data-print-ready]", { timeout: 15_000 });
    return await page.pdf({ format: "letter", printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}

const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * Renders and stores the signed PDF (proposal + certificate page), then records its
 * path and hash on the signature (write-once in the database). Safe to call again:
 * does nothing if the PDF already exists.
 */
export async function generateSignedPdf(env: Env, db: SupabaseClient, signatureId: string): Promise<{ path: string; hash: string; bytes: Uint8Array } | null> {
  const sig = must(
    await db.from("signatures").select("id, proposal_id, pdf_path, proposal:proposals(slug)").eq("id", signatureId).single(),
    "load the signature",
  ) as unknown as { id: string; proposal_id: string; pdf_path: string | null; proposal: { slug: string } };
  if (sig.pdf_path) return null;

  const bytes = await renderPdf(env, sig.proposal.slug);
  const path = `${sig.proposal_id}/${sig.id}.pdf`;
  const { error } = await db.storage.from("signed-pdfs").upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`PDF upload failed: ${error.message}`);
  const hash = await sha256Hex(bytes);
  must(await db.from("signatures").update({ pdf_path: path, pdf_hash: hash }).eq("id", sig.id).is("pdf_path", null), "save the PDF");
  return { path, hash, bytes };
}

export { toBase64 };

const PDF_ATTEMPTS_KEY = (id: string) => `pdf-attempts:${id}`;
export const MAX_PDF_ATTEMPTS = 3;

/** One attempt, counted in KV. Returns true when the PDF exists afterwards. */
export async function attemptSignedPdf(env: Env, db: SupabaseClient, signatureId: string): Promise<boolean> {
  const attempts = Number((await env.RATE_KV.get(PDF_ATTEMPTS_KEY(signatureId))) ?? 0);
  if (attempts >= MAX_PDF_ATTEMPTS) return false;
  try {
    await generateSignedPdf(env, db, signatureId);
    return true;
  } catch (e) {
    await env.RATE_KV.put(PDF_ATTEMPTS_KEY(signatureId), String(attempts + 1), { expirationTtl: 14 * 86_400 });
    console.error(`Signed PDF attempt ${attempts + 1}/${MAX_PDF_ATTEMPTS} failed for ${signatureId}:`, e);
    // Phase 5: after the last attempt, email John (SPEC §12).
    return false;
  }
}

/** Admin export of the current published version (SPEC §12): `{Client} - {Title} - v{n}.pdf`. */
export async function exportProposalPdf(env: Env, db: SupabaseClient, proposal: { slug: string; title: string; current_version: number; client: { name: string; company: string | null } | null }) {
  if (proposal.current_version === 0) throw new ApiError(409, "not_published", "Publish the proposal before exporting a PDF.");
  const bytes = await renderPdf(env, proposal.slug);
  const client = proposal.client ? (proposal.client.company ?? proposal.client.name) : "Proposal";
  const filename = `${client} - ${proposal.title} - v${proposal.current_version}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");
  return { bytes, filename };
}
