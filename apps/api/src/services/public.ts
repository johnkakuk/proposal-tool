import {
  BrandSchema,
  OwnerSignatureSchema,
  SLUG_RE,
  maskEmail,
  type Pricing,
  type ProposalContent,
  type PublicCertificate,
  type PublicProposal,
  type PublicProposalMeta,
  type PublicProposalState,
  type PublicSignature,
  type SignatureSnapshot,
} from "@bridger/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../lib/errors.js";
import { must } from "./context.js";

/**
 * Client-facing reads (SPEC §8.1). No login: access is by the unguessable slug.
 * Only ever returns *published versions* (or, once signed, the frozen signed snapshot):
 * never the working draft, never draft or archived proposals (404), and never private
 * fields (notes, decline reason, raw IPs…) unless a render token unlocks the evidence.
 */

export interface PublicRow {
  id: string;
  owner_id: string;
  slug: string;
  title: string;
  status: string;
  current_version: number;
  expires_at: string | null;
  signed_at: string | null;
  client: { name: string; company: string | null; email: string | null } | null;
}

const NOT_FOUND = () => new ApiError(404, "not_found", "This proposal isn't available.");

export async function loadPublicRow(db: SupabaseClient, slug: string): Promise<PublicRow> {
  if (!SLUG_RE.test(slug)) throw NOT_FOUND();
  const row = must(
    await db
      .from("proposals")
      .select("id, owner_id, slug, title, status, current_version, expires_at, signed_at, client:clients(name, company, email)")
      .eq("slug", slug)
      .maybeSingle(),
    "load the proposal",
  ) as unknown as PublicRow | null;
  if (!row || row.current_version === 0 || row.status === "draft" || row.status === "archived") throw NOT_FOUND();
  return row;
}

export function publicState(row: Pick<PublicRow, "status" | "signed_at" | "expires_at">, now = Date.now()): PublicProposalState {
  if (row.signed_at || row.status === "signed") return "signed";
  if (row.status === "declined") return "declined";
  if (row.status === "expired" || (row.expires_at && Date.parse(row.expires_at) <= now)) return "expired";
  return "active";
}

export interface SignatureRow {
  id: string;
  version: number;
  signer_name: string;
  signer_email: string;
  signer_title: string | null;
  signer_company: string | null;
  signature_type: "typed" | "drawn";
  signature_text: string | null;
  signature_image_path: string | null;
  selections: Record<string, string[]>;
  consent_given_at: string;
  email_verified: boolean;
  otp_verified_at: string | null;
  ip: string | null;
  user_agent: string | null;
  geo: unknown;
  snapshot: SignatureSnapshot;
  document_hash: string;
  pdf_path: string | null;
  pdf_hash: string | null;
  certificate_id: string;
}

