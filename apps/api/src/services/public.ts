import {
  BrandSchema,
  OwnerSignatureSchema,
  SLUG_RE,
  type Pricing,
  type ProposalContent,
  type PublicProposal,
  type PublicProposalMeta,
  type PublicProposalState,
} from "@bridger/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../lib/errors.js";
import { must } from "./context.js";

/**
 * Client-facing reads (SPEC §8.1). No login: access is by the unguessable slug.
 * Only ever returns *published versions*: never the working draft, never draft or
 * archived proposals (404), and never private fields (notes, decline reason, audit…).
 */

interface Row {
  id: string;
  owner_id: string;
  slug: string;
  title: string;
  status: string;
  current_version: number;
  expires_at: string | null;
  signed_at: string | null;
  client: { name: string; company: string | null } | null;
}

const NOT_FOUND = () => new ApiError(404, "not_found", "This proposal isn't available.");

async function loadRow(db: SupabaseClient, slug: string): Promise<Row> {
  if (!SLUG_RE.test(slug)) throw NOT_FOUND();
  const row = must(
    await db.from("proposals").select("id, owner_id, slug, title, status, current_version, expires_at, signed_at, client:clients(name, company)").eq("slug", slug).maybeSingle(),
    "load the proposal",
  ) as unknown as Row | null;
  if (!row || row.current_version === 0 || row.status === "draft" || row.status === "archived") throw NOT_FOUND();
  return row;
}

export function publicState(row: Pick<Row, "status" | "signed_at" | "expires_at">, now = Date.now()): PublicProposalState {
  if (row.signed_at || row.status === "signed") return "signed";
  if (row.status === "declined") return "declined";
  if (row.status === "expired" || (row.expires_at && Date.parse(row.expires_at) <= now)) return "expired";
  return "active";
}

export async function getPublicProposal(db: SupabaseClient, slug: string, contactEmail: string): Promise<PublicProposal> {
  const row = await loadRow(db, slug);
  const settings = must(await db.from("settings").select("brand").eq("owner_id", row.owner_id).maybeSingle(), "load branding") as { brand: unknown } | null;
  const brand = BrandSchema.safeParse(settings?.brand);
  const state = publicState(row);

  let document: PublicProposal["document"] = null;
  if (state === "active" || state === "signed") {
    // Phase 4 serves the signed snapshot for signed proposals; until then, the latest version.
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
  };
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

/** "Request an extension" on the expired page (SPEC §8.1). Email to John arrives in Phase 5. */
export async function requestExtension(db: SupabaseClient, slug: string, meta: { ip?: string; userAgent?: string; message?: string }): Promise<void> {
  const row = await loadRow(db, slug);
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
}
