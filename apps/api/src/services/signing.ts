import {
  PricingError,
  PricingSchema,
  OwnerSignatureSchema,
  computePricing,
  consentText,
  hashCanonical,
  newCertificateId,
  sha256Hex,
  type ProposalContent,
  type SignRequest,
  type SignatureSnapshot,
} from "@bridger/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { must } from "./context.js";
import { findVerifiedOtp } from "./otp.js";
import { loadPublicRow, publicState } from "./public.js";

export interface SigningMeta {
  ip?: string;
  userAgent?: string;
  geo?: { country?: string; region?: string; city?: string };
}

export interface SignResult {
  signatureId: string;
  certificateId: string;
  documentHash: string;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function decodePng(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (bytes.length < 60 || !PNG_MAGIC.every((b, i) => bytes[i] === b)) throw new ApiError(422, "invalid_signature", "The drawn signature couldn't be read. Please draw it again.");
  return bytes;
}

/**
 * Signing (SPEC §8.2 step 5). Everything the client sent is re-validated; totals are
 * recomputed from their selections on the published pricing; the snapshot is
 * canonicalized (RFC 8785) and hashed (SHA-256); the database commits it atomically.
 */
export async function signProposal(env: Env, db: SupabaseClient, slug: string, input: SignRequest, meta: SigningMeta): Promise<SignResult> {
  const row = await loadPublicRow(db, slug);
  const state = publicState(row);
  if (state !== "active") throw new ApiError(409, "not_signable", state === "expired" ? "This proposal has expired." : "This proposal can no longer be signed.");
  if (input.version !== row.current_version) throw new ApiError(409, "stale_version", "This proposal was updated. Please review the latest version before signing.");

  const published = must(
    await db.from("proposal_versions").select("content, pricing, owner_signature").eq("proposal_id", row.id).eq("version", row.current_version).single(),
    "load the published version",
  ) as { content: ProposalContent; pricing: unknown; owner_signature: unknown };
  const pricing = PricingSchema.parse(published.pricing);
  let totals;
  try {
    totals = computePricing(pricing, input.selections);
  } catch (e) {
    if (e instanceof PricingError) throw new ApiError(422, "invalid_selections", e.message, e.issues);
    throw e;
  }

  // Validate everything the client sent before checking verification or storing anything.
  const png = input.signature.type === "drawn" ? decodePng(input.signature.imageDataUrl) : null;

  const settings = must(await db.from("settings").select("require_signer_email_otp").eq("owner_id", row.owner_id).single(), "load settings") as { require_signer_email_otp: boolean };
  const otpId = await findVerifiedOtp(db, row.id, input.signer.email);
  if (settings.require_signer_email_otp && !otpId) throw new ApiError(403, "email_not_verified", "Please verify your email address first.");

  let signature: SignatureSnapshot["signature"];
  let imagePath: string | null = null;
  if (input.signature.type === "typed") {
    signature = { type: "typed", text: input.signature.text };
  } else {
    const bytes = png!;
    imagePath = `${row.id}/${crypto.randomUUID()}.png`;
    const { error } = await db.storage.from("signatures").upload(imagePath, bytes, { contentType: "image/png", upsert: false });
    if (error) throw new ApiError(500, "storage_error", "Couldn't save the signature. Please try again.");
    signature = { type: "drawn", imageSha256: await sha256Hex(bytes) };
  }

  const signedAt = new Date().toISOString();
  const consent = consentText(input.signer.company);
  const geo = meta.geo ?? null;
  const ownerSig = OwnerSignatureSchema.safeParse(published.owner_signature);
  const snapshot: SignatureSnapshot = {
    schema: "bridger.signature/1",
    proposal: { id: row.id, slug: row.slug, title: row.title, clientName: row.client ? (row.client.company ?? row.client.name) : null },
    version: row.current_version,
    content: published.content,
    pricing,
    selections: totals.selections,
    totals,
    signer: input.signer,
    signature,
    ownerSignature: ownerSig.success ? ownerSig.data : null,
    consentText: consent,
    signedAt,
    evidenceHash: await hashCanonical({ ip: meta.ip ?? null, userAgent: meta.userAgent ?? null, geo, timezoneOffsetMinutes: input.timezoneOffsetMinutes }),
  };
  const documentHash = await hashCanonical(snapshot);
  const certificateId = newCertificateId();

  const signatureId = must(
    await db.rpc("sign_proposal", {
      p_proposal_id: row.id,
      p_expected_version: input.version,
      p_otp_id: otpId,
      p_sig: {
        signer_name: input.signer.name,
        signer_email: input.signer.email.toLowerCase(),
        signer_title: input.signer.title,
        signer_company: input.signer.company,
        signature_type: input.signature.type,
        signature_text: input.signature.type === "typed" ? input.signature.text : null,
        signature_image_path: imagePath,
        selections: totals.selections,
        computed_totals: totals,
        consent_text: consent,
        signed_at: signedAt,
        ip: meta.ip ?? null,
        user_agent: meta.userAgent ?? null,
        geo,
        timezone_offset_minutes: input.timezoneOffsetMinutes,
        snapshot,
        document_hash: documentHash,
        certificate_id: certificateId,
      },
    }),
    "sign the proposal",
  ) as string;
  return { signatureId, certificateId, documentHash };
}

/** Decline (SPEC §8.2): status → declined with an optional reason. Email to John in Phase 5. */
export async function declineProposal(db: SupabaseClient, slug: string, reason: string | undefined, meta: SigningMeta): Promise<void> {
  const row = await loadPublicRow(db, slug);
  if (publicState(row) !== "active") throw new ApiError(409, "not_declinable", "This proposal can no longer be declined.");
  const updated = must(
    await db
      .from("proposals")
      .update({ status: "declined", declined_at: new Date().toISOString(), decline_reason: reason || null })
      .eq("id", row.id)
      .in("status", ["sent", "viewed"])
      .select("id"),
    "decline the proposal",
  ) as { id: string }[];
  if (updated.length === 0) throw new ApiError(409, "not_declinable", "This proposal can no longer be declined.");
  must(
    await db.from("audit_events").insert({ owner_id: row.owner_id, proposal_id: row.id, event_type: "declined", actor: "client", ip: meta.ip ?? null, user_agent: meta.userAgent ?? null, metadata: reason ? { reason } : {} }),
    "write the audit log",
  );
}