export async function loadSignature(db: SupabaseClient, proposalId: string): Promise<SignatureRow | null> {
  return must(
    await db.from("signatures").select("*").eq("proposal_id", proposalId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    "load the signature",
  ) as SignatureRow | null;
}

async function signedImageUrl(db: SupabaseClient, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await db.storage.from("signatures").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export async function getPublicProposal(db: SupabaseClient, slug: string, contactEmail: string): Promise<PublicProposal> {
  const row = await loadPublicRow(db, slug);
  const settings = must(await db.from("settings").select("brand, require_signer_email_otp").eq("owner_id", row.owner_id).maybeSingle(), "load branding") as {
    brand: unknown;
    require_signer_email_otp: boolean;
  } | null;
  const brand = BrandSchema.safeParse(settings?.brand);
  const state = publicState(row);

  let document: PublicProposal["document"] = null;
  let signed: PublicSignature | null = null;

  if (state === "signed") {
    const sig = await loadSignature(db, row.id);
    if (sig) {
      const snap = sig.snapshot;
      document = { content: snap.content, pricing: snap.pricing, ownerSignature: snap.ownerSignature };
      signed = {
        signerName: sig.signer_name,
        signerTitle: sig.signer_title,
        signerCompany: sig.signer_company,
        signedAt: sig.consent_given_at,
        selections: sig.selections,
        signature: sig.signature_type === "typed" ? { type: "typed", text: sig.signature_text ?? "" } : { type: "drawn", imageUrl: await signedImageUrl(db, sig.signature_image_path) },
        certificateId: sig.certificate_id,
        pdfReady: Boolean(sig.pdf_path),
      };
    }
  } else if (state === "active") {
    const v = must(
      await db.from("proposal_versions").select("content, pricing, owner_signature").eq("proposal_id", row.id).eq("version", row.current_version).single(),
      "load the published version",
    ) as { content: ProposalContent; pricing: Pricing; owner_signature: unknown };
    const sig = OwnerSignatureSchema.safeParse(v.owner_signature);
    document = { content: v.content, pricing: v.pricing, ownerSignature: sig.success ? sig.data : null };
  }

  return {
    state,
    slug: row.slug,
    title: row.title,
    version: row.current_version,
    clientName: row.client ? (row.client.company ?? row.client.name) : null,
    expiresAt: row.expires_at,
    brand: { theme: brand.success ? brand.data.theme : null, company: brand.success ? brand.data.company : null, contactEmail },
    document,
    requireOtp: settings?.require_signer_email_otp ?? true,
    signerDefaults: state === "active" ? { email: row.client?.email ?? null, company: row.client?.company ?? row.client?.name ?? null } : { email: null, company: null },
    signed,
  };
}

/**
 * The certificate of completion / verification data (SPEC §8.2 step 8). Anyone with the
 * link sees the snapshot (so they can re-hash it) with the signer's email masked. The raw
 * evidence (IP, user agent, geo, audit trail) is only included for the PDF renderer.
 */
export async function getPublicCertificate(db: SupabaseClient, slug: string, withEvidence: boolean): Promise<PublicCertificate> {
  const row = await loadPublicRow(db, slug);
  const sig = row.signed_at ? await loadSignature(db, row.id) : null;
  if (!sig) throw new ApiError(404, "not_signed", "This proposal hasn't been signed.");

  const cert: PublicCertificate = {
    certificateId: sig.certificate_id,
    documentHash: sig.document_hash,
    pdfHash: sig.pdf_hash,
    signedAt: sig.consent_given_at,
    signer: { name: sig.signer_name, title: sig.signer_title, company: sig.signer_company, email: withEvidence ? sig.signer_email : maskEmail(sig.signer_email) },
    proposalTitle: sig.snapshot.proposal.title,
    version: sig.snapshot.version,
    snapshot: sig.snapshot,
  };
  if (withEvidence) {
    const events = must(
      await db.from("audit_events").select("event_type, occurred_at, actor, ip").eq("proposal_id", row.id).in("event_type", ["published", "emailed", "viewed", "otp_sent", "otp_verified", "signed"]).order("occurred_at"),
      "load the audit trail",
    ) as { event_type: string; occurred_at: string; actor: string; ip: string | null }[];
    cert.evidence = {
      ip: sig.ip,
      userAgent: sig.user_agent,
      geo: sig.geo,
      emailVerified: sig.email_verified,
      otpVerifiedAt: sig.otp_verified_at,
      auditTrail: events.map((e) => ({ event: e.event_type, at: e.occurred_at, actor: e.actor, ip: e.ip })),
    };
  }
  return cert;
}

/** For link previews. Uses the published cover when there is one. */
export async function getPublicMeta(db: SupabaseClient, slug: string): Promise<PublicProposalMeta> {
  const p = await getPublicProposal(db, slug, "");
  const company = p.brand.company?.name ?? "Bridger Digital";
  const cover = p.document?.content.blocks.find((b) => b.type === "cover" && !b.hidden);
  const imageUrl = cover?.type === "cover" ? (cover.props.backgroundImageUrl ?? cover.props.clientLogoUrl ?? null) : null;
  return {
    title: p.title,
    description: p.clientName ? `Proposal for ${p.clientName} from ${company}` : `Proposal from ${company}`,
    imageUrl: imageUrl || null,
  };
}

/** "Request an extension" on the expired page (SPEC §8.1). Returns the proposal ID for the notification. */
export async function requestExtension(db: SupabaseClient, slug: string, meta: { ip?: string; userAgent?: string; message?: string }): Promise<string> {
  const row = await loadPublicRow(db, slug);
  if (publicState(row) !== "expired") throw new ApiError(409, "not_expired", "This proposal hasn't expired.");
  must(
    await db.from("audit_events").insert({
      owner_id: row.owner_id,
      proposal_id: row.id,
      event_type: "extension_requested",
      actor: "client",
      ip: meta.ip ?? null,
      user_agent: meta.userAgent ?? null,
      metadata: meta.message ? { message: meta.message } : {},
    }),
    "record the request",
  );
  return row.id;
}
