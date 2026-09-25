import {
  CreateProposalSchema,
  DuplicateProposalSchema,
  ListProposalsQuerySchema,
  PricingSchema,
  ProposalContentSchema,
  SaveAsTemplateSchema,
  UpdateProposalSchema,
  applyTemplateVars,
  blankContent,
  checkReferences,
  documentHash,
  emptyPricing,
  newSlug,
  tryComputePricing,
  type Pricing,
  type ProposalContent,
  type ProposalDetail,
  type ProposalSummary,
  type TemplateDetail,
} from "@bridger/shared";
import type { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { audit, auditEdited } from "./audit.js";
import { getClientRow } from "./clients.js";
import { found, must, type ServiceContext } from "./context.js";
import { getSettings } from "./settings.js";

export const SUMMARY_COLUMNS =
  "id, slug, title, status, total_one_time_cents, total_monthly_cents, current_version, expires_at, sent_at, last_viewed_at, signed_at, created_via, created_at, updated_at, client:clients(id, name, company)";
const DETAIL_COLUMNS = `${SUMMARY_COLUMNS}, client_id, content, pricing, template_id, revision_of, created_via_client`;

/**
 * Validates a document pair beyond what Zod checks: cross-references and that
 * default selections price cleanly. Throws 422 with model-readable issues.
 */
export function validateDocument(content: ProposalContent, pricing: Pricing): void {
  const issues = checkReferences(content, pricing);
  const priced = tryComputePricing(pricing);
  if (!priced.ok) issues.push(...priced.issues);
  if (issues.length) throw new ApiError(422, "invalid_document", issues.map((i) => i.message).join("; "), issues);
}

/** Dashboard totals from default selections (SPEC §6.1). */
function denormalizedTotals(pricing: Pricing) {
  const r = tryComputePricing(pricing);
  return r.ok ? { total_one_time_cents: r.result.total.one_time, total_monthly_cents: r.result.total.monthly } : { total_one_time_cents: 0, total_monthly_cents: 0 };
}

/** A proposal row as selected with DETAIL_COLUMNS, before computed fields are added. */
type DetailRow = Omit<ProposalDetail, "totals" | "has_unpublished_changes" | "published_at">;

async function toDetail(ctx: ServiceContext, row: DetailRow): Promise<ProposalDetail> {
  const parsed = PricingSchema.safeParse(row.pricing);
  const priced = parsed.success ? tryComputePricing(parsed.data) : null;
  let published: { content_hash: string; created_at: string } | null = null;
  if (row.current_version > 0) {
    published = must(
      await ctx.db.from("proposal_versions").select("content_hash, created_at").eq("proposal_id", row.id).eq("version", row.current_version).maybeSingle(),
      "load the published version",
    ) as { content_hash: string; created_at: string } | null;
  }
  const hash = await documentHash({ content: row.content, pricing: row.pricing });
  return {
    ...row,
    totals: priced?.ok ? priced.result : null,
    has_unpublished_changes: published?.content_hash !== hash,
    published_at: published?.created_at ?? null,
  };
}

const LOCKED_MESSAGE = "This proposal is signed and locked. Duplicate it as a new revision to make changes.";

export async function listProposals(ctx: ServiceContext, query: z.output<typeof ListProposalsQuerySchema>): Promise<ProposalSummary[]> {
  let q = ctx.db.from("proposals").select(SUMMARY_COLUMNS).eq("owner_id", ctx.ownerId).order("updated_at", { ascending: false }).limit(500);
  q = query.status ? q.eq("status", query.status) : q.neq("status", "archived");
  if (query.clientId) q = q.eq("client_id", query.clientId);
  if (query.q) q = q.ilike("title", `%${query.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
  return must(await q, "list proposals") as unknown as ProposalSummary[];
}

export async function getProposal(ctx: ServiceContext, id: string): Promise<ProposalDetail> {
  const row = found(
    await ctx.db.from("proposals").select(DETAIL_COLUMNS).eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle(),
    "load the proposal",
    "Proposal",
  ) as unknown as DetailRow;
  return toDetail(ctx, row);
}

export async function createProposal(ctx: ServiceContext, input: z.output<typeof CreateProposalSchema>): Promise<ProposalDetail> {
  const client = input.clientId ? await getClientRow(ctx, input.clientId) : null;
  const settings = await getSettings(ctx);
  const clientName = client ? (client.company ?? client.name) : "";

  let content: ProposalContent;
  let pricing: Pricing;
  if (input.templateId) {
    const tpl = found(
      await ctx.db.from("templates").select("content, pricing").eq("owner_id", ctx.ownerId).eq("id", input.templateId).maybeSingle(),
      "load the template",
      "Template",
    ) as Pick<TemplateDetail, "content" | "pricing">;
    const vars = { client_name: clientName, default_terms: settings.default_terms_markdown };
    content = ProposalContentSchema.parse(applyTemplateVars(input.content ?? tpl.content, vars));
    pricing = PricingSchema.parse(input.pricing ?? tpl.pricing);
  } else {
    content = input.content ?? blankContent(input.title, clientName, settings.preparedBy);
    pricing = input.pricing ?? emptyPricing();
  }
  validateDocument(content, pricing);

  const row = must(
    await ctx.db
      .from("proposals")
      .insert({
        owner_id: ctx.ownerId,
        slug: newSlug(),
        title: input.title,
        client_id: input.clientId ?? null,
        content,
        pricing,
        expires_at: input.expiresAt ?? null,
        created_via: input.templateId ? "template" : ctx.createdVia,
        created_via_client: ctx.createdViaClient ?? null,
        template_id: input.templateId ?? null,
        ...denormalizedTotals(pricing),
      })
      .select(DETAIL_COLUMNS)
      .single(),
    "create the proposal",
  ) as unknown as DetailRow;
  await audit(ctx, row.id, "created", { via: row.created_via, templateId: input.templateId ?? null });
  return toDetail(ctx, row);
}

export async function updateProposal(ctx: ServiceContext, id: string, input: z.output<typeof UpdateProposalSchema>): Promise<ProposalDetail> {
  const current = found(
    await ctx.db.from("proposals").select("id, status, signed_at, first_viewed_at, updated_at, content, pricing").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle(),
    "load the proposal",
    "Proposal",
  ) as { id: string; status: string; signed_at: string | null; first_viewed_at: string | null; updated_at: string; content: ProposalContent; pricing: Pricing };

  if (current.signed_at) throw new ApiError(409, "locked", LOCKED_MESSAGE);
  if (current.status === "archived") throw new ApiError(409, "archived", "This proposal is archived. Unarchive it before editing.");
  if (input.baseUpdatedAt && input.baseUpdatedAt !== current.updated_at) {
    throw new ApiError(409, "conflict", "This proposal was changed somewhere else. Reload to get the latest version.");
  }
  if (input.clientId) await getClientRow(ctx, input.clientId);

  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.clientId !== undefined) patch.client_id = input.clientId;
  if (input.expiresAt !== undefined) {
    if (input.expiresAt && current.status !== "draft" && Date.parse(input.expiresAt) <= Date.now()) {
      throw new ApiError(422, "invalid_input", "The expiry date must be in the future");
    }
    patch.expires_at = input.expiresAt;
    // Extending an expired proposal reopens it (SPEC §4).
    if (current.status === "expired" && input.expiresAt && Date.parse(input.expiresAt) > Date.now()) {
      patch.status = current.first_viewed_at ? "viewed" : "sent";
    }
  }
  if (input.content !== undefined || input.pricing !== undefined) {
    const content = input.content ?? ProposalContentSchema.parse(current.content);
    const pricing = input.pricing ?? PricingSchema.parse(current.pricing);
    validateDocument(content, pricing);
    if (input.content !== undefined) patch.content = content;
    if (input.pricing !== undefined) patch.pricing = pricing;
    Object.assign(patch, denormalizedTotals(pricing));
  }
  if (Object.keys(patch).length === 0) return getProposal(ctx, id);

  // Guard on updated_at so two concurrent saves can't silently overwrite each other.
  const row = must(
    await ctx.db.from("proposals").update(patch).eq("owner_id", ctx.ownerId).eq("id", id).eq("updated_at", current.updated_at).select(DETAIL_COLUMNS).maybeSingle(),
    "save the proposal",
  ) as unknown as DetailRow | null;
  if (!row) throw new ApiError(409, "conflict", "This proposal was changed somewhere else. Reload to get the latest version.");
  if (patch.status) await audit(ctx, id, "extended", { expiresAt: patch.expires_at });
  await auditEdited(ctx, id, Object.keys(patch).filter((k) => !k.startsWith("total_") && k !== "status"));
  return toDetail(ctx, row);
}

export async function duplicateProposal(ctx: ServiceContext, id: string, input: z.output<typeof DuplicateProposalSchema>): Promise<ProposalDetail> {
  const source = await getProposal(ctx, id);
  const clientId = input.clientId === undefined ? source.client_id : input.clientId;
  if (clientId) await getClientRow(ctx, clientId);
  const row = must(
    await ctx.db
      .from("proposals")
      .insert({
        owner_id: ctx.ownerId,
        slug: newSlug(),
        title: input.asRevision ? source.title : `${source.title} (copy)`,
        client_id: clientId,
        content: source.content,
        pricing: source.pricing,
        created_via: ctx.createdVia,
        created_via_client: ctx.createdViaClient ?? null,
        template_id: source.template_id,
        revision_of: input.asRevision ? source.id : null,
        total_one_time_cents: source.total_one_time_cents,
        total_monthly_cents: source.total_monthly_cents,
      })
      .select(DETAIL_COLUMNS)
      .single(),
    "duplicate the proposal",
  ) as unknown as DetailRow;
  await audit(ctx, source.id, "duplicated", { newProposalId: row.id, asRevision: input.asRevision });
  await audit(ctx, row.id, "created", { via: ctx.createdVia, duplicatedFrom: source.id, asRevision: input.asRevision });
  return toDetail(ctx, row);
}

export async function archiveProposal(ctx: ServiceContext, id: string): Promise<ProposalDetail> {
  const current = await getProposal(ctx, id);
  if (current.status === "archived") return current;
  must(await ctx.db.from("proposals").update({ status: "archived" }).eq("owner_id", ctx.ownerId).eq("id", id), "archive the proposal");
  await audit(ctx, id, "archived", { previousStatus: current.status });
  return getProposal(ctx, id);
}

/**
 * Restores an archived proposal to the status it would otherwise have: signed and
 * declined proposals keep that outcome; published ones return to sent/viewed (or expired
 * if their date passed); never-published ones return to draft.
 */
export async function restoreProposal(ctx: ServiceContext, id: string): Promise<ProposalDetail> {
  const row = found(
    await ctx.db.from("proposals").select("id, status, signed_at, declined_at, current_version, first_viewed_at, expires_at").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle(),
    "load the proposal",
    "Proposal",
  ) as { id: string; status: string; signed_at: string | null; declined_at: string | null; current_version: number; first_viewed_at: string | null; expires_at: string | null };
  if (row.status !== "archived") return getProposal(ctx, id);
  const status = row.signed_at
    ? "signed"
    : row.declined_at
      ? "declined"
      : row.current_version === 0
        ? "draft"
        : row.expires_at && Date.parse(row.expires_at) <= Date.now()
          ? "expired"
          : row.first_viewed_at
            ? "viewed"
            : "sent";
  must(await ctx.db.from("proposals").update({ status }).eq("owner_id", ctx.ownerId).eq("id", id), "restore the proposal");
  await audit(ctx, id, "edited", { restoredTo: status });
  return getProposal(ctx, id);
}

export async function saveProposalAsTemplate(ctx: ServiceContext, id: string, input: z.output<typeof SaveAsTemplateSchema>): Promise<TemplateDetail> {
  const source = await getProposal(ctx, id);
  return must(
    await ctx.db
      .from("templates")
      .insert({
        owner_id: ctx.ownerId,
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        content: source.content,
        pricing: source.pricing,
      })
      .select("*")
      .single(),
    "save the template",
  ) as TemplateDetail;
}
